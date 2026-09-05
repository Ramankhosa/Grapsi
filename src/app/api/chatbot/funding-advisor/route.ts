import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

/**
 * Retired. This was the pre-finder advisor chatbot: its `conversation` action ran
 * an open-ended "general conversation" prompt and its `advice` action coached
 * application writing — both outside the remit the funding assistant is now
 * held to (find funding, answer questions about a specific call). Nothing in the
 * UI calls it. The finder conversation endpoints under /api/recommendations are
 * the supported replacement.
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
