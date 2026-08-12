import type { FundingCallDocumentSectionType } from '@prisma/client';

export const FUNDING_DOC_PAGE_TRANSCRIBE_STAGE_CODE = 'FUNDING_DOC_PAGE_TRANSCRIBE';
export const FUNDING_DOC_SECTION_CLASSIFY_STAGE_CODE = 'FUNDING_DOC_SECTION_CLASSIFY';
export const FUNDING_DOC_QA_STAGE_CODE = 'FUNDING_DOC_QA';

export const FUNDING_DOCUMENT_SECTION_TYPES = [
  'overview',
  'objectives',
  'thematic_areas',
  'eligibility',
  'funding_support',
  'budget_rules',
  'duration',
  'important_dates',
  'evaluation_criteria',
  'exclusions',
  'application_process',
  'required_documents',
  'consortium_partner_rules',
  'intellectual_property_rules',
  'reporting_requirements',
  'contact_details',
  'corrigendum_or_amendment',
  'other',
] as const satisfies readonly FundingCallDocumentSectionType[];

export type FundingDocumentSectionType = (typeof FUNDING_DOCUMENT_SECTION_TYPES)[number];

export const PROTECTED_SINGLE_CHUNK_SECTION_TYPES = new Set<FundingDocumentSectionType>([
  'eligibility',
  'budget_rules',
  'important_dates',
  'evaluation_criteria',
]);

/** Section types the guideline extractor should read (rules that affect drafting/fit). */
export const GUIDELINE_SECTION_TYPES = [
  'eligibility',
  'funding_support',
  'budget_rules',
  'duration',
  'important_dates',
  'evaluation_criteria',
  'exclusions',
  'application_process',
  'required_documents',
  'consortium_partner_rules',
  'intellectual_property_rules',
  'reporting_requirements',
] as const satisfies readonly FundingDocumentSectionType[];

/** Section types that describe the application's format — the template extractor's input. */
export const TEMPLATE_SECTION_TYPES = [
  'application_process',
  'required_documents',
  'budget_rules',
  'reporting_requirements',
  'evaluation_criteria',
] as const satisfies readonly FundingDocumentSectionType[];

type KeywordRule = {
  type: FundingDocumentSectionType;
  patterns: RegExp[];
};

export const SECTION_KEYWORD_RULES: KeywordRule[] = [
  {
    type: 'eligibility',
    patterns: [/eligib/i, /who can apply/i, /eligible applicants/i, /applicant criteria/i, /qualification/i],
  },
  {
    type: 'funding_support',
    patterns: [/funding support/i, /grant support/i, /financial support/i, /award amount/i, /assistance/i],
  },
  {
    type: 'budget_rules',
    patterns: [/budget/i, /eligible cost/i, /cost sharing/i, /overheads?/i, /indirect costs?/i, /financial rules/i],
  },
  {
    type: 'important_dates',
    patterns: [/important dates?/i, /deadline/i, /closing date/i, /last date/i, /timeline/i, /schedule/i, /opening date/i],
  },
  {
    type: 'evaluation_criteria',
    patterns: [/evaluation/i, /review criteria/i, /selection criteria/i, /assessment criteria/i, /scoring/i],
  },
  {
    type: 'exclusions',
    patterns: [/exclusions?/i, /not eligible/i, /ineligible/i, /restrictions?/i, /limitations?/i],
  },
  {
    type: 'application_process',
    patterns: [/application process/i, /how to apply/i, /submission/i, /apply online/i, /proposal submission/i],
  },
  {
    type: 'required_documents',
    patterns: [/required documents?/i, /attachments?/i, /supporting documents?/i, /documents to submit/i],
  },
  {
    type: 'consortium_partner_rules',
    patterns: [/consortium/i, /partners?/i, /collaboration/i, /joint proposal/i, /co-applicants?/i],
  },
  {
    type: 'intellectual_property_rules',
    patterns: [/intellectual property/i, /\bip\b/i, /patents?/i, /technology transfer/i],
  },
  {
    type: 'reporting_requirements',
    patterns: [/reporting/i, /progress report/i, /deliverables?/i, /monitoring/i, /milestones?/i],
  },
  {
    type: 'contact_details',
    patterns: [/contact/i, /helpdesk/i, /email/i, /phone/i, /enquiries/i],
  },
  {
    type: 'corrigendum_or_amendment',
    patterns: [/corrigendum/i, /amendment/i, /addendum/i, /revised/i, /update notice/i],
  },
  {
    type: 'duration',
    patterns: [/duration/i, /project period/i, /tenure/i, /months/i, /years/i],
  },
  {
    type: 'thematic_areas',
    patterns: [/thematic/i, /priority areas?/i, /research areas?/i, /scope/i, /topics?/i, /thrust areas?/i],
  },
  {
    type: 'objectives',
    patterns: [/objectives?/i, /aims?/i, /goals?/i, /purpose/i],
  },
  {
    type: 'overview',
    patterns: [/overview/i, /background/i, /introduction/i, /about the scheme/i, /programme summary/i],
  },
];

export type FundingDocumentQuestionCategory =
  | 'eligibility'
  | 'budget'
  | 'dates'
  | 'documents'
  | 'thematic'
  | 'process'
  | 'contact'
  | 'general';

export function classifyQuestionCategoryHeuristic(question: string): FundingDocumentQuestionCategory {
  const normalized = question.toLowerCase();
  if (/\b(eligib|who can apply|can i apply|institution|career|citizenship|residen|partner|consortium)\b/.test(normalized)) {
    return 'eligibility';
  }
  if (/\b(budget|amount|money|cost|expense|overhead|funding|grant size|support)\b/.test(normalized)) {
    return 'budget';
  }
  if (/\b(deadline|date|when|timeline|schedule|open|close|last date)\b/.test(normalized)) {
    return 'dates';
  }
  if (/\b(document|attachment|certificate|proposal|form|upload)\b/.test(normalized)) {
    return 'documents';
  }
  if (/\b(topic|theme|priority|research area|scope|objective|evaluation|review)\b/.test(normalized)) {
    return 'thematic';
  }
  if (/\b(apply|submit|portal|process|procedure|steps)\b/.test(normalized)) {
    return 'process';
  }
  if (/\b(contact|email|phone|helpdesk|query)\b/.test(normalized)) {
    return 'contact';
  }
  return 'general';
}

export function sectionTypesForQuestionCategory(
  category: FundingDocumentQuestionCategory
): FundingDocumentSectionType[] {
  switch (category) {
    case 'eligibility':
      return ['eligibility', 'consortium_partner_rules', 'exclusions'];
    case 'budget':
      return ['budget_rules', 'funding_support'];
    case 'dates':
      return ['important_dates', 'corrigendum_or_amendment'];
    case 'documents':
      return ['required_documents', 'application_process'];
    case 'thematic':
      return ['thematic_areas', 'objectives', 'overview', 'evaluation_criteria'];
    case 'process':
      return ['application_process', 'required_documents', 'important_dates'];
    case 'contact':
      return ['contact_details', 'application_process'];
    default:
      return [...FUNDING_DOCUMENT_SECTION_TYPES];
  }
}

export function inferSectionTypeFromTitle(title: string): FundingDocumentSectionType | null {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  for (const rule of SECTION_KEYWORD_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.type;
    }
  }

  return null;
}

export function isFundingDocumentSectionType(value: string): value is FundingDocumentSectionType {
  return (FUNDING_DOCUMENT_SECTION_TYPES as readonly string[]).includes(value);
}
