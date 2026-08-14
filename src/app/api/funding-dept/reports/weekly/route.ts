import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { sendWeeklyDigests } from '@/lib/fundingDept/weeklyReportService'

export const runtime = 'nodejs'
export const maxDuration = 300

const weeklySchema = z.object({
  tenantId: z.string().trim().min(1).optional(),
})

function isCronRequest(request: NextRequest): boolean {
  const secret = process.env.FUNDING_ALERT_CRON_SECRET
  if (!secret) {
    return false
  }
  return request.headers.get('x-funding-alert-secret') === secret
}

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
  if (!isCronRequest(request)) {
    const auth = await requireFundingOperatorRequest(request)
    if ('response' in auth) {
      return auth.response
    }
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
