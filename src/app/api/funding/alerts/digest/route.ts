import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingAlertService } from '@/lib/services/fundingAlertService'

export const runtime = 'nodejs'
export const maxDuration = 300

const digestSchema = z.object({
  frequency: z.enum(['daily', 'weekly']),
})

function isCronRequest(request: NextRequest): boolean {
  const secret = process.env.FUNDING_ALERT_CRON_SECRET
  if (!secret) {
    return false
  }
  return request.headers.get('x-funding-alert-secret') === secret
}

/**
 * POST /api/funding/alerts/digest
 *
 * Bundles queued funding alerts into one email per user whose notification
 * frequency matches. Run daily and weekly from a scheduler.
 */
export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    const auth = await requireFundingOperatorRequest(request)
    if ('response' in auth) {
      return auth.response
    }
  }

  let body: z.infer<typeof digestSchema>
  try {
    body = digestSchema.parse(await request.json())
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof z.ZodError ? error.errors[0]?.message : 'frequency must be "daily" or "weekly"' },
      { status: 400 }
    )
  }

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
