const METHODOLOGY_TYPE_VALUES = [
  'QUALITATIVE',
  'QUANTITATIVE',
  'MIXED_METHODS',
  'THEORETICAL',
  'CASE_STUDY',
  'ACTION_RESEARCH',
  'EXPERIMENTAL',
  'SURVEY',
  'OTHER'
] as const;

const CONTRIBUTION_TYPE_VALUES = [
  'THEORETICAL',
  'EMPIRICAL',
  'METHODOLOGICAL',
  'APPLIED',
  'REVIEW',
  'CONCEPTUAL'
] as const;

type MethodologyTypeValue = typeof METHODOLOGY_TYPE_VALUES[number];
type ContributionTypeValue = typeof CONTRIBUTION_TYPE_VALUES[number];

export interface PersistableTopicFields {
  title: string | null;
  field: string | null;
  subfield: string | null;
  topicDescription: string | null;
  researchQuestion: string | null;
  subQuestions: string[];
  problemStatement: string | null;
  researchGaps: string | null;
  methodology: MethodologyTypeValue | null;
  methodologyApproach: string | null;
  techniques: string[];
  methodologyJustification: string | null;
  datasetDescription: string | null;
  dataCollection: string | null;
  sampleSize: string | null;
  tools: string[];
  experiments: string | null;
  hypothesis: string | null;
  expectedResults: string | null;
  contributionType: ContributionTypeValue | null;
  novelty: string | null;
  limitations: string | null;
  keywords: string[];
  abstractDraft: string | null;
}

export interface NormalizedTopicExtraction extends PersistableTopicFields {
  confidence: number | null;
  extractionNotes: string | null;
  sourceHighlights: string[];
}

const METHODOLOGY_ALIASES: Record<string, MethodologyTypeValue> = {
  qualitative: 'QUALITATIVE',
  qualitative_study: 'QUALITATIVE',
  quantitative: 'QUANTITATIVE',
  quantitative_study: 'QUANTITATIVE',
  mixed: 'MIXED_METHODS',
  mixed_methods: 'MIXED_METHODS',
  mixed_methods_study: 'MIXED_METHODS',
  theoretical: 'THEORETICAL',
  theoretical_study: 'THEORETICAL',
  conceptual: 'THEORETICAL',
  case_study: 'CASE_STUDY',
  action_research: 'ACTION_RESEARCH',
  experimental: 'EXPERIMENTAL',
  experimental_study: 'EXPERIMENTAL',
  survey: 'SURVEY',
  survey_study: 'SURVEY',
  other: 'OTHER',
  literature_review: 'THEORETICAL',
  review: 'THEORETICAL'
};

const CONTRIBUTION_ALIASES: Record<string, ContributionTypeValue> = {
  theoretical: 'THEORETICAL',
  empirical: 'EMPIRICAL',
  methodological: 'METHODOLOGICAL',
  methodology: 'METHODOLOGICAL',
  applied: 'APPLIED',
  practical: 'APPLIED',
  review: 'REVIEW',
  literature_review: 'REVIEW',
  conceptual: 'CONCEPTUAL'
};

const PLACEHOLDER_RESEARCH_QUESTIONS = new Set([
  '',
  'to be defined',
  'research question to be defined'
]);

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pickFirst(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source && source[key] !== undefined) {
      return source[key];
    }
  }

  const normalizedSource = new Map<string, unknown>();
  for (const [key, value] of Object.entries(source)) {
    normalizedSource.set(normalizeKey(key), value);
  }

  for (const key of keys) {
    const candidate = normalizedSource.get(normalizeKey(key));
    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/\r\n/g, '\n').trim();
    return cleaned.length > 0 ? cleaned : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  return null;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const item of value) {
    const text = cleanText(item);
    if (!text) continue;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(text);
  }

  return cleaned;
}

function normalizeEnumValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  aliases: Record<string, T>
): T | null {
  const text = cleanText(value);
  if (!text) return null;

  const upper = text.toUpperCase().replace(/\s+/g, '_');
  if ((allowedValues as readonly string[]).includes(upper)) {
    return upper as T;
  }

  const normalized = normalizeKey(text);
  return aliases[normalized] || null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  return null;
}

function pickTextField(source: Record<string, unknown>, ...keys: string[]): string | null {
  return cleanText(pickFirst(source, keys));
}

function pickArrayField(source: Record<string, unknown>, ...keys: string[]): string[] {
  return cleanStringArray(pickFirst(source, keys));
}

function pickMethodology(source: Record<string, unknown>): MethodologyTypeValue | null {
  return normalizeEnumValue(
    pickFirst(source, ['methodology', 'methodologyType', 'methodology_type']),
    METHODOLOGY_TYPE_VALUES,
    METHODOLOGY_ALIASES
  );
}

function pickContributionType(source: Record<string, unknown>): ContributionTypeValue | null {
  return normalizeEnumValue(
    pickFirst(source, ['contributionType', 'contribution_type']),
    CONTRIBUTION_TYPE_VALUES,
    CONTRIBUTION_ALIASES
  );
}

function pickNonEmptyArray(nextValue: unknown, existingValue: unknown): string[] {
  const next = cleanStringArray(nextValue);
  if (next.length > 0) return next;
  return cleanStringArray(existingValue);
}

function pickNonEmptyText(nextValue: unknown, existingValue: unknown): string | null {
  return cleanText(nextValue) ?? cleanText(existingValue);
}

export function normalizeTopicExtraction(raw: Record<string, unknown>): NormalizedTopicExtraction {
  const source = asRecord(raw);

  return {
    title: pickTextField(source, 'title'),
    field: pickTextField(source, 'field'),
    subfield: pickTextField(source, 'subfield'),
    topicDescription: pickTextField(source, 'topicDescription', 'topic_description'),
    researchQuestion: pickTextField(source, 'researchQuestion', 'research_question'),
    subQuestions: pickArrayField(source, 'subQuestions', 'sub_questions'),
    problemStatement: pickTextField(source, 'problemStatement', 'problem_statement'),
    researchGaps: pickTextField(source, 'researchGaps', 'research_gaps'),
    methodology: pickMethodology(source),
    methodologyApproach: pickTextField(source, 'methodologyApproach', 'methodology_approach'),
    techniques: pickArrayField(source, 'techniques'),
    methodologyJustification: pickTextField(source, 'methodologyJustification', 'methodology_justification'),
    datasetDescription: pickTextField(source, 'datasetDescription', 'dataset_description'),
    dataCollection: pickTextField(source, 'dataCollection', 'data_collection'),
    sampleSize: pickTextField(source, 'sampleSize', 'sample_size'),
    tools: pickArrayField(source, 'tools'),
    experiments: pickTextField(source, 'experiments'),
    hypothesis: pickTextField(source, 'hypothesis'),
    expectedResults: pickTextField(source, 'expectedResults', 'expected_results', 'reportedResults', 'reported_results'),
    contributionType: pickContributionType(source),
    novelty: pickTextField(source, 'novelty'),
    limitations: pickTextField(source, 'limitations'),
    keywords: pickArrayField(source, 'keywords'),
    abstractDraft: pickTextField(source, 'abstractDraft', 'abstract_draft', 'summary', 'paper_summary'),
    confidence: normalizeConfidence(pickFirst(source, ['confidence'])),
    extractionNotes: pickTextField(source, 'extractionNotes', 'extraction_notes', 'notes'),
    sourceHighlights: pickArrayField(source, 'sourceHighlights', 'source_highlights', 'keyDetails', 'key_details')
  };
}

export function mergePersistableTopic(
  existing: Partial<PersistableTopicFields> | null | undefined,
  extracted: Partial<PersistableTopicFields>
): PersistableTopicFields {
  const current = asRecord(existing);
  const next = asRecord(extracted);

  return {
    title: pickNonEmptyText(next.title, current.title) || 'Untitled Research',
    field: pickNonEmptyText(next.field, current.field),
    subfield: pickNonEmptyText(next.subfield, current.subfield),
    topicDescription: pickNonEmptyText(next.topicDescription, current.topicDescription),
    researchQuestion: pickNonEmptyText(next.researchQuestion, current.researchQuestion) || 'Research question to be defined',
    subQuestions: pickNonEmptyArray(next.subQuestions, current.subQuestions),
    problemStatement: pickNonEmptyText(next.problemStatement, current.problemStatement),
    researchGaps: pickNonEmptyText(next.researchGaps, current.researchGaps),
    methodology:
      normalizeEnumValue(next.methodology, METHODOLOGY_TYPE_VALUES, METHODOLOGY_ALIASES) ||
      normalizeEnumValue(current.methodology, METHODOLOGY_TYPE_VALUES, METHODOLOGY_ALIASES) ||
      'OTHER',
    methodologyApproach: pickNonEmptyText(next.methodologyApproach, current.methodologyApproach),
    techniques: pickNonEmptyArray(next.techniques, current.techniques),
    methodologyJustification: pickNonEmptyText(next.methodologyJustification, current.methodologyJustification),
    datasetDescription: pickNonEmptyText(next.datasetDescription, current.datasetDescription),
    dataCollection: pickNonEmptyText(next.dataCollection, current.dataCollection),
    sampleSize: pickNonEmptyText(next.sampleSize, current.sampleSize),
    tools: pickNonEmptyArray(next.tools, current.tools),
    experiments: pickNonEmptyText(next.experiments, current.experiments),
    hypothesis: pickNonEmptyText(next.hypothesis, current.hypothesis),
    expectedResults: pickNonEmptyText(next.expectedResults, current.expectedResults),
    contributionType:
      normalizeEnumValue(next.contributionType, CONTRIBUTION_TYPE_VALUES, CONTRIBUTION_ALIASES) ||
      normalizeEnumValue(current.contributionType, CONTRIBUTION_TYPE_VALUES, CONTRIBUTION_ALIASES) ||
      'EMPIRICAL',
    novelty: pickNonEmptyText(next.novelty, current.novelty),
    limitations: pickNonEmptyText(next.limitations, current.limitations),
    keywords: pickNonEmptyArray(next.keywords, current.keywords),
    abstractDraft: pickNonEmptyText(next.abstractDraft, current.abstractDraft)
  };
}

export function prepareDocumentContentForExtraction(content: string, maxChars = 48000): string {
  const normalized = String(content || '').replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const separator = '\n\n[... middle of document omitted for extraction, beginning and ending preserved ...]\n\n';
  const available = Math.max(0, maxChars - separator.length);
  const headChars = Math.ceil(available * 0.6);
  const tailChars = Math.max(0, available - headChars);

  return `${normalized.slice(0, headChars).trimEnd()}${separator}${normalized.slice(-tailChars).trimStart()}`;
}

export function hasMeaningfulTopicContent(topic: unknown): boolean {
  const source = asRecord(topic);
  const researchQuestion = cleanText(source.researchQuestion)?.toLowerCase() || '';

  if (!PLACEHOLDER_RESEARCH_QUESTIONS.has(researchQuestion)) {
    return true;
  }

  const meaningfulTextFields = [
    'field',
    'subfield',
    'topicDescription',
    'problemStatement',
    'researchGaps',
    'methodologyApproach',
    'methodologyJustification',
    'datasetDescription',
    'dataCollection',
    'sampleSize',
    'experiments',
    'hypothesis',
    'expectedResults',
    'novelty',
    'limitations',
    'abstractDraft'
  ];

  if (meaningfulTextFields.some((fieldName) => Boolean(cleanText(source[fieldName])))) {
    return true;
  }

  if (
    cleanStringArray(source.subQuestions).length > 0 ||
    cleanStringArray(source.techniques).length > 0 ||
    cleanStringArray(source.tools).length > 0 ||
    cleanStringArray(source.keywords).length > 0
  ) {
    return true;
  }

  const methodology = normalizeEnumValue(source.methodology, METHODOLOGY_TYPE_VALUES, METHODOLOGY_ALIASES);
  if (methodology && methodology !== 'OTHER') {
    return true;
  }

  return false;
}
