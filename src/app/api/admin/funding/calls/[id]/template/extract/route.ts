export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { startTemplateExtractionRun } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

async function cataloguePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const body = await request.json().catch(() => ({}))
    const run = await startTemplateExtractionRun(params.id, auth.operator, body.assetIds)
    return NextResponse.json({ run, accepted: true }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to extract template' }, { status: 500 })
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'detail', 'FUNDING_DISCOVERY',{generation:true})
