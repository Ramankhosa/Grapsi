import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { stagePdfUpload } from '@/lib/fundingIntake/appRouterUpload'
import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

const batchSourceSchema = z.object({
  sourceKey: z.enum(['source_1', 'source_2', 'source_3']),
  inputType: z.enum(['url', 'text', 'pdf', 'json']),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
  sourceJsonText: z.string().optional(),
  documentKind: z.enum(['call_document', 'guideline_document', 'template_document']).optional(),
})

const batchJobSchema = z.object({
  operatorNotes: z.string().max(5000).optional(),
  sources: z.array(batchSourceSchema).min(1).max(3),
  detailsSourceKey: z.enum(['source_1', 'source_2', 'source_3']),
  guidelinesSourceKey: z.enum(['source_1', 'source_2', 'source_3']).optional(),
  templateSourceKey: z.enum(['source_1', 'source_2', 'source_3']).optional(),
  autoCreateDraft: z.boolean().optional(),
  extractAll: z.boolean().optional(),
})

const batchCreateSchema = z.object({
  label: z.string().max(200).optional(),
  jobs: z.array(batchJobSchema).min(1).max(100),
})

function readApiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to process batch funding intake request'
}

async function parseBatchPayload(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return batchCreateSchema.parse(await request.json())
  }

  const formData = await request.formData()
  const payloadText = String(formData.get('payload') || '')
  const payload = batchCreateSchema.parse(JSON.parse(payloadText))

  for (let jobIndex = 0; jobIndex < payload.jobs.length; jobIndex += 1) {
    const job = payload.jobs[jobIndex]
    for (const source of job.sources) {
      const file = formData.get(`file_${jobIndex}_${source.sourceKey}`)
      if (!(file instanceof File)) {
        continue
      }

      if (source.inputType === 'pdf') {
        ;(source as any).sourceFile = await stagePdfUpload(file)
      } else if (source.inputType === 'json') {
        ;(source as any).sourceJsonText = await file.text()
        ;(source as any).sourceJsonFile = {
          originalName: file.name || 'funding-intake.json',
          mimeType: file.type || 'application/json',
          size: file.size,
        }
      }
    }
  }

  return payload
}

export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const batches = await fundingIntakeService.listBatches()
    return NextResponse.json({ batches })
  } catch (error) {
    console.error('[Funding Intake Batch] list error:', error)
    return NextResponse.json({ message: readApiErrorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = await parseBatchPayload(request)
    const batch = await fundingIntakeService.createBatch(auth.operator, payload)
    return NextResponse.json(
      {
        batchId: batch.id,
        status: batch.status,
        totalJobs: batch.total_jobs,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issueSummary = error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
        .join('; ')
      return NextResponse.json(
        { message: issueSummary ? `Invalid request: ${issueSummary}` : 'Invalid request', issues: error.flatten() },
        { status: 400 }
      )
    }

    console.error('[Funding Intake Batch] create error:', error)
    return NextResponse.json({ message: readApiErrorMessage(error) }, { status: 500 })
  }
}
