import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { requireUserManageablePrivateFundingCall } from '@/lib/fundingIntake/userFundingCallAccess'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

const acceptSchema = z.object({
  runId: z.string().min(1),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } }
) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) return auth.response

  const access = await requireUserManageablePrivateFundingCall(auth.actor, params.callId)
  if ('response' in access) return access.response

  try {
    const payload = acceptSchema.parse(await request.json())
    await fundingTemplateService.applyRun(params.callId, payload.runId, auth.operator, { mode: 'replace' })
    const bundle = await fundingTemplateService.approveTemplate(params.callId, auth.operator)

    return NextResponse.json({ bundle })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid template accept request', issues: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to accept template' },
      { status: 500 }
    )
  }
}
