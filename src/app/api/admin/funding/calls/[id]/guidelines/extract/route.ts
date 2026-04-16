import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingGuidelineService } from '@/lib/fundingGuidelines/service'

export const runtime = 'nodejs'

async function stageUpload(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer())
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const targetPath = path.join(os.tmpdir(), `funding-guideline-${Date.now()}-${safeName}`)
  await fs.writeFile(targetPath, bytes)
  return { tempFilePath: targetPath, checksum }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const contentType = request.headers.get('content-type') || ''
    let sourceInput: any = undefined

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ message: 'No file received' }, { status: 400 })
      }
      const staged = await stageUpload(file)
      sourceInput = {
        sourceMode: 'pdf',
        sourceFilePath: staged.tempFilePath,
        sourceLabel: file.name || null,
      }
    } else {
      const body = await request.json().catch(() => ({}))
      sourceInput = body?.sourceMode ? body : undefined
    }

    const run = await fundingGuidelineService.createExtractionRunFromFundingCall(params.id, auth.operator, sourceInput)
    return NextResponse.json({ run })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to extract guidelines' }, { status: 500 })
  }
}
