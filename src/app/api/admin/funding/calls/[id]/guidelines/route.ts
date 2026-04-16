import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingGuidelineService } from '@/lib/fundingGuidelines/service'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingGuidelineService.getGuidelineBundle(params.id)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to load guideline bundle' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingGuidelineService.createBlankGuideline(params.id, auth.operator)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to create blank guidelines' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const body = await request.json()
    const bundle = await fundingGuidelineService.updateGuideline(
      params.id,
      body.guideline_pack_json,
      auth.operator,
      body.changeNotes
    )
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to update guideline pack' }, { status: 500 })
  }
}
