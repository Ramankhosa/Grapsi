import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

/**
 * Retired together with /api/chatbot/funding-advisor (see that route). This was
 * its keyword-driven fallback, with process-local conversation history. The
 * finder conversation endpoints under /api/recommendations replace it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  return NextResponse.json(
    {
      error: 'Legacy funding advisor chatbot is disabled. Use the funding finder recommendation endpoints instead.',
      code: 'LEGACY_CHATBOT_DISABLED',
    },
    { status: 410 }
  )
}
