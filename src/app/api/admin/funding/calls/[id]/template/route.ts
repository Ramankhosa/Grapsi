export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

async function catalogueGET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingTemplateService.getTemplateBundle(params.id)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to load template bundle' }, { status: 500 })
  }
}

async function cataloguePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingTemplateService.createBlankTemplate(params.id, auth.operator)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to create blank template' }, { status: 500 })
  }
}

async function cataloguePUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const body = await request.json()
    const bundle = await fundingTemplateService.updateTemplate(
      params.id,
      body.grant_template_json,
      auth.operator,
      body.changeNotes
    )
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to update template' }, { status: 500 })
  }
}

export const GET = withCatalogueProtection(catalogueGET, 'detail', 'FUNDING_DISCOVERY')

export const POST = withCatalogueProtection(cataloguePOST, 'detail', 'FUNDING_DISCOVERY')

export const PUT = withCatalogueProtection(cataloguePUT, 'detail', 'FUNDING_DISCOVERY')
