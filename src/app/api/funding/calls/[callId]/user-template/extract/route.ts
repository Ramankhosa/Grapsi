import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { requireUserManageablePrivateFundingCall } from '@/lib/fundingIntake/userFundingCallAccess'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

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

async function stageTemplateUpload(file: File, mimeType: string) {
  const bytes = Buffer.from(await file.arrayBuffer())
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const targetPath = path.join(os.tmpdir(), `funding-user-template-${Date.now()}-${safeName}`)
  await fs.writeFile(targetPath, bytes)

  return {
    originalName: file.name || 'template-upload',
    mimeType,
    size: file.size,
    tempFilePath: targetPath,
    checksum,
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

      asset = await fundingTemplateService.createUploadedAsset(
        params.callId,
        await stageTemplateUpload(file, validation.mimeType),
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

    const run = await fundingTemplateService.createExtractionRun(
      params.callId,
      auth.operator,
      asset?.id ? [asset.id] : undefined
    )

    return NextResponse.json({ asset, run })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid template extraction request', issues: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to extract template' },
      { status: 500 }
    )
  }
}
