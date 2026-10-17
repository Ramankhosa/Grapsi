import { NextRequest, NextResponse } from 'next/server'

import { listPromotedCalls } from '@/lib/fundingCatalogImport/promote'
import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

/** Catalogue calls promoted to the funding department, with live checks. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  try {
    return NextResponse.json({ calls: await listPromotedCalls() })
  } catch (error) {
    console.error('[DSR promoted list]', error)
    return NextResponse.json({ message: 'Could not load promoted calls' }, { status: 500 })
  }
}
