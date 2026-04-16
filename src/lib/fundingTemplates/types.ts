export const FUNDING_TEMPLATE_ITEM_TYPES = [
  'field',
  'section',
  'table',
  'budget',
  'attachment',
  'checklist',
  'rule',
  'rubric',
] as const;

export const FUNDING_TEMPLATE_SUPPORT_LEVELS = [
  'full',
  'partial',
  'manual',
  'unsupported',
] as const;

export type FundingTemplateItemType = typeof FUNDING_TEMPLATE_ITEM_TYPES[number];
export type FundingTemplateSupportLevel = typeof FUNDING_TEMPLATE_SUPPORT_LEVELS[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface FundingTemplateSourceAnchor {
  asset_id: string;
  page?: number | null;
  section?: string | null;
  urlFragment?: string | null;
  quote?: string | null;
  note?: string | null;
  confidence?: number | null;
}

export interface FundingTemplateItem {
  key: string;
  label: string;
  type: FundingTemplateItemType;
  required: boolean;
  repeatable: boolean;
  visibleWhen?: string | null;
  wordLimit?: number | null;
  charLimit?: number | null;
  options?: string[];
  schema?: JsonValue | null;
  guidance?: string | null;
  supportLevel: FundingTemplateSupportLevel;
  confidence: number;
  sourceAnchors: FundingTemplateSourceAnchor[];
}

export interface FundingTemplateBudgetCategory {
  key: string;
  label: string;
  cap?: string | null;
  notes?: string | null;
  sourceAnchors: FundingTemplateSourceAnchor[];
}

export interface FundingTemplateBudget {
  required: boolean;
  yearWise: boolean;
  categories: FundingTemplateBudgetCategory[];
  caps?: Record<string, JsonValue> | null;
  justificationNotes?: string | null;
  supportLevel: FundingTemplateSupportLevel;
  confidence: number;
  sourceAnchors: FundingTemplateSourceAnchor[];
}

export interface FundingTemplateSubmissionRules {
  notes?: string | null;
  items: FundingTemplateItem[];
  sourceAnchors: FundingTemplateSourceAnchor[];
}

export interface FundingTemplateMergeConflict {
  block: 'questions' | 'sections' | 'attachments' | 'evaluationCriteria' | 'submissionRules' | 'budget';
  key: string;
  existingItem: JsonValue;
  incomingItem: JsonValue;
  runId?: string | null;
  createdAt: string;
  message: string;
}

export interface GrantTemplateDocument {
  questions: FundingTemplateItem[];
  sections: FundingTemplateItem[];
  budget: FundingTemplateBudget | null;
  attachments: FundingTemplateItem[];
  evaluationCriteria: FundingTemplateItem[];
  submissionRules: FundingTemplateSubmissionRules;
  sourceAnchors: FundingTemplateSourceAnchor[];
  mergeConflicts: FundingTemplateMergeConflict[];
}

export interface FundingTemplateCompatibilitySummary {
  supportCounts: Record<FundingTemplateSupportLevel, number>;
  blockCounts: Record<string, number>;
  conflicts: FundingTemplateMergeConflict[];
  warnings: string[];
  updatedAt: string;
  lastRunId?: string | null;
}
