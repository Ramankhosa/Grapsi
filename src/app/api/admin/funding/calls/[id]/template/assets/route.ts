import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'
import { extractSelectedPdfPages, mapPdfLoadError } from '@/lib/pdf/pdfPageExtractor'
import { MAX_SELECTED_TEMPLATE_PDF_PAGES, normalizeSelectedPages } from '@/lib/pdf/pageSelection'

export const runtime = 'nodejs'

const jsonSchema = z.object({
  sourceType: z.enum(['url', 'text']),
  sourceUrl: z.string().url().optional(),
  sourceText: z.string().optional(),
})

class BadRequestError extends Error {}

function parseSelectedPages(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new BadRequestError('Selected pages must be valid JSON')
  }
  const normalized = normalizeSelectedPages(parsed, { maxPages: MAX_SELECTED_TEMPLATE_PDF_PAGES })
  if (normalized.error) throw new BadRequestError(normalized.error)
  return normalized.pages
}

async function stageUpload(file: File, selectedPages?: number[]) {
  const originalBytes = Buffer.from(await file.arrayBuffer())
  let bytes: Buffer<ArrayBufferLike> = originalBytes
  let sourceMetadata: Record<string, unknown> | undefined
  if (selectedPages) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestError('Page selection is only supported for PDF template uploads')
    }
    try {
      const reduced = await extractSelectedPdfPages(originalBytes, selectedPages, MAX_SELECTED_TEMPLATE_PDF_PAGES)
      bytes = reduced.bytes
      sourceMetadata = {
        original_bytes: originalBytes.length,
        original_checksum: crypto.createHash('sha256').update(originalBytes).digest('hex'),
        original_page_count: reduced.originalPageCount,
        selected_pages: reduced.selectedPages,
        selected_page_count: reduced.selectedPages.length,
        reduced_pdf: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('Page ') || message.startsWith('Select ') || message.includes('Selected pages')) {
        throw new BadRequestError(message)
      }
      throw new BadRequestError(mapPdfLoadError(error))
    }
  }
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const targetPath = path.join(os.tmpdir(), `funding-template-${Date.now()}-${safeName}`)
  await fs.writeFile(targetPath, bytes)
  return {
    originalName: file.name || 'upload.bin',
    mimeType: file.type || 'application/octet-stream',
    size: bytes.length,
    tempFilePath: targetPath,
    checksum,
    sourceMetadata,
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const contentType = request.headers.get('content-type') || ''

    let asset
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ message: 'No file received' }, { status: 400 })
      }
      const selectedPages = parseSelectedPages(formData.get('selectedPages'))
      asset = await fundingTemplateService.createUploadedAsset(params.id, await stageUpload(file, selectedPages), auth.operator)
    } else {
      const body = jsonSchema.parse(await request.json())
      asset =
        body.sourceType === 'url'
          ? await fundingTemplateService.createUrlAsset(params.id, body.sourceUrl || '', auth.operator)
          : await fundingTemplateService.createTextAsset(params.id, body.sourceText || '', auth.operator)
    }

    return NextResponse.json({ asset }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid template asset request', issues: error.flatten() }, { status: 400 })
    }
    if (error instanceof BadRequestError) {
      return NextResponse.json({ message: error.message }, { status: 400 })
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to add template asset' }, { status: 500 })
  }
}
