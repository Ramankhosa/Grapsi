export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { PromotionError, previewPromotion, promoteToDsr } from '@/lib/fundingCatalogImport/promote'
import { requireFundingPublisherRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

const callIdSchema = z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/)

function failure(error: unknown, fallback: string) {
  if (error instanceof PromotionError) return NextResponse.json({ message: error.message }, { status: error.status })
  console.error('[DSR promotion]', error)
  return NextResponse.json({ message: fallback }, { status: 500 })
}

/** What promoting the call would do, and anything that stops it. */
async function catalogueGET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const callId = callIdSchema.safeParse(request.nextUrl.searchParams.get('callId'))
  if (!callId.success) return NextResponse.json({ message: 'callId is required' }, { status: 400 })
  try {
    return NextResponse.json(await previewPromotion(callId.data))
  } catch (error) {
    return failure(error, 'Could not prepare the promotion')
  }
}

const bodySchema = z.object({
  callId: callIdSchema,
  notifyOfficers: z.boolean().default(true),
  alertResearchers: z.boolean().default(false),
})

/** Promote a catalogue call into the funding department. */
async function cataloguePOST(request: NextRequest) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  try {
    const result = await promoteToDsr(parsed.data.callId, auth.operator, {
      notifyOfficers: parsed.data.notifyOfficers,
      alertResearchers: parsed.data.alertResearchers,
    })
    return NextResponse.json(result)
  } catch (error) {
    return failure(error, 'Promotion failed')
  }
}

export const GET = withCatalogueProtection(catalogueGET, 'detail', 'FUNDING_DISCOVERY')
export const POST = withCatalogueProtection(cataloguePOST, 'detail', 'FUNDING_DISCOVERY')
