import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const asset = await fundingTemplateService.syncIntakeSourceAsset(params.id, auth.operator)
    return NextResponse.json({ asset })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to sync intake asset' }, { status: 500 })
  }
}
