import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { sweepDueReminders } from '@/lib/fundingDept/reminderService'
import { sweepDeadlineEscalations } from '@/lib/fundingDept/escalationService'
import { sweepPendencyEscalations } from '@/lib/fundingDept/pendencyEscalationService'
import { sweepJobHealth } from '@/lib/jobs/healthSweep'

export const runtime = 'nodejs'
export const maxDuration = 300

const sweepSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
  /** Narrow the pendency ladder to one tenant, for verifying a change safely. */
  tenantId: z.string().trim().min(1).optional(),
})

/**
 * POST /api/funding-dept/reminders/sweep
 *
 * Three jobs on one schedule, because all three answer "who needs chasing right
 * now":
 *   1. hand-written follow-up reminders whose time has come,
 *   2. the automatic ladder — deadline approaching, or nobody has replied, and
 *   3. the pendency ladder — a relevant call nobody has taken up at all, which
 *      is the failure that happens BEFORE any of the above can apply, and
 *   4. the job health check, which chases the chasers: a scheduled job that has
 *      gone quiet is the failure that silently disables all three.
 *
 * Safe to run as often as you like: all three claim each unit of work with a
 * conditional update before sending, so overlapping runs cannot double-deliver.
 * Hourly is the intended cadence, and the pendency ladder rides this schedule
 * rather than adding a cron entry of its own.
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
        // Sequential, not parallel: all three write notifications for the same
        // people, and a member reading their bell should see them in a sensible
        // order.
        const reminders = await sweepDueReminders({ limit: body.limit })
        const escalations = await sweepDeadlineEscalations({ limit: body.limit })
        // Last, because it is the only one whose cost grows with the catalog: it
        // computes a backlog per school. Running it after the two cheap sweeps
        // means their work is already committed if this one throws.
        const pendency = await sweepPendencyEscalations({ tenantId: body.tenantId })
        // Last and cheapest: one indexed lookup per registered job. It reports
        // on this very sweep too, which is the point — if this route stops
        // being called, the console badge is what says so instead.
        const jobHealth = await sweepJobHealth()
        return NextResponse.json({ reminders, escalations, pendency, jobHealth })
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
