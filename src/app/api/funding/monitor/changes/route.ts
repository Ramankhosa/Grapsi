import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The review queue. "NEW" also surfaces snoozed items whose snooze has run
 * out, so a deferred find comes back rather than disappearing.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const state = request.nextUrl.searchParams.get('state') ?? 'NEW'
  const now = new Date()

  const where =
    state === 'NEW'
      ? {
          OR: [
            { state: 'NEW' },
            { state: 'SNOOZED', snoozed_until: { lte: now } },
          ],
        }
      : { state }

  const changes = await prisma.monitoredChange.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 100,
    include: {
      source: { select: { id: true, name: true, url: true } },
      resolved_by: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ changes })
}
