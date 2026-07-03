import { appendFile, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'

import { NextRequest, NextResponse } from 'next/server'

import {
  requirePublicProjectReadRequest,
  requirePublicProjectWriteRequest,
} from '@/lib/publicProjects/auth'

const UPLOAD_DIR = process.env.ICSSR_UPLOAD_DIR || '/tmp/icssr-uploads'
const RESOLVED_UPLOAD_DIR = resolve(UPLOAD_DIR)
const PARTS_DIR = resolve(join(UPLOAD_DIR, '.parts'))
const MAX_FILE_SIZE_BYTES =
  Math.max(Number(process.env.ICSSR_MAX_PDF_UPLOAD_MB || 50), 1) * 1024 * 1024
const MAX_CHUNK_SIZE_BYTES = 768 * 1024

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
  if (!existsSync(PARTS_DIR)) {
    await mkdir(PARTS_DIR, { recursive: true })
  }
}

function getUploadPath(fileName: string) {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = resolve(join(UPLOAD_DIR, safeFileName))
  if (filePath !== RESOLVED_UPLOAD_DIR && !filePath.startsWith(`${RESOLVED_UPLOAD_DIR}${sep}`)) {
    throw new Error('Invalid file path')
  }
  return { safeFileName, filePath }
}

function readInteger(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function uploadChunk(request: NextRequest) {
  const uploadId = request.nextUrl.searchParams.get('uploadId') || ''
  const fileName = request.nextUrl.searchParams.get('fileName') || ''
  const chunkIndex = readInteger(request.nextUrl.searchParams.get('chunkIndex'))
  const totalChunks = readInteger(request.nextUrl.searchParams.get('totalChunks'))
  const fileSize = readInteger(request.nextUrl.searchParams.get('fileSize'))

  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(uploadId)) {
    return NextResponse.json({ error: 'Invalid upload identifier' }, { status: 400 })
  }
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 })
  }
  if (
    chunkIndex === null ||
    totalChunks === null ||
    fileSize === null ||
    chunkIndex < 0 ||
    totalChunks < 1 ||
    chunkIndex >= totalChunks ||
    fileSize < 1
  ) {
    return NextResponse.json({ error: 'Invalid chunk metadata' }, { status: 400 })
  }
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `PDF exceeds the ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB upload limit` },
      { status: 413 }
    )
  }

  const chunk = Buffer.from(await request.arrayBuffer())
  if (chunk.length === 0 || chunk.length > MAX_CHUNK_SIZE_BYTES) {
    return NextResponse.json({ error: 'Invalid upload chunk size' }, { status: 413 })
  }

  const partDirectory = resolve(join(PARTS_DIR, uploadId))
  if (!partDirectory.startsWith(`${PARTS_DIR}${sep}`)) {
    return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
  }
  await mkdir(partDirectory, { recursive: true })
  await writeFile(join(partDirectory, `${chunkIndex}.part`), chunk)

  if (chunkIndex !== totalChunks - 1) {
    return NextResponse.json({ success: true, complete: false, chunkIndex })
  }

  const { safeFileName, filePath } = getUploadPath(fileName)
  const temporaryPath = join(partDirectory, 'assembled.pdf')
  let assembledSize = 0
  await writeFile(temporaryPath, Buffer.alloc(0))

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const part = await readFile(join(partDirectory, `${index}.part`))
      assembledSize += part.length
      if (assembledSize > MAX_FILE_SIZE_BYTES) {
        throw new Error('Assembled PDF exceeds the upload limit')
      }
      await appendFile(temporaryPath, part)
    }

    if (assembledSize !== fileSize) {
      throw new Error('Uploaded PDF size does not match the source file')
    }

    await unlink(filePath).catch(() => undefined)
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(partDirectory, { recursive: true, force: true })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to assemble PDF' },
      { status: 409 }
    )
  }

  await rm(partDirectory, { recursive: true, force: true })
  return NextResponse.json({
    success: true,
    complete: true,
    fileName: safeFileName,
    size: assembledSize,
  })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePublicProjectWriteRequest(request)
    if ('response' in auth) return auth.response

    await ensureUploadDir()

    if (request.nextUrl.searchParams.get('mode') === 'chunk') {
      return uploadChunk(request)
    }

    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })
    }

    const results: Array<{ fileName: string; status: 'success' | 'error'; error?: string }> = []

    for (const file of files) {
      try {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
          results.push({ fileName: file.name, status: 'error', error: 'Not a PDF file' })
          continue
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          results.push({
            fileName: file.name,
            status: 'error',
            error: `PDF exceeds the ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB upload limit`,
          })
          continue
        }

        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)

        const { filePath } = getUploadPath(file.name)

        await writeFile(filePath, buffer)

        results.push({ fileName: file.name, status: 'success' })
      } catch (error) {
        results.push({
          fileName: file.name,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length
    const errorCount = results.filter((r) => r.status === 'error').length

    return NextResponse.json({
      success: true,
      uploadDir: UPLOAD_DIR,
      totalFiles: files.length,
      successCount,
      errorCount,
      results,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePublicProjectReadRequest(request)
    if ('response' in auth) return auth.response

    await ensureUploadDir()
    const files = await readdir(UPLOAD_DIR)
    const pdfFiles = files.filter((f) => f.toLowerCase().endsWith('.pdf'))

    return NextResponse.json({
      uploadDir: UPLOAD_DIR,
      files: pdfFiles.map((name) => ({
        name,
        path: join(UPLOAD_DIR, name),
      })),
      totalFiles: pdfFiles.length,
    })
  } catch (error) {
    console.error('List files error:', error)
    return NextResponse.json({ files: [], totalFiles: 0 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requirePublicProjectWriteRequest(request)
    if ('response' in auth) return auth.response

    const { searchParams } = new URL(request.url)
    const fileName = searchParams.get('fileName')

    if (!fileName) {
      return NextResponse.json({ error: 'File name required' }, { status: 400 })
    }

    const { filePath } = getUploadPath(fileName)

    try {
      await unlink(filePath)
      return NextResponse.json({ success: true, deleted: fileName })
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 500 }
    )
  }
}
