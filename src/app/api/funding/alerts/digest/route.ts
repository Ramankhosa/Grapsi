import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { fundingAlertService } from '@/lib/services/fundingAlertService'

export const runtime = 'nodejs'
export const maxDuration = 300

const digestSchema = z.object({
  frequency: z.enum(['daily', 'weekly']),
})

/**
 * POST /api/funding/alerts/digest
 *
 * Bundles queued funding alerts into one email per user whose notification
 * frequency matches. Run daily and weekly from a scheduler.
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

  let body: z.infer<typeof digestSchema>
  try {
    body = digestSchema.parse(await request.json().catch(() => ({})))
  } catch {
    return NextResponse.json(
      { message: 'frequency must be "daily" or "weekly"' },
      { status: 400 }
    )
  }

  return withJobRun(
    {
      jobKey: `alerts-digest-${body.frequency}`,
      trigger: cron ? 'schedule' : 'manual',
      triggeredBy,
    },
    async () => {
      try {
        const result = await fundingAlertService.sendFundingAlertDigests(body.frequency)
        return NextResponse.json(result)
      } catch (error) {
        console.error('[FUNDING-ALERT] Digest endpoint failed:', error)
        return NextResponse.json(
          { message: error instanceof Error ? error.message : 'Digest send failed' },
          { status: 500 }
        )
      }
    }
  )
}
