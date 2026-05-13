import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { FundingImportError, publishGlobalFundingCall } from '@/lib/funding/ingestion-service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
    requiredPlatformPermission: 'funding.publisher.write',
  })
  if ('response' in auth) {
    return auth.response
  }

  try {
    const call = await publishGlobalFundingCall(params.callId, auth.actor)
    return NextResponse.json({ call })
  } catch (error) {
    if (error instanceof FundingImportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }

    console.error('[SuperAdmin/Funding/Calls/:callId/publish] POST error:', error)
    return NextResponse.json({ error: 'Failed to publish funding call' }, { status: 500 })
  }
}
