import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { expireEventUsers } from '@/lib/services/eventUserExpiryService'

export const runtime = 'nodejs'
export const maxDuration = 300

const expirySchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
})

/**
 * POST /api/platform/users/expire-event-access
 *
 * Suspends ACTIVE users whose accessExpiresAt has passed (EVENT/workshop
 * accounts) and revokes their refresh tokens. Hygiene only — auth-time checks
 * already block expired users. Intended for a daily schedule; safe to re-run.
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

  let body: z.infer<typeof expirySchema>
  try {
    body = expirySchema.parse(await request.json().catch(() => ({})))
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof z.ZodError ? error.errors[0]?.message : 'Invalid request body' },
      { status: 400 }
    )
  }

  return withJobRun(
    { jobKey: 'event-user-expiry', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
      try {
        const result = await expireEventUsers({ limit: body.limit })
        return NextResponse.json(result)
      } catch (error) {
        console.error('[EVENT-EXPIRY] Sweep failed:', error)
        return NextResponse.json(
          { message: error instanceof Error ? error.message : 'Event-user expiry failed' },
          { status: 500 }
        )
      }
    }
  )
}
