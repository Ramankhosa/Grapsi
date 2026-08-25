import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { shortlistPatchSchema } from '@/lib/patentIntelligence/schemas'
import { enforcePatentRateLimit, patentErrorResponse } from '@/lib/patentIntelligence/service'
import { removeFromShortlist, updateShortlistNote } from '@/lib/patentIntelligence/shortlist'

export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  const limited = enforcePatentRateLimit(auth.actor.id, 'shortlist')
  if (limited) return limited

  try {
    const input = shortlistPatchSchema.parse(await request.json())
    const item = await updateShortlistNote(auth.actor.id, params.id, input.note)
    if (!item) return NextResponse.json({ error: 'Shortlist item not found', code: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ item })
  } catch (error) {
    return patentErrorResponse(error)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  const limited = enforcePatentRateLimit(auth.actor.id, 'shortlist')
  if (limited) return limited

  try {
    const removed = await removeFromShortlist(auth.actor.id, params.id)
    if (!removed) return NextResponse.json({ error: 'Shortlist item not found', code: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return patentErrorResponse(error)
  }
}
