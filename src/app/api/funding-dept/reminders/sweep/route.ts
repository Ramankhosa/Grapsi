import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { sweepDueReminders } from '@/lib/fundingDept/reminderService'
import { sweepDeadlineEscalations } from '@/lib/fundingDept/escalationService'

export const runtime = 'nodejs'
export const maxDuration = 300

const sweepSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
})

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
    { jobKey: 'reminders-sweep', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
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
  )
}
