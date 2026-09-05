import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { sweepProposals } from '@/lib/proposals/sweeps'

export const runtime = 'nodejs'
export const maxDuration = 300

const sweepSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
})

/**
 * POST /api/proposals/sweep
 *
 * The desk's three standing watches, on one schedule because all three answer
 * "what is quietly going wrong": a cut-off approaching with no revision, a
 * draft nobody has turned around, and an application the agency has gone silent
 * on.
 *
 * Idempotent by construction — the cut-off ladder is guarded by its own array
 * and the other two by their own event records — so overlapping runs cannot
 * double-send. Hourly is the intended cadence.
 */
export async function POST(request: NextRequest) {
  const cron = isCronRequest(request)
  let triggeredBy: string | null = null
  if (!cron) {
    const auth = await requireFundingOperatorRequest(request)
    if ('response' in auth) {
      return auth.response
    }
    triggeredBy = auth.actor.email
  }

  let body: z.infer<typeof sweepSchema>
  try {
    body = sweepSchema.parse(await request.json().catch(() => ({})))
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof z.ZodError ? error.errors[0]?.message : 'Invalid request body' },
      { status: 400 }
    )
  }

  return withJobRun(
    { jobKey: 'proposals-sweep', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
      try {
        return NextResponse.json(await sweepProposals(body.limit))
      } catch (error) {
        console.error('[PROPOSALS] Sweep failed:', error)
        return NextResponse.json(
          { message: error instanceof Error ? error.message : 'Proposal sweep failed' },
          { status: 500 }
        )
      }
    }
  )
}
