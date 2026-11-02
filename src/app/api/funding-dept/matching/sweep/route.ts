import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { sweepCallMatchCensus } from '@/lib/fundingDept/currentMatches'

export const runtime = 'nodejs'
export const maxDuration = 300

const sweepSchema = z.object({
  budget: z.number().int().min(1).max(200).optional(),
  /** Narrow the pass to one tenant, for verifying a change safely. */
  tenantId: z.string().trim().min(1).optional(),
})

/**
 * POST /api/funding-dept/matching/sweep
 *
 * Re-scores open calls whose stored match census is stale, or whose last
 * attempt failed and has waited out its backoff. A failed call keeps its last
 * good matches; this is what retries it. Every 15 minutes is the intended
 * cadence. Overlapping runs are harmless: each call's write re-checks its
 * inputs inside the transaction.
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
    { jobKey: 'matching-census-sweep', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
      try {
        const census = await sweepCallMatchCensus({ budget: body.budget, tenantId: body.tenantId })
        return NextResponse.json({ census })
      } catch (error) {
        console.error('[FUNDING-DEPT] Matching census sweep failed:', error)
        return NextResponse.json(
          { message: error instanceof Error ? error.message : 'Matching census sweep failed' },
          { status: 500 }
        )
      }
    }
  )
}
