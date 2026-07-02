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

export const GRANT_TEMPLATE_INTENTS = [
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
  'team',
  'budget',
  'eligibility',
  'submission',
  'attachments',
  'institutional',
  'default',
] as const

export type GrantTemplateIntent = typeof GRANT_TEMPLATE_INTENTS[number]

export const GRANT_RULE_CLASSES = [
  'priority',
  'must_address',
  'avoid',
  'evaluation',
  'budget',
  'duration',
  'format',
  'submission',
  'deliverable',
  'reviewer_signal',
  'template_guidance',
  'template_required_fact',
  'template_forbidden_move',
  'prep_evidence',
  'other',
] as const

export type GrantRuleClass = typeof GRANT_RULE_CLASSES[number]

export const GRANT_ENFORCEMENT_LEVELS = [
  'hard',
  'soft',
  'info',
] as const

export type GrantEnforcementLevel = typeof GRANT_ENFORCEMENT_LEVELS[number]

export const GRANT_DRAFTING_SUBMISSION_MODES = [
  'drafting',
  'submission',
  'both',
] as const

export type GrantDraftingSubmissionMode = typeof GRANT_DRAFTING_SUBMISSION_MODES[number]

export interface GrantThematicBlueprint {
  mustCover: string[]
  mustAvoid: string[]
  dimensions?: string[]
  dimensionTyping?: Record<string, GrantBlueprintDimensionType>
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType>
  suggestedCitationCount?: number
}

export interface GrantPrepContextBlock {
  stageKeys: string[]
  bullets: string[]
  keywords: string[]
}

export interface GrantPrepPromptBundle {
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

export interface GrantPrepEvidenceItem {
  stageKey: string
  pointKey: string
  label: string
  sourceTemplatePointer?: string | null
  sectionKeys?: string[]
  keywords: string[]
  thrustLinkage: string[]
  factBullets: string[]
  ruleNotes: string[]
  confidence: number
  captureBasis: string[]
  status: 'covered' | 'needs_review'
}

export interface GrantTemplateGuidanceProfile {
  pointer?: string | null
  guidanceText: string[]
  requiredFacts: string[]
  reviewerGoal?: string | null
  forbiddenMoves: string[]
  draftingVsSubmission: GrantDraftingSubmissionMode
}

export interface GrantBudgetTemplateColumn {
  key: string
  label: string
  kind?: string | null
  required?: boolean
  sourceAnchors?: Array<Record<string, unknown>>
}

export interface GrantBudgetTemplateCategory {
  key: string
  label: string
  cap?: string | null
  notes?: string | null
  sourceAnchors?: Array<Record<string, unknown>>
}

export interface GrantBudgetTemplateScaffold {
  source: 'extracted' | 'fallback'
  required: boolean
  yearWise: boolean
  fixedCategories: boolean
  currency?: string | null
  columns: GrantBudgetTemplateColumn[]
  categories: GrantBudgetTemplateCategory[]
  caps?: Record<string, unknown> | null
  notes?: string | null
  sourceAnchors?: Array<Record<string, unknown>>
  supportLevel?: string | null
  confidence?: number | null
}

export interface GrantSectionComplianceCheck {
  key: string
  label: string
  ruleText: string
  ruleClass: GrantRuleClass
  enforcementLevel: GrantEnforcementLevel
  draftingVsSubmission: GrantDraftingSubmissionMode
  detectorHints: string[]
  source: 'guideline' | 'template' | 'prep' | 'system'
}

export interface GrantSectionComplianceContract {
  requiredPoints: string[]
  evaluationFocus: string[]
  reviewerSignals: string[]
  avoidRules: string[]
  formatConstraints: string[]
  narrativeConstraints: string[]
  prepEvidence: GrantPrepEvidenceItem[]
  templateGuidance: GrantTemplateGuidanceProfile | null
  fundingCallSummary: string[]
  submissionChecklist: string[]
  hardChecks: GrantSectionComplianceCheck[]
  softChecks: GrantSectionComplianceCheck[]
}

export interface GrantGenerationTrace {
  ideaAnchorHash: string | null
  usedAnchorElements: string[]
  anchorConflicts: string[]
  usedPrepEvidence: string[]
  coveredRequiredPoints: string[]
  unmetRequiredPoints: string[]
  violatedAvoidRules: string[]
  openQuestions: string[]
}

export interface GrantComplianceFinding {
  key: string
  message: string
  ruleText?: string | null
  source: 'guideline' | 'template' | 'prep' | 'system'
}

export interface GrantComplianceReport {
  stage: 'blueprint' | 'pass1' | 'pass2' | 'proposal'
  passed: boolean
  coveredRequiredPoints: string[]
  unmetRequiredPoints: string[]
  violatedAvoidRules: string[]
  missingEvidence: string[]
  hardFailures: GrantComplianceFinding[]
  softWarnings: GrantComplianceFinding[]
  usedPrepEvidence: string[]
  generatedAt: string
}

export interface ReviewerReadinessReport {
  score: number
  strengths: string[]
  risks: string[]
  missingSignals: string[]
  recommendedActions: string[]
  generatedAt: string
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
  templateIntent?: GrantTemplateIntent | null
  templateIntentAlternates?: GrantTemplateIntent[]
  templateIntentConfidence?: number | null
  mustCover: string[]
  mustAvoid: string[]
  dimensions?: string[]
  dimensionTyping?: Record<string, GrantBlueprintDimensionType>
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType>
  suggestedCitationCount?: number | null
  thematicBlueprint?: GrantThematicBlueprint | null
  grantSemantic?: GrantSectionSemantic | null
  prepContextBlock?: GrantPrepContextBlock | null
  authoritativePrepBundle?: GrantPrepPromptBundle | null
  relatedPrepAwareness?: GrantPrepPromptBundle | null
  grantRuleProfile?: GrantRuleProfile | null
  grantTemplateGuidance?: GrantTemplateGuidanceProfile | null
  budgetTemplate?: GrantBudgetTemplateScaffold | null
  grantSectionComplianceContract?: GrantSectionComplianceContract | null
  grantComplianceReport?: GrantComplianceReport | null
  reviewerReadinessReport?: ReviewerReadinessReport | null
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
  templateIntent?: GrantTemplateIntent | null
  templateIntentAlternates?: GrantTemplateIntent[]
  templateIntentConfidence?: number | null
  mustCover: string[]
  mustAvoid: string[]
  dimensions?: string[]
  dimensionTyping?: Record<string, GrantBlueprintDimensionType>
  mustCoverTyping?: Record<string, GrantBlueprintDimensionType>
  suggestedCitationCount?: number | null
  thematicBlueprint?: GrantThematicBlueprint | null
  seededContext: string
  grantSemantic?: GrantSectionSemantic | null
  prepContextBlock?: GrantPrepContextBlock | null
  authoritativePrepBundle?: GrantPrepPromptBundle | null
  relatedPrepAwareness?: GrantPrepPromptBundle | null
  grantRuleProfile?: GrantRuleProfile | null
  grantTemplateGuidance?: GrantTemplateGuidanceProfile | null
  budgetTemplate?: GrantBudgetTemplateScaffold | null
  grantSectionComplianceContract?: GrantSectionComplianceContract | null
  grantComplianceReport?: GrantComplianceReport | null
  reviewerReadinessReport?: ReviewerReadinessReport | null
  ideaAnchorHash?: string | null
  ideaAnchorRelationship?: 'identity_bearing' | 'supporting' | 'neutral'
  anchorReviewRequired?: boolean
  manualOverrideAnchorHash?: string | null
}
