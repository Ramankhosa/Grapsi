export type GrantWorkspaceStage = 'GRANTMENTOR' | 'BLUEPRINT'

export function resolveGrantWorkspaceStageForPrepStatus(status?: string | null): GrantWorkspaceStage {
  return status === 'launched' || status === 'handed_off' ? 'BLUEPRINT' : 'GRANTMENTOR'
}

export function buildGrantWorkspaceUrl(input: {
  projectId: string
  grantSessionId?: string | null
  prepStatus?: string | null
  stage?: GrantWorkspaceStage
}) {
  if (!input.grantSessionId) return null
  const stage = input.stage || resolveGrantWorkspaceStageForPrepStatus(input.prepStatus)
  return `/projects/${input.projectId}/grants/${input.grantSessionId}/workspace?stage=${stage}`
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
