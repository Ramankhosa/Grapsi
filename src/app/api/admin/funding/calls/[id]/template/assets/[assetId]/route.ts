import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; assetId: string } }
) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    await fundingTemplateService.deleteAsset(params.id, params.assetId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to delete template asset' }, { status: 500 })
  }
}
