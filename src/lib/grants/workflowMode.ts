import { GRANT_WORKFLOW_MODES, type CompiledGrantTemplateSectionType, type GrantWorkflowMode } from '@/types/grant'

const WORKFLOW_MODE_SET = new Set<string>(GRANT_WORKFLOW_MODES)

export function normalizeGrantWorkflowMode(
  value: unknown,
  fallback: GrantWorkflowMode = 'team_manual'
): GrantWorkflowMode {
  const normalized = String(value || '').trim().toLowerCase()
  return WORKFLOW_MODE_SET.has(normalized)
    ? (normalized as GrantWorkflowMode)
    : fallback
}

export function isGrantWorkflowAppDraft(workflowMode: unknown): boolean {
  return normalizeGrantWorkflowMode(workflowMode) === 'app_draft'
}

export function isGrantWorkflowManualDrafting(workflowMode: unknown): boolean {
  return !isGrantWorkflowAppDraft(workflowMode)
}

export function getGrantWorkflowBadgeLabel(workflowMode: unknown): string {
  return isGrantWorkflowAppDraft(workflowMode) ? 'App Draft' : 'Manual Drafting'
}

export function getGrantWorkflowManualDetail(workflowMode: unknown): string | null {
  switch (normalizeGrantWorkflowMode(workflowMode)) {
    case 'app_support':
      return 'Support section'
    case 'team_manual':
      return 'Team-owned section'
    default:
      return null
  }
}

export function isGrantSectionAutoDraftable(input: {
  sectionType: CompiledGrantTemplateSectionType | string
  workflowMode: unknown
}): boolean {
  return (
    isGrantWorkflowAppDraft(input.workflowMode)
    && (input.sectionType === 'narrative' || input.sectionType === 'short_answer')
  )
}
