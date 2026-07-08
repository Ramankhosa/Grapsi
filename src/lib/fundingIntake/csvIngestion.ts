import {
  ARRAY_FIELD_KEYS,
  BOOLEAN_FIELD_KEYS,
  NUMERIC_FIELD_KEYS,
  type FundingFieldKey,
} from './constants';
import { FIELD_ALIASES } from './jsonIngestion';
import {
  FUNDING_GUIDELINE_BLOCK_KEYS,
  type FundingGuidelineBlockKey,
} from '../fundingGuidelines/types';
import type { GrantTemplateDocument, FundingTemplateItem } from '../fundingTemplates/types';

export const FUNDING_CSV_UPLOAD_SCHEMA_VERSION = 'funding_intake_csv_v1';

// CSV guideline row-label (left column) -> guideline pack bucket.
// Accepts singular/plural and a couple of common spellings.
const GUIDELINE_ROW_LABELS: Record<string, FundingGuidelineBlockKey> = {
  priority: 'priorities',
  priorities: 'priorities',
  must_address: 'mustAddress',
  mustaddress: 'mustAddress',
  must: 'mustAddress',
  avoid: 'avoid',
  prohibition: 'avoid',
  evaluation_criterion: 'evaluationCriteria',
  evaluation_criteria: 'evaluationCriteria',
  evaluationcriteria: 'evaluationCriteria',
  budget_rule: 'budgetRules',
  budget: 'budgetRules',
  duration_rule: 'durationRules',
  duration: 'durationRules',
  format_rule: 'formatRules',
  format: 'formatRules',
  submission_rule: 'submissionRules',
  submission: 'submissionRules',
  deliverable_rule: 'deliverableRules',
  deliverable: 'deliverableRules',
  reviewer_signal: 'reviewerSignals',
  reviewer: 'reviewerSignals',
};

// Template row labels (left column) -> template block.
// The canonical template row format is two columns: label,"Item name: guidance".
// A three-column form (label,Item name,guidance) is tolerated as well.
type TemplateBlock = 'sections' | 'questions' | 'attachments' | 'evaluationCriteria' | 'submissionRules' | 'budgetCategories';

const TEMPLATE_ROW_LABELS: Record<string, TemplateBlock> = {
  template_section: 'sections',
  section: 'sections',
  narrative_section: 'sections',
  template_question: 'questions',
  question: 'questions',
  form_field: 'questions',
  template_attachment: 'attachments',
  attachment: 'attachments',
  required_document: 'attachments',
  required_upload: 'attachments',
  scoring_criterion: 'evaluationCriteria',
  scoring_criteria: 'evaluationCriteria',
  rubric: 'evaluationCriteria',
  rubric_criterion: 'evaluationCriteria',
  template_submission_rule: 'submissionRules',
  admin_rule: 'submissionRules',
  budget_category: 'budgetCategories',
  budget_line: 'budgetCategories',
};

const DOCUMENT_URL_LABELS = new Set([
  'document_url',
  'full_call_url',
  'call_document_url',
  'pdf_url',
  'pdf_link',
  'docx_url',
  'source_document_url',
  'full_document_url',
]);

// Reverse lookup: any known alias (lowercased) -> canonical funding field key.
const CALL_FIELD_ALIAS_TO_KEY = (() => {
  const map = new Map<string, FundingFieldKey>();
  for (const [key, aliases] of Object.entries(FIELD_ALIASES) as [FundingFieldKey, string[]][]) {
    map.set(key.toLowerCase(), key);
    for (const alias of aliases) {
      map.set(alias.toLowerCase(), key);
    }
  }
  return map;
})();

function normalizeLabel(value: string): string {
  return value
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function splitListCell(value: string): string[] {
  return value
    .split(/[|;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function coerceBoolean(value: string): boolean {
  return /^(true|yes|y|1|rolling|open)$/i.test(value.trim());
}

function coerceNumber(value: string): number | null {
  // Tolerate what LLMs commonly emit for money/duration: currency symbols,
  // thousands separators, and k/m/b (or thousand/million/billion) suffixes.
  const raw = value.replace(/,/g, '').trim();
  const match = /(-?\d+(?:\.\d+)?)\s*(?:(k|m|bn?|thousand|million|billion)\b)?/i.exec(raw);
  if (!match) return null;
  let num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k' || suffix === 'thousand') num *= 1e3;
  else if (suffix === 'm' || suffix === 'million') num *= 1e6;
  else if (suffix === 'b' || suffix === 'bn' || suffix === 'billion') num *= 1e9;
  return num;
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

// Strip a leading list/bullet marker an LLM may prepend to a field name,
// e.g. "1. agency_name", "- priority", "* must_address".
function stripListMarker(text: string): string {
  return text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
}

// If an LLM ignores the comma delimiter, it usually falls back to one of these
// between the field name and the value. Ordered so the most specific win first.
const FALLBACK_DELIMITERS = ['\t', ' = ', '=', ' : ', ': ', ':', '|', ';'];

// Resolve one parsed CSV row into a [label, value] pair, tolerating the ways an
// LLM tends to deviate: extra unquoted commas in the value (rejoined), a wrong
// single delimiter, bullet/number prefixes, and stray wrapping quotes.
function splitLabelValue(rawRow: string[]): [string, string] | null {
  // Do NOT trim interior cells: when the value was an unquoted list like
  // "a, b, c" it arrives split across cells, and trimming would drop the spaces
  // that follow each comma when we rejoin. Only the label and final value are trimmed.
  const cells = [...rawRow];
  while (cells.length > 0 && (cells[cells.length - 1] ?? '').trim() === '') cells.pop();
  if (cells.length === 0) return null;

  let label = cells[0] ?? '';
  let value: string;

  if (cells.length >= 2) {
    // Everything after the first comma is the value, so unquoted commas are fine.
    value = cells.slice(1).join(',').trim();
  } else {
    const cell = (cells[0] ?? '').trim();
    let matched: [string, string] | null = null;
    for (const delimiter of FALLBACK_DELIMITERS) {
      const index = cell.indexOf(delimiter);
      if (index > 0) {
        matched = [cell.slice(0, index), cell.slice(index + delimiter.length)];
        break;
      }
    }
    if (!matched) return [stripListMarker(cell), ''];
    label = matched[0];
    value = matched[1].trim();
  }

  label = stripListMarker(label);
  // Remove wrapping quotes the CSV parser did not already consume.
  value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
  return [label, value];
}

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes (""),
 * and commas/newlines inside quoted fields. Returns an array of rows, each an
 * array of cell strings.
 */
export function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // Handle CRLF as a single break.
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  // Flush the trailing cell/row if the file did not end with a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

// Separators an LLM may use between the item name and its guidance inside one
// cell. Checked in priority order; each requires surrounding context that keeps
// times ("5:00pm"), URLs ("https://"), and hyphenated words ("3-5 pages") intact.
const TEMPLATE_NAME_GUIDANCE_SEPARATORS = [': ', ' — ', ' – ', ' | ', ' - '];

// Resolve a template row into { label, guidance }. Canonical form is a single
// value cell "Item name: guidance"; a three-column row (label,name,guidance)
// and dash/pipe separators are tolerated. A bare name yields empty guidance.
function splitTemplateLabelGuidance(rawRow: string[], joinedValue: string): { label: string; guidance: string } {
  const cells = [...rawRow];
  while (cells.length > 0 && (cells[cells.length - 1] ?? '').trim() === '') cells.pop();

  // Three-column form: the middle cell is the item name (only when it does not
  // itself carry a "name: guidance" separator — that indicates an unquoted
  // two-column value whose guidance contains commas).
  if (cells.length >= 3) {
    const middle = (cells[1] ?? '').trim();
    if (middle && !middle.includes(': ')) {
      return {
        label: middle,
        guidance: cells.slice(2).join(',').trim(),
      };
    }
  }

  for (const separator of TEMPLATE_NAME_GUIDANCE_SEPARATORS) {
    const index = joinedValue.indexOf(separator);
    if (index > 0) {
      return {
        label: joinedValue.slice(0, index).trim(),
        guidance: joinedValue.slice(index + separator.length).trim(),
      };
    }
  }

  return { label: joinedValue.trim(), guidance: '' };
}

function buildTemplateItem(
  block: string,
  index: number,
  label: string,
  guidance: string,
): FundingTemplateItem {
  const key = slugify(label, `${block}_${index + 1}`);
  // Defaults per block follow the conventions in standardGrantTemplate.ts:
  // sections/questions are app-drafted; attachments and submission rules are
  // handled manually by the team; rubric items describe reviewer scoring.
  const inferredType =
    block === 'attachments' ? 'attachment' as const
    : block === 'evaluationCriteria' ? 'rubric' as const
    : block === 'sections' ? 'section' as const
    : block === 'submissionRules' ? 'rule' as const
    : 'field' as const;
  const manual = block === 'attachments' || block === 'submissionRules';

  return {
    key,
    label,
    type: inferredType,
    workflowMode: manual ? 'team_manual' : 'app_draft',
    required: true,
    repeatable: false,
    visibleWhen: null,
    wordLimit: null,
    charLimit: null,
    options: [],
    schema: null,
    guidance: guidance || null,
    supportLevel: manual ? 'manual' : 'full',
    confidence: 0.85,
    sourceAnchors: [],
  };
}

function assembleTemplate(
  templateRows: Record<TemplateBlock, Array<{ label: string; guidance: string }>>,
): GrantTemplateDocument | null {
  const hasAny = Object.values(templateRows).some((arr) => arr.length > 0);
  if (!hasAny) return null;

  const sections = templateRows.sections.map((r, i) => buildTemplateItem('sections', i, r.label, r.guidance));
  const questions = templateRows.questions.map((r, i) => buildTemplateItem('questions', i, r.label, r.guidance));
  const attachments = templateRows.attachments.map((r, i) => buildTemplateItem('attachments', i, r.label, r.guidance));
  const evaluationCriteria = templateRows.evaluationCriteria.map((r, i) => buildTemplateItem('evaluationCriteria', i, r.label, r.guidance));
  const submissionItems = templateRows.submissionRules.map((r, i) => buildTemplateItem('submissionRules', i, r.label, r.guidance));

  const budgetCategories = templateRows.budgetCategories.map((r, i) => ({
    key: slugify(r.label, `budget_category_${i + 1}`),
    label: r.label,
    cap: null,
    notes: r.guidance || null,
    sourceAnchors: [],
  }));

  return {
    questions,
    sections,
    budget: budgetCategories.length > 0
      ? {
          required: true,
          yearWise: false,
          workflowMode: 'app_draft',
          columns: [],
          categories: budgetCategories,
          caps: null,
          justificationNotes: null,
          supportLevel: 'full',
          confidence: 0.85,
          sourceAnchors: [],
        }
      : null,
    attachments,
    evaluationCriteria,
    submissionRules: {
      notes: null,
      items: submissionItems,
      sourceAnchors: [],
    },
    sourceAnchors: [],
    mergeConflicts: [],
  };
}

/**
 * Parse a two-column (field,value) funding-call CSV into the same intake object
 * the JSON-upload path consumes (see `prepareFundingJsonIntake`). Basic call
 * details fill `call.fields`; guideline rows fill `guidelines.guideline_pack_json`.
 * Template rows fill `template.grant_template_json`. Document URLs fill
 * `document_urls` for automatic PDF/DOCX ingestion into embeddings.
 */
export function parseFundingCsvUpload(rawText: string): {
  schema_version: string;
  source_text: null;
  call: { fields: Record<string, unknown>; warnings: string[] };
  guidelines: { guideline_pack_json: Record<string, Array<{ key: string; text: string }>> };
  template: { grant_template_json: GrantTemplateDocument } | null;
  document_urls: string[];
} {
  // Strip a UTF-8 BOM and any markdown code fences an LLM may wrap around the CSV.
  const cleaned = (rawText || '')
    .replace(/^﻿/, '')
    .replace(/```[a-zA-Z]*\s*\n?/g, '')
    .replace(/```/g, '')
    .trim();
  if (!cleaned) {
    throw new Error('CSV upload file is empty');
  }

  const rows = parseCsvRows(cleaned);
  const fields: Record<string, unknown> = {};
  const guidelinePack: Record<string, Array<{ key: string; text: string }>> = {};
  for (const block of FUNDING_GUIDELINE_BLOCK_KEYS) {
    guidelinePack[block] = [];
  }
  const templateRows: Record<TemplateBlock, Array<{ label: string; guidance: string }>> = {
    sections: [],
    questions: [],
    attachments: [],
    evaluationCriteria: [],
    submissionRules: [],
    budgetCategories: [],
  };
  const documentUrls: string[] = [];

  let recognizedRows = 0;

  for (const rawRow of rows) {
    const pair = splitLabelValue(rawRow);
    if (!pair) continue;
    const [rawLabel, value] = pair;
    // Skip empty labels and comment lines (used by the downloadable template).
    if (!rawLabel || rawLabel.startsWith('#')) continue;

    const label = normalizeLabel(rawLabel);
    // Skip a header row like "field,value".
    if (label === 'field' || label === 'key') continue;

    // Skip empty cells and unfilled template placeholders (which start with "#").
    if (!value || value.startsWith('#')) continue;

    // Document URL row (full call PDF/DOCX to download and ingest)?
    if (DOCUMENT_URL_LABELS.has(label)) {
      for (const url of splitListCell(value)) {
        if (/^https?:\/\/.+/i.test(url) && !documentUrls.includes(url)) {
          documentUrls.push(url);
        }
      }
      recognizedRows += 1;
      continue;
    }

    // Application template row?
    const templateBlock = TEMPLATE_ROW_LABELS[label];
    if (templateBlock) {
      const item = splitTemplateLabelGuidance(rawRow, value);
      if (item.label) {
        templateRows[templateBlock].push({ label: item.label, guidance: item.guidance });
        recognizedRows += 1;
      }
      continue;
    }

    // Guideline rule row?
    const bucket = GUIDELINE_ROW_LABELS[label];
    if (bucket) {
      const items = guidelinePack[bucket];
      const key = `${bucket}_${items.length + 1}_${slugify(value, 'rule')}`;
      items.push({ key, text: value });
      recognizedRows += 1;
      continue;
    }

    // Call detail row?
    const canonicalKey = CALL_FIELD_ALIAS_TO_KEY.get(label);
    if (canonicalKey) {
      if (ARRAY_FIELD_KEYS.has(canonicalKey)) {
        fields[canonicalKey] = splitListCell(value);
      } else if (NUMERIC_FIELD_KEYS.has(canonicalKey)) {
        fields[canonicalKey] = coerceNumber(value);
      } else if (BOOLEAN_FIELD_KEYS.has(canonicalKey)) {
        fields[canonicalKey] = coerceBoolean(value);
      } else {
        fields[canonicalKey] = value;
      }
      recognizedRows += 1;
      continue;
    }

    // Unknown label — ignore silently so extra helper rows/comments don't break import.
  }

  if (recognizedRows === 0) {
    throw new Error(
      'CSV upload did not contain any recognized funding-call fields, guideline rows, or template rows. Use the downloadable template as a starting point.'
    );
  }

  const hasCoreField = ['agency_name', 'scheme_title', 'description'].some(
    (key) => String(fields[key] || '').trim().length > 0
  );
  if (!hasCoreField) {
    throw new Error('CSV upload must include at least one of agency_name, scheme_title, or description.');
  }

  const template = assembleTemplate(templateRows);

  return {
    schema_version: FUNDING_CSV_UPLOAD_SCHEMA_VERSION,
    source_text: null,
    call: { fields, warnings: [] },
    guidelines: { guideline_pack_json: guidelinePack },
    template: template ? { grant_template_json: template } : null,
    document_urls: documentUrls,
  };
}
