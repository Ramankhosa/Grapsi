import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { FundingImportError, retryFundingImportJob } from '@/lib/funding/ingestion-service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
  })
  if ('response' in auth) {
    return auth.response
  }

  try {
    const job = await retryFundingImportJob(params.jobId, auth.actor)
    return NextResponse.json({ job })
  } catch (error) {
    if (error instanceof FundingImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }

    console.error('[SuperAdmin/Funding/Imports/:jobId/retry] POST error:', error)
    return NextResponse.json({ error: 'Failed to retry funding import job' }, { status: 500 })
  }
}
