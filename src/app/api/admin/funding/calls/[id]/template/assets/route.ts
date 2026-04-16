import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

const jsonSchema = z.object({
  sourceType: z.enum(['url', 'text']),
  sourceUrl: z.string().url().optional(),
  sourceText: z.string().optional(),
})

async function stageUpload(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer())
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const targetPath = path.join(os.tmpdir(), `funding-template-${Date.now()}-${safeName}`)
  await fs.writeFile(targetPath, bytes)
  return {
    originalName: file.name || 'upload.bin',
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    tempFilePath: targetPath,
    checksum,
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
      asset = await fundingTemplateService.createUploadedAsset(params.id, await stageUpload(file), auth.operator)
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
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to add template asset' }, { status: 500 })
  }
}
