import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { fundingAlertService } from '@/lib/services/fundingAlertService'

export const runtime = 'nodejs'
export const maxDuration = 300

const dispatchSchema = z.object({
  fundingCallId: z.string().trim().min(1).optional(),
  force: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

/**
 * POST /api/funding/alerts/dispatch
 *
 * With fundingCallId: match that call against researcher embeddings and alert
 * matched users (idempotent — already-alerted users are skipped).
 * Without: sweep recently published calls that have never been dispatched.
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

  let body: z.infer<typeof dispatchSchema>
  try {
    const raw = await request.json().catch(() => ({}))
    body = dispatchSchema.parse(raw)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof z.ZodError ? error.errors[0]?.message : 'Invalid request body' },
      { status: 400 }
    )
  }

  return withJobRun(
    { jobKey: 'alerts-dispatch', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
      try {
        if (body.fundingCallId) {
          const result = await fundingAlertService.dispatchAlertsForFundingCall(body.fundingCallId, {
            force: body.force,
          })
          return NextResponse.json({ mode: 'single', result })
        }

        const sweep = await fundingAlertService.sweepPendingFundingCallAlerts({ limit: body.limit })
        return NextResponse.json({ mode: 'sweep', ...sweep })
      } catch (error) {
        console.error('[FUNDING-ALERT] Dispatch endpoint failed:', error)
        return NextResponse.json(
          { message: error instanceof Error ? error.message : 'Alert dispatch failed' },
          { status: 500 }
        )
      }
    }
  )
}
