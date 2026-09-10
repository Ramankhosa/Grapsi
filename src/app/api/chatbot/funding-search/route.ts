import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

/**
 * Retired with the pre-finder advisor chatbot. This endpoint ran a catalog search
 * (query-enrichment model call + embedding + rerank) with no rate limit and no
 * quota, and no client calls it any more. The AI Fund Finder
 * (/api/recommendations/**) is the only chat surface; the directory uses
 * /api/recommendations/manual-search, which is rate-limited per user.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  return NextResponse.json(
    {
      error: 'This chatbot endpoint has been retired. Use the AI Fund Finder at /finder instead.',
      code: 'LEGACY_CHATBOT_DISABLED',
    },
    { status: 410 }
  )
}
