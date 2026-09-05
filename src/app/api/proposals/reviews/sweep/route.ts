import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { sweepStuckReviews } from '@/lib/proposals/reviewRunner'

export const runtime = 'nodejs'
export const maxDuration = 300

const sweepSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
})

/**
 * POST /api/proposals/reviews/sweep
 *
 * Picks up proposal reviews whose worker went away.
 *
 * A review runs inside the web process after the officer starts it, so a deploy
 * or a `pm2 reload` in the middle of one leaves the row stranded mid-flight.
 * This finds those — QUEUED rows nothing ever claimed, and live rows whose
 * heartbeat has stopped — and runs them to completion.
 *
 * Safe to run as often as you like: each row is claimed with a conditional
 * update, so a run this sweep starts cannot be started twice, and resumed work
 * costs almost nothing because sections whose text has not changed keep their
 * existing review. Every ten minutes is the intended cadence.
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
    { jobKey: 'proposal-reviews-sweep', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
      try {
        const result = await sweepStuckReviews(body.limit ?? 5)
        return NextResponse.json(result)
      } catch (error) {
        console.error('[PROPOSALS] Review sweep failed:', error)
        return NextResponse.json(
          { message: error instanceof Error ? error.message : 'Review sweep failed' },
          { status: 500 }
        )
      }
    }
  )
}
