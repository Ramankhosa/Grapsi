export type GrantWorkspaceStage =
  | 'GRANTMENTOR'
  | 'BLUEPRINT'
  | 'LITERATURE_SEARCH'
  | 'FULL_TEXT_EVIDENCE_EXTRACTION'
  | 'FIGURE_PLANNER'
  | 'SECTION_DRAFTING'
  | 'REVIEWER'

export function resolveGrantWorkspaceStageForPrepStatus(status?: string | null): GrantWorkspaceStage {
  return status === 'launched' || status === 'handed_off' ? 'BLUEPRINT' : 'GRANTMENTOR'
}

export function resolveGrantWorkspaceStageForGrantStatus(status?: string | null): GrantWorkspaceStage | null {
  switch (String(status || '').toUpperCase()) {
    case 'BLUEPRINT':
      return 'BLUEPRINT'
    case 'DRAFTING':
      return 'SECTION_DRAFTING'
    case 'REVIEW':
      return 'REVIEWER'
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
