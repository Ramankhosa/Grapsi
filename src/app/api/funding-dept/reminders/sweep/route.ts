import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { sweepDueReminders } from '@/lib/fundingDept/reminderService'
import { sweepDeadlineEscalations } from '@/lib/fundingDept/escalationService'

export const runtime = 'nodejs'
export const maxDuration = 300

const sweepSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
})

/**
 * Schedulers authenticate with the same shared secret the funding alert jobs
 * use — one scheduler credential for the whole product. The secret must be
 * configured server-side for the header path to work at all, so an unset env
 * can never open the route.
 */
function isCronRequest(request: NextRequest): boolean {
  const secret = process.env.FUNDING_ALERT_CRON_SECRET
  if (!secret) {
    return false
  }
  return request.headers.get('x-funding-alert-secret') === secret
}

/**
 * POST /api/funding-dept/reminders/sweep
 *
 * Two jobs on one schedule, because both answer "who needs chasing right now":
 *   1. hand-written follow-up reminders whose time has come, and
 *   2. the automatic ladder — deadline approaching, or nobody has replied.
 *
 * Safe to run as often as you like: both claim each unit of work with a
 * conditional update before sending, so overlapping runs cannot double-deliver.
 * Hourly is the intended cadence.
 */
export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    const auth = await requireFundingOperatorRequest(request)
    if ('response' in auth) {
      return auth.response
    }
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

  try {
    // Sequential, not parallel: both write notifications for the same people,
    // and a member reading their bell should see them in a sensible order.
    const reminders = await sweepDueReminders({ limit: body.limit })
    const escalations = await sweepDeadlineEscalations({ limit: body.limit })
    return NextResponse.json({ reminders, escalations })
  } catch (error) {
    console.error('[FUNDING-DEPT] Reminder sweep failed:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Reminder sweep failed' },
      { status: 500 }
    )
  }
}
