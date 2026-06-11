import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { requireUserManageablePrivateFundingCall } from '@/lib/fundingIntake/userFundingCallAccess'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { callId: string; runId: string } }
) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) return auth.response

  const access = await requireUserManageablePrivateFundingCall(auth.actor, params.callId)
  if ('response' in access) return access.response

  try {
    const run = await fundingTemplateService.getRun(params.callId, params.runId)

    if (!run) {
      return NextResponse.json({ message: 'Template extraction run not found' }, { status: 404 })
    }

    return NextResponse.json({ run })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load template extraction run' },
      { status: 500 }
    )
  }
}
