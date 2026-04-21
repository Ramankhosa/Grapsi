export const GRANT_WORKFLOW_MODES = [
  'app_draft',
  'app_support',
  'team_manual',
] as const

export type GrantWorkflowMode = typeof GRANT_WORKFLOW_MODES[number]

export const GRANT_CITATION_MODES = [
  'mapped_evidence',
  'direct_draft',
  'no_citations',
] as const

export type GrantCitationMode = typeof GRANT_CITATION_MODES[number]

export const GRANT_BLUEPRINT_DIMENSION_TYPES = [
  'foundational',
  'methodological',
  'empirical',
  'comparative',
  'gap',
] as const

export type GrantBlueprintDimensionType = typeof GRANT_BLUEPRINT_DIMENSION_TYPES[number]

export const GRANT_SECTION_SEMANTICS = [
  'summary',
  'problem_need',
  'objectives',
  'methodology',
  'workplan',
  'innovation',
  'evaluation',
  'impact_outcomes',
  'alignment',
  'sustainability',
  'risk',
  'default',
] as const

export type GrantSectionSemantic = typeof GRANT_SECTION_SEMANTICS[number]

export interface GrantThematicBlueprint {
  mustCover: string[]
  mustAvoid: string[]
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType>
  suggestedCitationCount?: number
}

export interface GrantPrepContextBlock {
  stageKeys: string[]
  bullets: string[]
  keywords: string[]
}

export interface GrantRuleProfile {
  requiredPoints: string[]
  evaluationFocus: string[]
  reviewerSignals: string[]
  avoidRules: string[]
  formatConstraints: string[]
  narrativeConstraints: string[]
}

export interface GrantBlueprintDimensionTarget {
  sectionKey: string
  dimension: string
  dimensionType?: GrantBlueprintDimensionType
}

export type FundingVisibility = 'GLOBAL_PUBLISHED' | 'TENANT_PRIVATE'

export type FundingStatus =
  | 'INGESTING'
  | 'READY_FOR_REVIEW'
  | 'PUBLISHED'
  | 'ARCHIVED'
  | 'FAILED'

export type GrantSessionStatus =
  | 'SETUP'
  | 'PREP_OPTIONAL'
  | 'BLUEPRINT'
  | 'DRAFTING'
  | 'REVIEW'
  | 'EXPORT_READY'
  | 'COMPLETED'

export type CompiledGrantTemplateSectionType =
  | 'narrative'
  | 'short_answer'
  | 'checklist'
  | 'table'
  | 'budget_rows'

export interface CompiledGrantTemplateSection {
  sectionKey: string
  label: string
  order: number
  sectionType: CompiledGrantTemplateSectionType
  workflowMode: GrantWorkflowMode
  citationMode?: GrantCitationMode | null
  required: boolean
  wordBudget?: number | null
  characterLimit?: number | null
  purpose: string
  reviewerIntent?: string | null
  dependencies: string[]
  sourceTemplatePointer?: string | null
  mustCover: string[]
  mustAvoid: string[]
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType>
  suggestedCitationCount?: number | null
  thematicBlueprint?: GrantThematicBlueprint | null
  grantSemantic?: GrantSectionSemantic | null
  prepContextBlock?: GrantPrepContextBlock | null
  grantRuleProfile?: GrantRuleProfile | null
}

export interface CompiledGrantTemplate {
  version: string
  fundingCallId: string
  templateRevisionId: string
  guidelineRevisionId?: string | null
  sections: CompiledGrantTemplateSection[]
}

export interface GrantBlueprintPlanSection {
  sectionKey: string
  label: string
  order: number
  sectionType: CompiledGrantTemplateSectionType
  workflowMode: GrantWorkflowMode
  citationMode?: GrantCitationMode | null
  required: boolean
  wordBudget: number | null
  characterLimit: number | null
  purpose: string
  reviewerIntent: string | null
  dependencies: string[]
  sourceTemplatePointer: string | null
  mustCover: string[]
  mustAvoid: string[]
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType>
  suggestedCitationCount?: number | null
  thematicBlueprint?: GrantThematicBlueprint | null
  seededContext: string
  grantSemantic?: GrantSectionSemantic | null
  prepContextBlock?: GrantPrepContextBlock | null
  grantRuleProfile?: GrantRuleProfile | null
}
