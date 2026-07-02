import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { requireUserManageablePrivateFundingCall } from '@/lib/fundingIntake/userFundingCallAccess'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'
import { extractSelectedPdfPages, mapPdfLoadError } from '@/lib/pdf/pdfPageExtractor'
import { MAX_SELECTED_TEMPLATE_PDF_PAGES, normalizeSelectedPages } from '@/lib/pdf/pageSelection'

export const runtime = 'nodejs'

const jsonSchema = z.object({
  sourceType: z.enum(['intake', 'url', 'text']).default('intake'),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
})

const MAX_TEMPLATE_UPLOAD_BYTES = 20 * 1024 * 1024
const SUPPORTED_TEMPLATE_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

class BadRequestError extends Error {}

function inferTemplateUploadMimeType(file: File) {
  const declaredType = file.type?.split(';')[0]?.trim().toLowerCase()
  if (declaredType && SUPPORTED_TEMPLATE_UPLOAD_MIME_TYPES.has(declaredType)) {
    return declaredType
  }

  const fileName = file.name.toLowerCase()
  if (fileName.endsWith('.pdf')) return 'application/pdf'
  if (fileName.endsWith('.png')) return 'image/png'
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg'
  if (fileName.endsWith('.webp')) return 'image/webp'

  return declaredType || 'application/octet-stream'
}

function validateTemplateUpload(file: File) {
  if (file.size > MAX_TEMPLATE_UPLOAD_BYTES) {
    return {
      ok: false as const,
      message: 'Template file is too large. Upload a PDF or image under 20 MB.',
    }
  }

  const mimeType = inferTemplateUploadMimeType(file)
  if (!SUPPORTED_TEMPLATE_UPLOAD_MIME_TYPES.has(mimeType)) {
    return {
      ok: false as const,
      message: 'Template file must be a PDF, PNG, JPG, JPEG, or WebP image.',
    }
  }

  return { ok: true as const, mimeType }
}

function parseSelectedPagesField(value: FormDataEntryValue | null): number[] | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new BadRequestError('Selected pages must be submitted as a JSON array.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new BadRequestError('Selected pages must be valid JSON.')
  }

  const normalized = normalizeSelectedPages(parsed, {
    maxPages: MAX_SELECTED_TEMPLATE_PDF_PAGES,
  })
  if (normalized.error) {
    throw new BadRequestError(normalized.error)
  }

  return normalized.pages
}

async function stageTemplateUpload(
  file: File,
  mimeType: string,
  options: { selectedPages?: number[] } = {}
) {
  const originalBytes = Buffer.from(await file.arrayBuffer())
  const originalChecksum = crypto.createHash('sha256').update(originalBytes).digest('hex')
  let stagedBytes: Buffer<ArrayBufferLike> = originalBytes
  let checksum = originalChecksum
  let sourceMetadata: Record<string, unknown> | undefined

  if (options.selectedPages) {
    if (mimeType !== 'application/pdf') {
      throw new BadRequestError('Page selection is only supported for PDF template uploads.')
    }

    try {
      const reducedPdf = await extractSelectedPdfPages(
        originalBytes,
        options.selectedPages,
        MAX_SELECTED_TEMPLATE_PDF_PAGES
      )
      stagedBytes = reducedPdf.bytes
      checksum = crypto.createHash('sha256').update(stagedBytes).digest('hex')
      sourceMetadata = {
        original_bytes: file.size,
        original_checksum: originalChecksum,
        original_page_count: reducedPdf.originalPageCount,
        selected_pages: reducedPdf.selectedPages,
        selected_page_count: reducedPdf.selectedPages.length,
        reduced_pdf: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.startsWith('Page ') ||
        message.startsWith('Select ') ||
        message.includes('Selected pages')
      ) {
        throw new BadRequestError(message)
      }
      throw new BadRequestError(mapPdfLoadError(error))
    }
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const targetPath = path.join(os.tmpdir(), `funding-user-template-${Date.now()}-${safeName}`)
  await fs.writeFile(targetPath, stagedBytes)

  return {
    originalName: file.name || 'template-upload',
    mimeType,
    size: stagedBytes.length,
    tempFilePath: targetPath,
    checksum,
    sourceMetadata,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } }
) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) return auth.response

  const access = await requireUserManageablePrivateFundingCall(auth.actor, params.callId)
  if ('response' in access) return access.response
  if (!access.isOwner) {
    return NextResponse.json({ message: 'Only the owner can extract a template for this private funding call' }, { status: 403 })
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let asset: any = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')

      if (!(file instanceof File)) {
        return NextResponse.json({ message: 'Upload a template file to continue' }, { status: 400 })
      }

      const validation = validateTemplateUpload(file)
      if (!validation.ok) {
        return NextResponse.json({ message: validation.message }, { status: 400 })
      }

      const selectedPages = parseSelectedPagesField(formData.get('selectedPages'))

      asset = await fundingTemplateService.createUploadedAsset(
        params.callId,
        await stageTemplateUpload(file, validation.mimeType, { selectedPages }),
        auth.operator
      )
    } else {
      const payload = jsonSchema.parse(await request.json().catch(() => ({})))

      if (payload.sourceType === 'url') {
        if (!payload.sourceUrl) {
          return NextResponse.json({ message: 'Template URL is required' }, { status: 400 })
        }
        asset = await fundingTemplateService.createUrlAsset(params.callId, payload.sourceUrl, auth.operator)
      } else if (payload.sourceType === 'text') {
        if (!payload.sourceText || payload.sourceText.trim().length < 40) {
          return NextResponse.json({ message: 'Paste the template text before extracting' }, { status: 400 })
        }
        asset = await fundingTemplateService.createTextAsset(params.callId, payload.sourceText, auth.operator)
      } else {
        asset = await fundingTemplateService.syncIntakeSourceAsset(params.callId, auth.operator)
      }
    }

    // Run extraction in the background and let the client poll the run status.
    // Multimodal PDF extraction can exceed proxy timeouts when awaited inline.
    const run = await fundingTemplateService.startExtractionRun(
      params.callId,
      auth.operator,
      asset?.id ? [asset.id] : undefined
    )

    return NextResponse.json({ asset, run })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid template extraction request', issues: error.flatten() }, { status: 400 })
    }
    if (error instanceof BadRequestError) {
      return NextResponse.json({ message: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to extract template' },
      { status: 500 }
    )
  }
}
