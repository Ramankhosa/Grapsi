import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const body = await request.json().catch(() => ({}))
    const run = await fundingTemplateService.startExtractionRun(params.id, auth.operator, body.assetIds)
    return NextResponse.json({ run, accepted: true }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to extract template' }, { status: 500 })
  }
}
