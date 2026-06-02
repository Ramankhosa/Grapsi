import type { GuidelinePackDocument } from '../fundingGuidelines/types';
import { createEmptyGuidelinePack, normalizeGuidelinePack } from '../fundingGuidelines/utils';
import type { GrantTemplateDocument } from '../fundingTemplates/types';
import { createEmptyGrantTemplate, normalizeGrantTemplate } from '../fundingTemplates/utils';
import { FUNDING_FIELD_DEFINITIONS, type FundingFieldKey } from './constants';
import type { FundingExtractionPayload } from './types';
import {
  buildDraftValuesFromExtraction,
  normalizeExtractionPayload,
  normalizeMultilineText,
} from './utils';
export { FUNDING_JSON_UPLOAD_CHATGPT_PROMPT } from './jsonPrompt';

export const FUNDING_JSON_UPLOAD_PROMPT_VERSION = 'funding-json-upload-v2';
export const FUNDING_JSON_UPLOAD_EXTRACTOR_MODEL = 'external-chatgpt-json';
export const FUNDING_JSON_UPLOAD_EXTRACTOR_VERSION = 'json-ingestion-v1';

type JsonRecord = Record<string, unknown>;

const TEMPLATE_ARRAY_BLOCKS = ['questions', 'sections', 'attachments', 'evaluationCriteria'] as const;
const TEMPLATE_ITEM_TYPES = new Set(['field', 'section', 'table', 'budget', 'attachment', 'checklist', 'rule', 'rubric']);
const TEMPLATE_WORKFLOW_MODES = new Set(['app_draft', 'app_support', 'team_manual']);
const TEMPLATE_SUPPORT_LEVELS = new Set(['full', 'partial', 'manual', 'unsupported']);
const TEMPLATE_MERGE_CONFLICT_BLOCKS = new Set([
  'questions',
  'sections',
  'attachments',
  'evaluationCriteria',
  'submissionRules',
  'budget',
]);

const FIELD_ALIASES: Record<FundingFieldKey, string[]> = {
  agency_name: ['agency_name', 'agencyName', 'agency', 'funder', 'funder_name'],
  scheme_title: ['scheme_title', 'schemeTitle', 'title', 'call_title', 'program_title', 'opportunity_title'],
  description: ['description', 'summary', 'call_summary', 'overview'],
  open_date: ['open_date', 'openDate', 'opening_date', 'start_date'],
  close_date: ['close_date', 'closeDate', 'deadline', 'deadline_date', 'closing_date', 'submission_deadline'],
  is_rolling: ['is_rolling', 'isRolling', 'rolling', 'rolling_deadline'],
  geography_scope: ['geography_scope', 'geographyScope', 'scope', 'geographic_scope'],
  eligible_countries: ['eligible_countries', 'eligibleCountries', 'applicant_countries'],
  eligible_regions: ['eligible_regions', 'eligibleRegions', 'applicant_regions'],
  host_countries: ['host_countries', 'hostCountries', 'project_countries', 'host_country'],
  funder_country: ['funder_country', 'funderCountry', 'agency_country'],
  funding_kinds: ['funding_kinds', 'fundingKinds', 'funding_types', 'grant_types'],
  institution_types: ['institution_types', 'institutionTypes', 'eligible_institutions'],
  career_stages: ['career_stages', 'careerStages', 'career_levels'],
  citizenship_requirements: ['citizenship_requirements', 'citizenshipRequirements'],
  residency_requirements: ['residency_requirements', 'residencyRequirements'],
  application_languages: ['application_languages', 'applicationLanguages', 'languages'],
  disciplines: ['disciplines', 'fields', 'themes', 'research_areas'],
  amount_min: ['amount_min', 'amountMin', 'minimum_amount', 'min_amount'],
  amount_max: ['amount_max', 'amountMax', 'maximum_amount', 'max_amount', 'award_amount'],
  currency: ['currency'],
  project_duration_min_months: ['project_duration_min_months', 'projectDurationMinMonths', 'duration_min_months'],
  project_duration_max_months: ['project_duration_max_months', 'projectDurationMaxMonths', 'duration_max_months'],
  project_duration_text: ['project_duration_text', 'projectDurationText', 'duration', 'duration_text'],
  eligibility_text: ['eligibility_text', 'eligibilityText', 'eligibility'],
  expected_deliverables_text: ['expected_deliverables_text', 'expectedDeliverablesText', 'deliverables'],
  official_urls: ['official_urls', 'officialUrls', 'urls', 'source_urls'],
  contact_info: ['contact_info', 'contactInfo', 'contact'],
  sponsor_type: ['sponsor_type', 'sponsorType', 'funder_type'],
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) {
      return record;
    }
  }
  return null;
}

function getByAliases(record: JsonRecord | null, aliases: string[]): unknown {
  if (!record) {
    return undefined;
  }

  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) {
      return record[alias];
    }
  }

  const entries = Object.entries(record);
  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase();
    const match = entries.find(([key]) => key.toLowerCase() === normalizedAlias);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function isWrappedField(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(
    record &&
    (
      Object.prototype.hasOwnProperty.call(record, 'value') ||
      Object.prototype.hasOwnProperty.call(record, 'status') ||
      Object.prototype.hasOwnProperty.call(record, 'confidence') ||
      Object.prototype.hasOwnProperty.call(record, 'evidence')
    )
  );
}

function isEmptyValue(value: unknown): boolean {
  return value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
}

function wrapField(value: unknown) {
  if (isWrappedField(value)) {
    return value;
  }

  return {
    value: isEmptyValue(value) ? null : value,
    status: isEmptyValue(value) ? 'unsupported' : 'supported',
    confidence: isEmptyValue(value) ? 0 : 0.85,
    evidence: [],
  };
}

function extractWarnings(...values: unknown[]): string[] {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function stripSourceAnchorsDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSourceAnchorsDeep(item));
  }

  const record = asRecord(value);
  if (!record) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nestedValue]) => [
      key,
      key === 'sourceAnchors' ? [] : stripSourceAnchorsDeep(nestedValue),
    ])
  );
}

function humanizeKey(value: unknown, fallback: string): string {
  const text = String(value || fallback)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeItemType(value: unknown, fallback: string) {
  const normalized = String(value || '').trim();
  return TEMPLATE_ITEM_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeWorkflowMode(value: unknown) {
  const normalized = String(value || '').trim();
  return TEMPLATE_WORKFLOW_MODES.has(normalized) ? normalized : 'team_manual';
}

function normalizeSupportLevel(value: unknown) {
  const normalized = String(value || '').trim();
  if (TEMPLATE_SUPPORT_LEVELS.has(normalized)) {
    return normalized;
  }
  if (normalized === 'conditional') {
    return 'partial';
  }
  return 'full';
}

function ensureTemplateItemShape(item: unknown, block: string, index: number) {
  const record = asRecord(item) || {};
  const fallbackKey = `${block}_${index + 1}`;
  const key = String(record.key || record.id || record.label || fallbackKey)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallbackKey;
  const label = String(record.label || '').trim() ||
    humanizeKey(record.key || record.title || record.text || record.guidance || fallbackKey, fallbackKey);
  const inferredType = block === 'attachments'
    ? 'attachment'
    : block === 'evaluationCriteria'
      ? 'rubric'
      : block === 'sections'
        ? 'section'
        : 'field';
  const guidance = record.guidance ?? record.text ?? record.description ?? record.note ?? null;

  return {
    ...record,
    key,
    label,
    type: normalizeItemType(record.type, inferredType),
    workflowMode: normalizeWorkflowMode(record.workflowMode),
    required: Boolean(record.required),
    repeatable: Boolean(record.repeatable),
    visibleWhen: record.visibleWhen ?? null,
    wordLimit: record.wordLimit ?? null,
    charLimit: record.charLimit ?? null,
    options: Array.isArray(record.options) ? record.options : [],
    schema: record.schema ?? null,
    guidance,
    supportLevel: normalizeSupportLevel(record.supportLevel),
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.85,
    sourceAnchors: [],
  };
}

function sanitizeTemplateCandidate(candidate: JsonRecord): JsonRecord {
  const next = stripSourceAnchorsDeep(candidate) as JsonRecord;

  for (const block of TEMPLATE_ARRAY_BLOCKS) {
    next[block] = Array.isArray(next[block])
      ? (next[block] as unknown[]).map((item, index) => ensureTemplateItemShape(item, block, index))
      : [];
  }

  const submissionRules = asRecord(next.submissionRules) || {};
  next.submissionRules = {
    notes: typeof submissionRules.notes === 'string' ? submissionRules.notes : null,
    items: Array.isArray(submissionRules.items)
      ? submissionRules.items.map((item, index) => ensureTemplateItemShape(item, 'submissionRules', index))
      : [],
    sourceAnchors: [],
  };

  if (next.budget && asRecord(next.budget)) {
    const budget = asRecord(next.budget) || {};
    next.budget = {
      ...budget,
      workflowMode: 'app_draft',
      supportLevel: normalizeSupportLevel(budget.supportLevel),
      confidence: Number.isFinite(Number(budget.confidence)) ? Number(budget.confidence) : 0.85,
      categories: Array.isArray(budget.categories)
        ? budget.categories.map((category, index) => {
            const record = asRecord(category) || {};
            const key = String(record.key || record.label || `budget_category_${index + 1}`)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '') || `budget_category_${index + 1}`;
            return {
              ...record,
              key,
              label: String(record.label || '').trim() || humanizeKey(key, key),
              sourceAnchors: [],
            };
          })
        : [],
      sourceAnchors: [],
    };
  } else {
    next.budget = null;
  }

  next.sourceAnchors = [];
  next.mergeConflicts = Array.isArray(next.mergeConflicts)
    ? (next.mergeConflicts as unknown[]).filter((conflict) => {
        const record = asRecord(conflict);
        return Boolean(
          record &&
          TEMPLATE_MERGE_CONFLICT_BLOCKS.has(String(record.block || '')) &&
          typeof record.key === 'string' &&
          record.key.trim() &&
          Object.prototype.hasOwnProperty.call(record, 'existingItem') &&
          Object.prototype.hasOwnProperty.call(record, 'incomingItem') &&
          typeof record.message === 'string' &&
          record.message.trim()
        );
      })
    : [];

  return next;
}

function isEmptyTemplate(template: GrantTemplateDocument): boolean {
  return template.questions.length === 0 &&
    template.sections.length === 0 &&
    template.attachments.length === 0 &&
    template.evaluationCriteria.length === 0 &&
    template.submissionRules.items.length === 0 &&
    !template.budget;
}

function isEmptyGuidelinePack(pack: GuidelinePackDocument): boolean {
  return Object.entries(pack)
    .filter(([key]) => key !== 'sourceAnchors')
    .every(([, value]) => Array.isArray(value) && value.length === 0);
}

function parseTemplate(raw: JsonRecord): GrantTemplateDocument | null {
  const templateContainer = firstRecord(
    raw.template,
    raw.grant_template,
    raw.grantTemplate,
    raw.application_template,
    raw.template_ingestion
  );
  const candidate = firstRecord(
    templateContainer?.grant_template_json,
    templateContainer?.grantTemplateJson,
    templateContainer?.template,
    templateContainer,
    raw.grant_template_json
  );

  if (!candidate) {
    return null;
  }

  const template = normalizeGrantTemplate(sanitizeTemplateCandidate(candidate));
  return isEmptyTemplate(template) ? null : template;
}

function parseGuidelines(raw: JsonRecord): GuidelinePackDocument | null {
  const guidelineContainer = firstRecord(
    raw.guidelines,
    raw.guideline,
    raw.guideline_pack,
    raw.guidelinePack,
    raw.guideline_ingestion
  );
  const candidate = firstRecord(
    guidelineContainer?.guideline_pack_json,
    guidelineContainer?.guidelinePackJson,
    guidelineContainer?.guidelinePack,
    guidelineContainer?.pack,
    guidelineContainer,
    raw.guideline_pack_json
  );

  if (!candidate) {
    return null;
  }

  const pack = normalizeGuidelinePack(stripSourceAnchorsDeep(candidate));
  return isEmptyGuidelinePack(pack) ? null : pack;
}

function readSourceText(raw: JsonRecord, call: JsonRecord | null): string | null {
  const candidate = getByAliases(raw, ['source_text', 'sourceText', 'raw_source_text', 'rawText', 'normalized_text']) ??
    getByAliases(call, ['source_text', 'sourceText', 'raw_source_text', 'rawText', 'normalized_text']);

  if (typeof candidate !== 'string') {
    return null;
  }

  const normalized = normalizeMultilineText(candidate);
  return normalized || null;
}

function buildExtractionPayload(raw: JsonRecord): FundingExtractionPayload {
  const call = firstRecord(raw.call, raw.funding_call, raw.fundingCall, raw.call_ingestion, raw.core_call);
  const fields = firstRecord(call?.fields, raw.fields) || call || raw;
  const normalizedFields: Record<string, unknown> = {};

  for (const definition of FUNDING_FIELD_DEFINITIONS) {
    const aliases = FIELD_ALIASES[definition.key] || [definition.key];
    const candidate = getByAliases(fields, aliases) ?? getByAliases(call, aliases) ?? getByAliases(raw, aliases);
    normalizedFields[definition.key] = wrapField(candidate);
  }

  return normalizeExtractionPayload(
    {
      fields: normalizedFields,
      warnings: extractWarnings(raw.warnings, call?.warnings),
    },
    { allowDescriptionWithoutEvidence: true }
  );
}

export function parseFundingJsonUpload(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('JSON upload file is empty');
  }

  return JSON.parse(trimmed);
}

export function prepareFundingJsonIntake(input: unknown): {
  payload: FundingExtractionPayload;
  draftValues: ReturnType<typeof buildDraftValuesFromExtraction>;
  sourceText: string | null;
  template: GrantTemplateDocument | null;
  guidelinePack: GuidelinePackDocument | null;
  warnings: string[];
  metadata: {
    schema_version: string;
    prompt_version: string;
    has_template: boolean;
    has_guidelines: boolean;
  };
} {
  const raw = asRecord(input);
  if (!raw) {
    throw new Error('JSON upload must contain one top-level object');
  }

  const payload = buildExtractionPayload(raw);
  const draftValues = buildDraftValuesFromExtraction(payload);
  const draftRecord = draftValues as unknown as Record<string, unknown>;
  const hasAnyCoreCallField = ['agency_name', 'scheme_title', 'description'].some(
    (key) => String(draftRecord[key] || '').trim().length > 0
  );

  if (!hasAnyCoreCallField) {
    throw new Error('JSON upload must include at least one of agency_name, scheme_title, or description');
  }

  const template = parseTemplate(raw);
  const guidelinePack = parseGuidelines(raw);

  return {
    payload,
    draftValues,
    sourceText: readSourceText(raw, firstRecord(raw.call, raw.funding_call, raw.fundingCall)),
    template,
    guidelinePack,
    warnings: payload.warnings,
    metadata: {
      schema_version: String(raw.schema_version || 'funding_intake_json_v1'),
      prompt_version: String(raw.prompt_version || FUNDING_JSON_UPLOAD_PROMPT_VERSION),
      has_template: Boolean(template),
      has_guidelines: Boolean(guidelinePack),
    },
  };
}

export function readPreparedFundingJsonArtifacts(metadata: unknown): {
  template: GrantTemplateDocument | null;
  guidelinePack: GuidelinePackDocument | null;
  appliedFundingCallId: string | null;
} {
  const root = asRecord(metadata);
  const jsonUpload = asRecord(root?.json_upload);
  const artifacts = asRecord(root?.json_artifacts);
  const applied = asRecord(root?.json_artifacts_applied);

  const template = artifacts?.grant_template_json
    ? normalizeGrantTemplate(stripSourceAnchorsDeep(artifacts.grant_template_json))
    : null;
  const guidelinePack = artifacts?.guideline_pack_json
    ? normalizeGuidelinePack(stripSourceAnchorsDeep(artifacts.guideline_pack_json))
    : null;

  return {
    template: template && !isEmptyTemplate(template) ? template : null,
    guidelinePack: guidelinePack && !isEmptyGuidelinePack(guidelinePack) ? guidelinePack : null,
    appliedFundingCallId: typeof applied?.funding_call_id === 'string'
      ? applied.funding_call_id
      : typeof jsonUpload?.applied_funding_call_id === 'string'
        ? jsonUpload.applied_funding_call_id
        : null,
  };
}

export function emptyJsonArtifacts() {
  return {
    grant_template_json: createEmptyGrantTemplate(),
    guideline_pack_json: createEmptyGuidelinePack(),
  };
}
