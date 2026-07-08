import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { stagePdfUpload } from '@/lib/fundingIntake/appRouterUpload'
import { parseFundingCsvUpload } from '@/lib/fundingIntake/csvIngestion'
import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

const intakeSubmitSchema = z.object({
  inputType: z.enum(['url', 'text', 'pdf', 'json']),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
  sourceJsonText: z.string().optional(),
  operatorNotes: z.string().max(5000).optional(),
})

const MAX_JSON_UPLOAD_BYTES = 5 * 1024 * 1024

export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
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
      const inputType = String(formData.get('inputType') || 'pdf').toLowerCase()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json(
          {
            message:
              inputType === 'json'
                ? 'No JSON file received'
                : inputType === 'csv'
                  ? 'No CSV file received'
                  : 'No PDF file received',
          },
          { status: 400 }
        )
      }

      if (inputType === 'csv') {
        // A CSV upload is just an alternate input format: convert it to the same
        // intake object the JSON path consumes, then submit it as a JSON intake.
        // This reuses the entire downstream draft/guideline import pipeline and
        // needs no new job input_type.
        if (file.size > MAX_JSON_UPLOAD_BYTES) {
          return NextResponse.json({ message: 'CSV intake file is too large' }, { status: 400 })
        }

        const csvText = await file.text()
        let intakeObject
        try {
          intakeObject = parseFundingCsvUpload(csvText)
        } catch (csvError) {
          return NextResponse.json(
            { message: csvError instanceof Error ? csvError.message : 'Could not parse CSV upload' },
            { status: 400 }
          )
        }
        payload = {
          inputType: 'json',
          operatorNotes: String(formData.get('operatorNotes') || '').trim() || undefined,
          sourceJsonText: JSON.stringify(intakeObject),
          sourceJsonFile: {
            originalName: file.name || 'funding-intake.csv',
            mimeType: file.type || 'text/csv',
            size: file.size,
          },
        }
      } else if (inputType === 'json') {
        if (file.size > MAX_JSON_UPLOAD_BYTES) {
          return NextResponse.json({ message: 'JSON intake file is too large' }, { status: 400 })
        }

        const sourceJsonText = await file.text()
        payload = {
          inputType: 'json',
          operatorNotes: String(formData.get('operatorNotes') || '').trim() || undefined,
          sourceJsonText,
          sourceJsonFile: {
            originalName: file.name || 'funding-intake.json',
            mimeType: file.type || 'application/json',
            size: file.size,
          },
        }
      } else {
        payload = {
          inputType: 'pdf',
          operatorNotes: String(formData.get('operatorNotes') || '').trim() || undefined,
          sourceFile: await stagePdfUpload(file),
        }
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
              : payload.inputType === 'json'
                ? payload.sourceJsonFile?.originalName || 'JSON upload'
                : payload.sourceFile?.originalName || 'PDF upload',
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
        {
          message: issueSummary ? `Invalid request: ${issueSummary}` : 'Invalid request',
          issues: error.flatten(),
          rawIssues: error.issues,
        },
        { status: 400 }
      )
    }

    console.error('[Funding Intake] create error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to process funding intake request' },
      { status: 500 }
    )
  }
}
