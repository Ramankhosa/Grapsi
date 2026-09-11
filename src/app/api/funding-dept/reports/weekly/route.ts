import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { writeWeeklySnapshots } from '@/lib/fundingDept/snapshotService'
import { sendWeeklyDigests } from '@/lib/fundingDept/weeklyReportService'

export const runtime = 'nodejs'
export const maxDuration = 300

const weeklySchema = z.object({
  tenantId: z.string().trim().min(1).optional(),
})

/**
 * POST /api/funding-dept/reports/weekly
 *
 * Writes the weekly snapshot, then sends each department member their pending
 * worklist and each head the department rollup. Intended for a Monday-morning
 * schedule. Re-running it the same week is a no-op: the snapshot is idempotent on
 * its week key, and every mail recipient is stamped and skipped for five days.
 *
 * The snapshot goes FIRST so the digest can quote the delta — "untouched backlog
 * 14, was 9 a week ago" — rather than a bare number the reader has no way to
 * judge. It also rides this schedule rather than adding a cron entry of its own.
 *
 * Pass tenantId to run it for one organization, e.g. when testing.
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

  let body: z.infer<typeof weeklySchema>
  try {
    body = weeklySchema.parse(await request.json().catch(() => ({})))
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof z.ZodError ? error.errors[0]?.message : 'Invalid request body' },
      { status: 400 }
    )
  }

  return withJobRun(
    { jobKey: 'reports-weekly', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
      try {
        const snapshots = await writeWeeklySnapshots({ tenantId: body.tenantId })
        const result = await sendWeeklyDigests({ tenantId: body.tenantId })
        return NextResponse.json({ ...result, snapshots })
      } catch (error) {
        console.error('[FUNDING-DEPT] Weekly report failed:', error)
        return NextResponse.json(
          { message: error instanceof Error ? error.message : 'Weekly report failed' },
          { status: 500 }
        )
      }
    }
  )
}
