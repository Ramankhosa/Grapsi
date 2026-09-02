import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { sendWeeklyDigests } from '@/lib/fundingDept/weeklyReportService'

export const runtime = 'nodejs'
export const maxDuration = 300

const weeklySchema = z.object({
  tenantId: z.string().trim().min(1).optional(),
})

/**
 * POST /api/funding-dept/reports/weekly
 *
 * Sends each department member their pending worklist and each head the
 * department rollup. Intended for a Monday-morning schedule. Re-running it the
 * same week is a no-op: every recipient is stamped and skipped for five days.
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
        const result = await sendWeeklyDigests({ tenantId: body.tenantId })
        return NextResponse.json(result)
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
