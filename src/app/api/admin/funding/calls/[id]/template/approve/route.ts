import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const bundle = await fundingTemplateService.approveTemplate(params.id, auth.operator)
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to approve template' }, { status: 500 })
  }
}
