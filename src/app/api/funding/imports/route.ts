import { NextRequest, NextResponse } from 'next/server'

import { assertVisibilityAccess } from '@/lib/funding/access'
import { stagePdfUpload } from '@/lib/fundingIntake/appRouterUpload'
import { toFundingImportJobView } from '@/lib/fundingIntake/compat'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

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
      throw new Error('Multipart imports require a single file')
    }

    return {
      inputType,
      visibility,
      sourceFile: await stagePdfUpload(file),
    } as const
  }

  const body = await request.json()
  const inputType = parseInputType(body.inputType)
  if (!inputType) {
    throw new Error('inputType must be one of url, file, or text')
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create funding import' },
      { status: 500 }
    )
  }
}
