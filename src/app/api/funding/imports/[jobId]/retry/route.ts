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
    return NextResponse.json({ error: 'Failed to retry funding import job' }, { status: 500 })
  }
}
