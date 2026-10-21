import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { listReviewItems, reviewSummary, type ReviewFilter } from '@/lib/fundingCatalogImport/review'
import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

/** The import review category: summary counts plus one page of items. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const params = request.nextUrl.searchParams
  const state = params.get('state')
  const variant = params.get('variant')
  const filter: ReviewFilter = {
    reviewId: params.get('reviewId') || null,
    reason: params.get('reason') || null,
    tier: params.get('tier') || null,
    state: state === 'resolved' || state === 'all' ? state : 'open',
    variant: variant === 'only' || variant === 'exclude' ? variant : null,
    runId: params.get('runId') || null,
    q: params.get('q')?.slice(0, 200) || null,
  }
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(5, Number(params.get('pageSize')) || 25))
  try {
    const [summary, list] = await Promise.all([reviewSummary(prisma as any), listReviewItems(prisma as any, filter, page, pageSize)])
    return NextResponse.json({ summary, ...list })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to load the import review' }, { status: 500 })
  }
}
