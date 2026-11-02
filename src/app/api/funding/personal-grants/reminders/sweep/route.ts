import { NextRequest, NextResponse } from 'next/server'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { sweepPersonalGrantReminders } from '@/lib/personalGrants/reminders'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function POST(request: NextRequest) {
  const cron = isCronRequest(request)
  let triggeredBy: string | null = null
  if (!cron) {
    const auth = await requireFundingOperatorRequest(request)
    if ('response' in auth) return auth.response
    triggeredBy = auth.actor.email
  }
  return withJobRun({ jobKey: 'personal-grant-reminders', trigger: cron ? 'schedule' : 'manual', triggeredBy }, async () => {
    const result = await sweepPersonalGrantReminders()
    return NextResponse.json(result, { status: result.failed || result.retrying || result.recovered ? 503 : 200 })
  })
}
