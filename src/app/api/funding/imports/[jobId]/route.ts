import { NextRequest, NextResponse } from 'next/server'

import { toFundingImportJobView } from '@/lib/fundingIntake/compat'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const details = await fundingIntakeService.getJobDetails(params.jobId, auth.operator)
    if (!details) {
      return NextResponse.json({ error: 'Funding import job not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({ job: toFundingImportJobView(details) })
  } catch (error) {
    console.error('[Funding/Imports/:jobId] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch funding import job' }, { status: 500 })
  }
}
