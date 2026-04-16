import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { toFundingCallSummary } from '@/lib/fundingIntake/compat'
import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const calls = await prisma.fundingCall.findMany({
      where: buildFundingCallAccessWhere(auth.actor),
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({ calls: calls.map((call) => toFundingCallSummary(call)) })
  } catch (error) {
    console.error('[Funding/Calls] GET error:', error)
    return NextResponse.json({ error: 'Failed to list funding calls' }, { status: 500 })
  }
}
