import { NextRequest, NextResponse } from 'next/server'

import { toFundingImportJobView } from '@/lib/fundingIntake/compat'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    await fundingIntakeService.retryJob(params.jobId, auth.operator)
    const details = await fundingIntakeService.getJobDetails(params.jobId, auth.operator)
    return NextResponse.json({ job: details ? toFundingImportJobView(details) : null })
  } catch (error) {
    console.error('[Funding/Imports/:jobId/retry] POST error:', error)
    if (error instanceof Error) {
      if (error.message === 'Funding intake job not found') {
        return NextResponse.json({ error: error.message, code: 'NOT_FOUND' }, { status: 404 })
      }

      if (error.message === 'Only failed jobs can be retried') {
        return NextResponse.json({ error: error.message, code: 'RETRY_NOT_ALLOWED' }, { status: 409 })
      }
    }

    return NextResponse.json({ error: 'Failed to retry funding import job' }, { status: 500 })
  }
}
