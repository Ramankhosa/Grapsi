import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { PromotionError, withdrawFromDsr } from '@/lib/fundingCatalogImport/promote'
import { requireFundingPublisherRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

const bodySchema = z.object({ callId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/) })

/** Take a promoted catalogue call back out of the funding department. */
export async function POST(request: NextRequest) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  try {
    return NextResponse.json(await withdrawFromDsr(parsed.data.callId, auth.operator))
  } catch (error) {
    if (error instanceof PromotionError) return NextResponse.json({ message: error.message }, { status: error.status })
    console.error('[DSR withdraw]', error)
    return NextResponse.json({ message: 'Withdraw failed' }, { status: 500 })
  }
}
