export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { listPromotedCalls } from '@/lib/fundingCatalogImport/promote'
import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

/** Catalogue calls promoted to the funding department, with live checks. */
async function catalogueGET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  try {
    return NextResponse.json({ calls: await listPromotedCalls() })
  } catch (error) {
    console.error('[DSR promoted list]', error)
    return NextResponse.json({ message: 'Could not load promoted calls' }, { status: 500 })
  }
}

export const GET = withCatalogueProtection(catalogueGET, 'detail', 'FUNDING_DISCOVERY')
