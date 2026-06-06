import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { stagePdfUpload } from '@/lib/fundingIntake/appRouterUpload'
import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

const retrySourceSchema = z.object({
  sourceMode: z.enum(['url', 'text']).optional(),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
})

function isRetrySourceValidationError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return [
    'sourceUrl is required',
    'sourceText must contain meaningful content',
    'PDF file is required',
    'Only PDF files are supported',
    'PDF intake file is too large',
    'Invalid URL',
    'Only https URLs are allowed',
    'Private or local network URLs are not allowed',
  ].some((message) => error.message.includes(message))
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let retrySourceInput: any = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const sourceMode = String(formData.get('sourceMode') || '').toLowerCase()
      if (sourceMode !== 'pdf') {
        return NextResponse.json({ message: 'Multipart retry requires sourceMode=pdf' }, { status: 400 })
      }

      const file = formData.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ message: 'No PDF file received' }, { status: 400 })
      }
      retrySourceInput = {
        inputType: 'pdf',
        sourceFile: await stagePdfUpload(file),
      }
    } else {
      const rawBody = await request.text()
      if (rawBody.trim()) {
        let parsedBody: unknown
        try {
          parsedBody = JSON.parse(rawBody)
        } catch {
          return NextResponse.json({ message: 'Invalid retry source JSON' }, { status: 400 })
        }
        const payload = retrySourceSchema.parse(parsedBody)
        if (payload.sourceMode === 'url') {
          retrySourceInput = {
            inputType: 'url',
            sourceUrl: payload.sourceUrl,
          }
        } else if (payload.sourceMode === 'text') {
          retrySourceInput = {
            inputType: 'text',
            sourceText: payload.sourceText,
          }
        }
      }
    }

    await fundingIntakeService.retryJob(params.id, auth.operator, retrySourceInput)
    return NextResponse.json({ ok: true, status: 'queued' })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid retry source payload', issues: error.flatten() }, { status: 400 })
    }

    if (isRetrySourceValidationError(error)) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : 'Invalid retry source' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to retry funding intake job' },
      { status: 500 }
    )
  }
}
