import { NextRequest, NextResponse } from 'next/server'

import { isFeatureEnabled } from '@/lib/feature-flags'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import { normalizeGuidelinePack } from '@/lib/fundingGuidelines/utils'
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types'
import { syncDraftZeroStateWithStageStates } from '@/lib/draftZero/extraction'
import { normalizeDraftZeroState } from '@/lib/draftZero/types'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled('ENABLE_DRAFT_ZERO')) {
    return NextResponse.json({ message: 'Draft Zero is not enabled.' }, { status: 404 })
  }
  const auth = await requireGrantPrepActor(request)
  if ('response' in auth) return auth.response
  const { id } = await params

  try {
    const session = await loadGrantPrepSession({ sessionId: id, tenantId: auth.actor.tenantId })
    if (!session) return NextResponse.json({ message: 'Grant Prep session not found' }, { status: 404 })
    const access = await assertGrantPrepProjectCapability(auth.actor, session.project_id, 'read')
    if (access instanceof NextResponse) return access

    const serverContext = await resolveGrantPrepContext(session.project_id, auth.actor, {
      grantSessionId: session.grant_session_id,
      fundingCallId: session.funding_call_id,
    })
    const prepContext = inflateGrantPrepSessionContext(session, {
      warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
    })

    let guidelinePack: GuidelinePackDocument | null = null
    try {
      const rawPack = serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json
        ?? (serverContext.draftingContext?.approvedGuidelineRevision as { extractedPayload?: unknown } | null | undefined)?.extractedPayload
      guidelinePack = rawPack ? normalizeGuidelinePack(rawPack) : null
    } catch {
      guidelinePack = null
    }

    const storedState = normalizeDraftZeroState(session.draft_zero_state_json)
    return NextResponse.json({
      draftZero: storedState ? syncDraftZeroStateWithStageStates(storedState, prepContext.stageStates) : null,
      prepContext,
      fundingContext: serverContext.fundingContext,
      guidelinePack,
      sessionStatus: session.status,
      sessionUpdatedAt: session.updated_at.toISOString(),
    })
  } catch (error) {
    console.error('[Draft Zero] state error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load Draft Zero state' },
      { status: 500 }
    )
  }
}
