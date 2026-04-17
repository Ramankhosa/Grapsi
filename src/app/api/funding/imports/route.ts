import { NextRequest, NextResponse } from 'next/server'

import { assertVisibilityAccess } from '@/lib/funding/access'
import { stagePdfUpload } from '@/lib/fundingIntake/appRouterUpload'
import { toFundingImportJobView } from '@/lib/fundingIntake/compat'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

class FundingImportRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message)
    this.name = 'FundingImportRequestError'
  }
}

function parseVisibility(value: FormDataEntryValue | string | null | undefined) {
  return value === 'GLOBAL_PUBLISHED' ? 'GLOBAL_PUBLISHED' : 'TENANT_PRIVATE'
}

function parseInputType(value: FormDataEntryValue | string | null | undefined) {
  if (value === 'url' || value === 'file' || value === 'text') {
    return value
  }
  return null
}

async function parseCreateRequest(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file')
    const visibility = parseVisibility(formData.get('visibility'))
    const inputType = parseInputType(formData.get('inputType')) || (file instanceof File ? 'file' : null)

    if (inputType !== 'file' || !(file instanceof File)) {
      throw new FundingImportRequestError('Multipart imports require a single file', 400, 'INVALID_MULTIPART_UPLOAD')
    }

    try {
      const stagedPdf = await stagePdfUpload(file)

      return {
        inputType,
        visibility,
        sourceFile: stagedPdf,
      } as const
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stage upload'
      if (message.includes('Only PDF files are supported')) {
        throw new FundingImportRequestError(message, 400, 'UNSUPPORTED_FILE_TYPE')
      }

      if (message.includes('too large')) {
        throw new FundingImportRequestError(message, 400, 'FILE_TOO_LARGE')
      }

      throw error
    }

  }

  const body = await request.json()
  const inputType = parseInputType(body.inputType)
  if (!inputType) {
    throw new FundingImportRequestError('inputType must be one of url, file, or text', 400, 'INVALID_INPUT_TYPE')
  }

  return {
    inputType,
    visibility: parseVisibility(body.visibility),
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
    rawText: typeof body.rawText === 'string' ? body.rawText : undefined,
  } as const
}

export async function GET(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const jobs = await fundingIntakeService.listJobs()
    const visibleJobs = auth.operator.role === 'USER'
      ? jobs.filter((job) => job.submitted_by?.id === auth.operator.userId)
      : jobs

    const details = await Promise.all(visibleJobs.map((job) => fundingIntakeService.getJobDetails(job.id, auth.operator)))
    return NextResponse.json({
      jobs: details.filter(Boolean).map((detail) => toFundingImportJobView(detail)),
    })
  } catch (error) {
    console.error('[Funding/Imports] GET error:', error)
    return NextResponse.json({ error: 'Failed to list funding imports' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = await parseCreateRequest(request)
    const visibilityResponse = assertVisibilityAccess(auth.actor, payload.visibility)
    if (visibilityResponse) {
      return visibilityResponse
    }

    const job = await fundingIntakeService.createJob(auth.operator, {
      inputType: payload.inputType === 'file' ? 'pdf' : payload.inputType,
      sourceUrl: payload.sourceUrl,
      sourceText: payload.rawText,
      sourceFile: payload.sourceFile,
    })

    const details = await fundingIntakeService.getJobDetails(job.id, auth.operator)
    return NextResponse.json({ job: details ? toFundingImportJobView(details) : null }, { status: 201 })
  } catch (error) {
    console.error('[Funding/Imports] POST error:', error)

    if (error instanceof FundingImportRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }

    if (error instanceof Error) {
      if (error.message === 'sourceUrl is required for URL intake') {
        return NextResponse.json({ error: error.message, code: 'SOURCE_URL_REQUIRED' }, { status: 400 })
      }

      if (error.message === 'sourceText is required for text intake') {
        return NextResponse.json({ error: error.message, code: 'RAW_TEXT_REQUIRED' }, { status: 400 })
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create funding import' },
      { status: 500 }
    )
  }
}
