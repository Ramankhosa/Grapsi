import type { CompiledGrantTemplateSectionType, GrantWorkflowMode } from '@/types/grant'

export const GRANT_CITATION_MODES = [
  'mapped_evidence',
  'direct_draft',
  'no_citations',
] as const

export type GrantCitationMode = typeof GRANT_CITATION_MODES[number]

function isGrantCitationMode(value: unknown): value is GrantCitationMode {
  return typeof value === 'string' && GRANT_CITATION_MODES.includes(value as GrantCitationMode)
}

export function defaultGrantCitationMode(input: {
  sectionType?: CompiledGrantTemplateSectionType | string | null
  workflowMode?: GrantWorkflowMode | string | null
  suggestedCitationCount?: number | null
}): GrantCitationMode {
  const sectionType = String(input.sectionType || '').trim()
  const workflowMode = String(input.workflowMode || '').trim()
  const suggestedCitationCount = Number.isFinite(Number(input.suggestedCitationCount))
    ? Number(input.suggestedCitationCount)
    : null

  if (sectionType === 'checklist' || sectionType === 'table' || sectionType === 'budget_rows') {
    return 'no_citations'
  }

  if (workflowMode !== 'app_draft') {
    return 'no_citations'
  }

  if (suggestedCitationCount !== null && suggestedCitationCount > 0) {
    return 'mapped_evidence'
  }

  return 'direct_draft'
}

export function normalizeGrantCitationMode(
  value: unknown,
  fallback?: {
    sectionType?: CompiledGrantTemplateSectionType | string | null
    workflowMode?: GrantWorkflowMode | string | null
    suggestedCitationCount?: number | null
  }
): GrantCitationMode {
  if (isGrantCitationMode(value)) {
    return value
  }

  return defaultGrantCitationMode(fallback || {})
}

export function requiresMappedGrantEvidence(citationMode: unknown): boolean {
  return normalizeGrantCitationMode(citationMode) === 'mapped_evidence'
}
