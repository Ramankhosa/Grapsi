import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingTemplateService } from '@/lib/fundingTemplates/service'

export const runtime = 'nodejs'

const applyRunSchema = z.object({
  mode: z.enum(['replace', 'merge']).optional().default('replace'),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; runId: string } }
) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const payload = applyRunSchema.parse(await request.json().catch(() => ({})))
    const bundle = await fundingTemplateService.applyRun(params.id, params.runId, auth.operator, {
      mode: payload.mode,
    })
    return NextResponse.json(bundle)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to apply template run' }, { status: 500 })
  }
}
