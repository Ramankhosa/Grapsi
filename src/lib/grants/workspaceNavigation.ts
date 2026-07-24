import { isFeatureEnabled } from '@/lib/feature-flags'

export type GrantWorkspaceStage =
  | 'GRANTMENTOR'
  | 'BLUEPRINT'
  | 'LITERATURE_SEARCH'
  | 'FULL_TEXT_EVIDENCE_EXTRACTION'
  | 'FIGURE_PLANNER'
  | 'DIAGRAM_STUDIO'
  | 'SECTION_DRAFTING'
  | 'REVIEWER'

/**
 * Which optional evidence stages the author opted into at Draft Zero launch.
 * Chosen once in the launch modal and stored in the blueprint freeze payload,
 * so the workspace can present one linear route instead of every stage.
 */
export interface GrantPipelinePrefs {
  literatureSearch: boolean
  deepAnalysis: boolean
}

export const DEFAULT_GRANT_PIPELINE_PREFS: GrantPipelinePrefs = {
  literatureSearch: true,
  deepAnalysis: false,
}

/**
 * Stages that are always part of the streamlined route, in order. Everything
 * before drafting is opt-in; Blueprint and the GrantMentor chat are replaced by
 * Draft Zero and stay reachable only by direct URL.
 */
const GRANT_PIPELINE_CORE_STAGES: GrantWorkspaceStage[] = ['SECTION_DRAFTING', 'REVIEWER']

/**
 * Returns null for sessions launched before the pipeline prefs existed, so the
 * workspace can fall back to showing every stage instead of silently hiding
 * ones a legacy grant still depends on.
 */
export function normalizeGrantPipelinePrefs(value: unknown): GrantPipelinePrefs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<GrantPipelinePrefs>
  if (typeof record.literatureSearch !== 'boolean' && typeof record.deepAnalysis !== 'boolean') {
    return null
  }
  const literatureSearch = record.literatureSearch === true
  return {
    literatureSearch,
    // Deep analysis needs papers mapped by literature search; it can never
    // stand alone even if a stale payload says otherwise.
    deepAnalysis: literatureSearch && record.deepAnalysis === true,
  }
}

/** The ordered stage route for a grant, given its recorded pipeline choices. */
export function buildGrantPipelineStages(prefs: GrantPipelinePrefs): GrantWorkspaceStage[] {
  return [
    ...(prefs.literatureSearch ? (['LITERATURE_SEARCH'] as GrantWorkspaceStage[]) : []),
    ...(prefs.literatureSearch && prefs.deepAnalysis
      ? (['FULL_TEXT_EVIDENCE_EXTRACTION'] as GrantWorkspaceStage[])
      : []),
    ...GRANT_PIPELINE_CORE_STAGES,
  ]
}

/** Where a launch lands: the first stage of the author's chosen route. */
export function resolveGrantPipelineEntryStage(prefs: GrantPipelinePrefs): GrantWorkspaceStage {
  return buildGrantPipelineStages(prefs)[0]
}

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
