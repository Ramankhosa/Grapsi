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

async function stageTemplateUpload(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer())
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const targetPath = path.join(os.tmpdir(), `funding-user-template-${Date.now()}-${safeName}`)
  await fs.writeFile(targetPath, bytes)

  return {
    originalName: file.name || 'template-upload',
    mimeType: file.type || 'application/octet-stream',
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

      asset = await fundingTemplateService.createUploadedAsset(
        params.callId,
        await stageTemplateUpload(file),
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
