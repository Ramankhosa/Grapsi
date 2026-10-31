import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { loadSiteTree } from '@/lib/monitor/siteTree'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/sites/:id/tree — every page of a site, by level, with what each led to. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const tree = await loadSiteTree(params.id)
  if (!tree) return NextResponse.json({ message: 'Website not found' }, { status: 404 })
  return NextResponse.json(tree, { headers: { 'Cache-Control': 'private, no-store' } })
}
