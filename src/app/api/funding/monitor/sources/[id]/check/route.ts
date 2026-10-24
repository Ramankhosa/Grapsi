import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { runCheck } from '@/lib/monitor/checker'
import { isV2Engine } from '@/lib/monitor/engine'
import { requestCheckNow } from '@/lib/monitor/planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * "Check now" — deliberately outside the schedule, so a reviewer who has just
 * fixed a selector sees the result straight away. Under the v2 engine it
 * queues a priority occurrence for the worker and returns the task to poll;
 * the request never fetches anything itself.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  if (isV2Engine()) {
    try {
      const queued = await requestCheckNow(params.id)
      return NextResponse.json({ status: 'queued', taskId: queued.taskId, generation: queued.generation }, { status: 202 })
    } catch (error) {
      return NextResponse.json({ status: 'error', message: error instanceof Error ? error.message : 'Could not queue the check' }, { status: 404 })
    }
  }

  const result = await runCheck(params.id)
  return NextResponse.json(result, { status: result.status === 'error' ? 502 : 200 })
}
