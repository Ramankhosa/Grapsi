import type {
  GrantDraftingSubmissionMode,
  GrantEnforcementLevel,
  GrantRuleClass,
} from '@/types/grant'

export const FUNDING_GUIDELINE_BLOCK_KEYS = [
  'priorities',
  'mustAddress',
  'avoid',
  'evaluationCriteria',
  'budgetRules',
  'durationRules',
  'formatRules',
  'submissionRules',
  'deliverableRules',
  'reviewerSignals',
] as const;

export const FUNDING_GUIDELINE_RULE_IMPORTANCE = [
  'high',
  'medium',
  'low',
] as const;

export const FUNDING_GUIDELINE_SOURCE_TYPES = [
  'raw_text',
  'normalized_text',
  'official_url',
  'field',
  'manual',
] as const;

export type FundingGuidelineBlockKey = typeof FUNDING_GUIDELINE_BLOCK_KEYS[number];
export type FundingGuidelineRuleImportance = typeof FUNDING_GUIDELINE_RULE_IMPORTANCE[number];
export type FundingGuidelineSourceType = typeof FUNDING_GUIDELINE_SOURCE_TYPES[number];

export interface FundingGuidelineSourceAnchor {
  sourceType: FundingGuidelineSourceType;
  fieldKey?: string | null;
  url?: string | null;
  quote?: string | null;
  note?: string | null;
  confidence?: number | null;
}

export interface FundingGuidelineRuleItem {
  key: string;
  text: string;
  importance: FundingGuidelineRuleImportance;
  ruleClass?: GrantRuleClass;
  enforcementLevel?: GrantEnforcementLevel;
  appliesTo?: string[];
  draftingStage?: string[];
  draftingVsSubmission?: GrantDraftingSubmissionMode;
  detectorHints?: string[];
  sourceBlock?: FundingGuidelineBlockKey;
  rationale?: string | null;
  confidence: number;
  sourceAnchors: FundingGuidelineSourceAnchor[];
}

export interface GuidelinePackDocument {
  priorities: FundingGuidelineRuleItem[];
  mustAddress: FundingGuidelineRuleItem[];
  avoid: FundingGuidelineRuleItem[];
  evaluationCriteria: FundingGuidelineRuleItem[];
  budgetRules: FundingGuidelineRuleItem[];
  durationRules: FundingGuidelineRuleItem[];
  formatRules: FundingGuidelineRuleItem[];
  submissionRules: FundingGuidelineRuleItem[];
  deliverableRules: FundingGuidelineRuleItem[];
  reviewerSignals: FundingGuidelineRuleItem[];
  sourceAnchors: FundingGuidelineSourceAnchor[];
}

export interface FundingGuidelineSummary {
  blockCounts: Record<FundingGuidelineBlockKey, number>;
  totalRules: number;
  updatedAt: string;
}
