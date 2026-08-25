import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { shortlistCreateSchema } from '@/lib/patentIntelligence/schemas'
import { enforcePatentRateLimit, patentErrorResponse } from '@/lib/patentIntelligence/service'
import { assertIdeaRunOwnership, listShortlist, saveToShortlist } from '@/lib/patentIntelligence/shortlist'

export const runtime = 'nodejs'

function readRunId(request: NextRequest): string | null {
  const value = request.nextUrl.searchParams.get('runId')?.trim() || ''
  return value && value.length <= 80 ? value : null
}

// The signed-in user's saved patents (optionally only those linked to one idea analysis).
export async function GET(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const items = await listShortlist(auth.actor.id, { ideaRunId: readRunId(request) })
    return NextResponse.json({ items })
  } catch (error) {
    return patentErrorResponse(error)
  }
}

// Save (idempotent per user + publication number). 201 on first save, 200 when
// the patent was already shortlisted and only the note / run link was refreshed.
export async function POST(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  const limited = enforcePatentRateLimit(auth.actor.id, 'shortlist')
  if (limited) return limited

  try {
    const input = shortlistCreateSchema.parse(await request.json())
    if (input.ideaRunId) {
      const owned = await assertIdeaRunOwnership(auth.actor.id, input.ideaRunId)
      if (!owned) {
        return NextResponse.json({ error: 'Idea analysis not found', code: 'IDEA_RUN_NOT_FOUND' }, { status: 404 })
      }
    }
    const result = await saveToShortlist({
      userId: auth.actor.id,
      tenantId: auth.actor.tenantId,
      record: input.record,
      note: input.note,
      ideaRunId: input.ideaRunId,
    })
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return patentErrorResponse(error)
  }
}
