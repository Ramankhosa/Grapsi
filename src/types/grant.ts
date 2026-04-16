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
  required: boolean
  wordBudget?: number | null
  characterLimit?: number | null
  purpose: string
  reviewerIntent?: string | null
  dependencies: string[]
  sourceTemplatePointer?: string | null
  mustCover: string[]
  mustAvoid: string[]
}

export interface CompiledGrantTemplate {
  version: string
  fundingCallId: string
  templateRevisionId: string
  guidelineRevisionId?: string | null
  sections: CompiledGrantTemplateSection[]
}
