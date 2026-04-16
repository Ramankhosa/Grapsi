import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingGuidelineService } from '@/lib/fundingGuidelines/service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingGuidelineService.approveGuideline(params.id, auth.operator)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to approve guideline pack' }, { status: 500 })
  }
}
