import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; runId: string } }
) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingTemplateService.applyRun(params.id, params.runId, auth.operator)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to apply template run' }, { status: 500 })
  }
}
