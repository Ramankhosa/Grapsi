import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'

import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectWriteRequest } from '@/lib/publicProjects/auth'

const UPLOAD_DIR = process.env.CSV_IMPORT_DIR || '/tmp/csv-imports'
const RESOLVED_UPLOAD_DIR = resolve(UPLOAD_DIR)

async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
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

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePublicProjectWriteRequest(request)
    if ('response' in auth) return auth.response

    await ensureUploadDir()

    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })
    }

    const results: Array<{ fileName: string; status: 'success' | 'error'; error?: string }> = []

    for (const file of files) {
      try {
        const isCsv = file.name.toLowerCase().endsWith('.csv')
        const isTxt = file.name.toLowerCase().endsWith('.txt')

        if (!isCsv && !isTxt) {
          results.push({ fileName: file.name, status: 'error', error: 'Only .csv or .txt files allowed' })
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
    console.error('CSV Upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePublicProjectWriteRequest(request)
    if ('response' in auth) return auth.response

    await ensureUploadDir()
    const files = await readdir(UPLOAD_DIR)
    const csvFiles = files.filter((f) => f.toLowerCase().endsWith('.csv') || f.toLowerCase().endsWith('.txt'))

    return NextResponse.json({
      uploadDir: UPLOAD_DIR,
      files: csvFiles.map((name) => ({
        name,
        path: join(UPLOAD_DIR, name),
      })),
      totalFiles: csvFiles.length,
    })
  } catch (error) {
    console.error('List CSV files error:', error)
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
    console.error('Delete CSV error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 500 }
    )
  }
}
