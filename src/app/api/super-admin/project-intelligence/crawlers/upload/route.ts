import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

const UPLOAD_DIR = process.env.ICSSR_UPLOAD_DIR || '/tmp/icssr-uploads'

async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const user = await prisma.user.findFirst({
      where: {
        refreshTokens: {
          some: {
            tokenHash: token,
            expiresAt: { gt: new Date() },
            isRevoked: false,
          },
        },
      },
      select: { id: true, email: true, roles: true },
    })

    if (!user?.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden - Super Admin only' }, { status: 403 })
    }

    await ensureUploadDir()

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

        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)

        const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = join(UPLOAD_DIR, safeFileName)

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

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const user = await prisma.user.findFirst({
      where: {
        refreshTokens: {
          some: {
            tokenHash: token,
            expiresAt: { gt: new Date() },
            isRevoked: false,
          },
        },
      },
      select: { id: true, email: true, roles: true },
    })

    if (!user?.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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

export async function DELETE(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const user = await prisma.user.findFirst({
      where: {
        refreshTokens: {
          some: {
            tokenHash: token,
            expiresAt: { gt: new Date() },
            isRevoked: false,
          },
        },
      },
      select: { id: true, email: true, roles: true },
    })

    if (!user?.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fileName = searchParams.get('fileName')

    if (!fileName) {
      return NextResponse.json({ error: 'File name required' }, { status: 400 })
    }

    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = join(UPLOAD_DIR, safeFileName)

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
