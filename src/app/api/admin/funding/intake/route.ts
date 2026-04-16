import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { stagePdfUpload } from '@/lib/fundingIntake/appRouterUpload'
import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

const intakeSubmitSchema = z.object({
  inputType: z.enum(['url', 'text', 'pdf']),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
  operatorNotes: z.string().max(5000).optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const jobs = await fundingIntakeService.listJobs()
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('[Funding Intake] list error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funding intake jobs' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let payload: any

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ message: 'No PDF file received' }, { status: 400 })
      }

      payload = {
        inputType: 'pdf',
        operatorNotes: String(formData.get('operatorNotes') || '').trim() || undefined,
        sourceFile: await stagePdfUpload(file),
      }
    } else {
      payload = intakeSubmitSchema.parse(await request.json())
    }

    const job = await fundingIntakeService.createJob(auth.operator, payload)
    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        acceptedSource:
          payload.inputType === 'url'
            ? payload.sourceUrl
            : payload.inputType === 'text'
              ? `${(payload.sourceText || '').slice(0, 120)}${(payload.sourceText || '').length > 120 ? '...' : ''}`
              : payload.sourceFile?.originalName || 'PDF upload',
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid request', issues: error.flatten() }, { status: 400 })
    }

    console.error('[Funding Intake] create error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to process funding intake request' },
      { status: 500 }
    )
  }
}
