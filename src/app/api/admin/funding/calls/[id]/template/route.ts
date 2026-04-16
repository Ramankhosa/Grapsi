import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingTemplateService.getTemplateBundle(params.id)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to load template bundle' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingTemplateService.createBlankTemplate(params.id, auth.operator)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to create blank template' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
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
