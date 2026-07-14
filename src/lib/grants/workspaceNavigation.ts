import { isFeatureEnabled } from '@/lib/feature-flags'

export type GrantWorkspaceStage =
  | 'GRANTMENTOR'
  | 'BLUEPRINT'
  | 'LITERATURE_SEARCH'
  | 'FULL_TEXT_EVIDENCE_EXTRACTION'
  | 'FIGURE_PLANNER'
  | 'SECTION_DRAFTING'
  | 'REVIEWER'

/**
 * Default entry route for grant preparation. Draft Zero (generate-first proof
 * review) is the default path when enabled; the guided Grant Prep chat stays
 * reachable from the Draft Zero UI and directly at /prep for users who prefer
 * a step-by-step conversation. Accepts either a grant session id or a grant
 * prep session id — both pages resolve either.
 */
export function buildGrantPrepEntryUrl(input: {
  projectId: string
  grantOrPrepSessionId: string
}) {
  const base = `/projects/${input.projectId}/grants/${input.grantOrPrepSessionId}`
  return isFeatureEnabled('ENABLE_DRAFT_ZERO') ? `${base}/draft-zero` : `${base}/prep`
}

export function resolveGrantWorkspaceStageForPrepStatus(status?: string | null): GrantWorkspaceStage {
  return status === 'launched' || status === 'handed_off' ? 'BLUEPRINT' : 'GRANTMENTOR'
}

export function resolveGrantWorkspaceStageForGrantStatus(status?: string | null): GrantWorkspaceStage | null {
  switch (String(status || '').toUpperCase()) {
    case 'BLUEPRINT':
      return 'BLUEPRINT'
    case 'DRAFTING':
    case 'REVIEW':
      return 'SECTION_DRAFTING'
    default:
      return null
  }
}

export function resolveGrantWorkspaceStage(input: {
  prepStatus?: string | null
  grantStatus?: string | null
}): GrantWorkspaceStage {
  return (
    resolveGrantWorkspaceStageForGrantStatus(input.grantStatus) ||
    resolveGrantWorkspaceStageForPrepStatus(input.prepStatus)
  )
}

export function buildGrantWorkspaceUrl(input: {
  projectId: string
  grantSessionId?: string | null
  prepStatus?: string | null
  grantStatus?: string | null
  stage?: GrantWorkspaceStage
}) {
  if (!input.grantSessionId) return null
  const stage = input.stage || resolveGrantWorkspaceStage({
    prepStatus: input.prepStatus,
    grantStatus: input.grantStatus,
  })
  return `/projects/${input.projectId}/grants/${input.grantSessionId}/workspace?stage=${stage}`
}

export function buildGrantProjectOpenUrl(input: {
  projectId: string
  prepSession?: {
    status?: string | null
    grant_session_id?: string | null
  } | null
  grantSession?: {
    id?: string | null
    status?: string | null
  } | null
}) {
  if (!input.prepSession && !resolveGrantWorkspaceStageForGrantStatus(input.grantSession?.status)) {
    return null
  }

  const grantSessionId = input.grantSession?.id || input.prepSession?.grant_session_id || null
  if (!grantSessionId) return null

  const stage = resolveGrantWorkspaceStage({
    prepStatus: input.prepSession?.status,
    grantStatus: input.grantSession?.status,
  })
  // Pre-launch grants open on Draft Zero (when enabled) — the guided Grant
  // Prep chat is the optional path, reachable from the Draft Zero UI.
  if (stage === 'GRANTMENTOR' && isFeatureEnabled('ENABLE_DRAFT_ZERO')) {
    return buildGrantPrepEntryUrl({
      projectId: input.projectId,
      grantOrPrepSessionId: grantSessionId,
    })
  }

  return buildGrantWorkspaceUrl({
    projectId: input.projectId,
    grantSessionId,
    prepStatus: input.prepSession?.status,
    grantStatus: input.grantSession?.status,
  })
}

export function withGrantWorkspaceStage(url: string, stage: GrantWorkspaceStage) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return trimmed

  const hashIndex = trimmed.indexOf('#')
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : ''
  const queryIndex = beforeHash.indexOf('?')
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)
  params.set('stage', stage)
  const nextQuery = params.toString()

  return `${path}${nextQuery ? `?${nextQuery}` : ''}${hash}`
}
