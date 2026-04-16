import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingGuidelineService } from '@/lib/fundingGuidelines/service'

export const runtime = 'nodejs'

const requestSchema = z.object({
  revisionNo: z.number().int().min(1),
  changeNotes: z.string().optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    const body = requestSchema.parse(await request.json())
    const bundle = await fundingGuidelineService.revertGuideline(params.id, body.revisionNo, auth.operator, body.changeNotes)
    return NextResponse.json(bundle)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid revert request', issues: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to revert guideline pack' }, { status: 500 })
  }
}
