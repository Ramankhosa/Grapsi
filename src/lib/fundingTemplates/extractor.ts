import fs from 'fs/promises';
import path from 'path';
import { generateFromGemini } from '../geminiService';
import { generateFromOpenAI } from '../openaiService';
import { parseJsonResponse } from '../fundingIntake/utils';
import { normalizeGrantWorkflowMode } from '../grants/workflowMode';
import { buildAssetSequenceMap, buildCompatibilitySummary, normalizeGrantTemplate, sortAndDeduplicateGrantTemplate } from './utils';
import type { FundingTemplateCompatibilitySummary, GrantTemplateDocument } from './types';

const TEMPLATE_PROMPT_VERSION = 'funding-template-v4';
const TEMPLATE_EXTRACTOR_VERSION = 'funding-template-extractor-v4';

const SYSTEM_INSTRUCTIONS = `
You extract grant application templates from funding template assets.
Return strict JSON only.
Never infer sections, questions, budget rules, or attachments that are not supported by the assets.
Every source anchor must include the originating asset_id.
Use supportLevel values only from: full, partial, manual, unsupported.
Assets are ordered. Earlier assets represent earlier template fields.
If later assets repeat a field already seen in an earlier asset, do not repeat it in the final template.
If two assets disagree, keep the earliest well-supported version and add a warning.
Flatten the output into the exact top-level arrays shown in the schema.
Do not return nested section/question hierarchies or alternate field names like section_id, question_id, title, or instructions unless they are mapped into the exact schema fields.
Scan the entire asset before finalizing extraction. Do not stop after the first column or primary content block.
Treat left-column, right-column, sidebar, callout, inset, appendix, and table-adjacent content as equally important sources.
If the asset is multi-column, extract fields and subsection headings from every column in reading order.
Every visible subsection heading, subheading, panel heading, or grouped prompt label that organizes one or more response items MUST be preserved as its own item in template.sections with type "section".
Do not collapse subsection headings into parent guidance or notes only. If a right-column block contains distinct subsections, each subsection must appear explicitly in the extracted template.
Use template.questions for discrete fillable fields and template.sections for narrative prompts or subsection containers, even when the source visually nests them.
Every extracted response-bearing item MUST include workflowMode:
- app_draft: substantive proposal content the app should draft and use in prep/blueprint/dimension flows.
- app_support: structured support content the app should keep visible but exclude from ideation/dimension/AI drafting.
- team_manual: team-owned/admin/compliance/upload content that should remain visible but stay out of prep/blueprint/dimension/AI drafting.
Classify app_draft for objectives, problem statement, summary, aim/scope, detailed proposal, methodology/workplan narrative, impact, outcomes, sustainability, risks/mitigation, and justification text.
Classify app_support for budget overview, budget categories, structured implementation matrices, and other structured support blocks.
Classify team_manual for personnel details, institution metadata, category selectors, declarations, proofs, certificates, letters, annexures, attachments, signatures, and uploads.
Preserve section-specific instructions, reviewer-facing guidance, explicit required inclusions, and exact word/character limits on the extracted item they belong to.
When a heading or prompt includes both the section label and embedded drafting instructions, keep the label concise in "label" and place the drafting instructions in "guidance" without dropping any concrete requirements.
`;

export interface TemplateExtractionAssetInput {
  id: string;
  sequence_no?: number | null;
  source_type: 'url' | 'pdf' | 'image' | 'text';
  source_url?: string | null;
  storage_path?: string | null;
  mime?: string | null;
  raw_text?: string | null;
  normalized_text?: string | null;
  ocr_text?: string | null;
}

export interface TemplateExtractionResult {
  template: GrantTemplateDocument;
  compatibility: FundingTemplateCompatibilitySummary;
  warnings: string[];
  extractorModel: string;
  extractorVersion: string;
  promptVersion: string;
  rawOutput: Record<string, unknown>;
}

type GrantTemplateItemType = 'field' | 'section' | 'table' | 'budget' | 'attachment' | 'checklist' | 'rule' | 'rubric';
type GrantTemplateSupportLevel = 'full' | 'partial' | 'manual' | 'unsupported';

function coerceWorkflowMode(value: unknown, fallback: 'app_draft' | 'app_support' | 'team_manual' = 'team_manual') {
  return normalizeGrantWorkflowMode(value, fallback);
}

function buildPromptPreamble(): string {
  return `
${SYSTEM_INSTRUCTIONS}

Return JSON in this exact shape:
{
  "template": {
    "questions": [
      {
        "key": "string",
        "label": "string",
        "type": "field|section|table|budget|attachment|checklist|rule|rubric",
        "workflowMode": "app_draft|app_support|team_manual",
        "required": true,
        "repeatable": false,
        "visibleWhen": "string|null",
        "wordLimit": 0,
        "charLimit": 0,
        "options": ["string"],
        "schema": {},
        "guidance": "string|null",
        "supportLevel": "full|partial|manual|unsupported",
        "confidence": 0.0,
        "sourceAnchors": [
          {
            "asset_id": "uuid",
            "page": 1,
            "section": "string|null",
            "urlFragment": "string|null",
            "quote": "string|null",
            "note": "string|null",
            "confidence": 0.0
          }
        ]
      }
    ],
    "sections": [
      {
        "key": "string",
        "label": "string",
        "type": "section",
        "workflowMode": "app_draft|app_support|team_manual",
        "required": true,
        "repeatable": false,
        "visibleWhen": "string|null",
        "wordLimit": 0,
        "charLimit": 0,
        "options": ["string"],
        "schema": {},
        "guidance": "string|null",
        "supportLevel": "full|partial|manual|unsupported",
        "confidence": 0.0,
        "sourceAnchors": []
      }
    ],
    "budget": {
      "required": true,
      "yearWise": false,
      "workflowMode": "app_support",
      "categories": [
        {
          "key": "string",
          "label": "string",
          "cap": "string|null",
          "notes": "string|null",
          "sourceAnchors": []
        }
      ],
      "caps": {},
      "justificationNotes": "string|null",
      "supportLevel": "full|partial|manual|unsupported",
      "confidence": 0.0,
      "sourceAnchors": []
    },
    "attachments": [],
    "evaluationCriteria": [],
    "submissionRules": {
      "notes": "string|null",
      "items": [],
      "sourceAnchors": []
    },
    "sourceAnchors": [],
    "mergeConflicts": []
  },
  "warnings": ["string"]
}
Use the same item fields shown in the questions example for sections, attachments, evaluationCriteria, and submissionRules.items.
Preserve all visible subsection headings in template.sections, including headings that appear in right-hand columns or secondary panels.
`;
}

function buildTextOnlyPrompt(assets: TemplateExtractionAssetInput[]): string {
  const assetBlocks = assets
    .map((asset) => {
      const text = asset.ocr_text || asset.normalized_text || asset.raw_text || '';
      return [
        `ASSET ${asset.id}`,
        `sequence_no: ${asset.sequence_no ?? 'unknown'}`,
        `source_type: ${asset.source_type}`,
        asset.source_url ? `source_url: ${asset.source_url}` : null,
        'content:',
        text.slice(0, 20000),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');

  return `${buildPromptPreamble()}\n\nAssets:\n${assetBlocks}`.trim();
}

async function buildGeminiRestParts(assets: TemplateExtractionAssetInput[]): Promise<Array<Record<string, unknown>>> {
  const parts: Array<Record<string, unknown>> = [{ text: buildPromptPreamble() }];

  for (const asset of assets) {
    const text = asset.ocr_text || asset.normalized_text || asset.raw_text || '';

    if (asset.source_type === 'url' || asset.source_type === 'text' || !asset.storage_path) {
      console.log(
        `[Funding Template] Attaching text asset ${asset.id} (${asset.source_type}) with ${Math.min(text.length, 20000)} chars`
      );
      parts.push({
        text: [
          `Asset ${asset.id}`,
          `sequence_no: ${asset.sequence_no ?? 'unknown'}`,
          `source_type: ${asset.source_type}`,
          asset.source_url ? `source_url: ${asset.source_url}` : null,
          'content:',
          text.slice(0, 20000),
        ]
          .filter(Boolean)
          .join('\n'),
      });
      continue;
    }

    const absolutePath = path.isAbsolute(asset.storage_path)
      ? asset.storage_path
      : path.join(process.cwd(), asset.storage_path);
    const fileBuffer = await fs.readFile(absolutePath);
    console.log(
      `[Funding Template] Attaching binary asset ${asset.id} (${asset.source_type}) mime=${asset.mime || 'auto'} size=${fileBuffer.length} path=${absolutePath}`
    );
    parts.push({
      text: `Asset ${asset.id} (${asset.source_type}, sequence_no=${asset.sequence_no ?? 'unknown'}). Use asset_id "${asset.id}" for every anchor from this file.`,
    });
    parts.push({
      inline_data: {
        data: fileBuffer.toString('base64'),
        mime_type: asset.mime || (asset.source_type === 'pdf' ? 'application/pdf' : 'image/png'),
      },
    });
  }
  return parts;
}

async function callTextExtractor(prompt: string): Promise<{ model: string; rawText: string }> {
  if (process.env.GOOGLE_AI_API_KEY) {
    const model = process.env.FUNDING_TEMPLATE_GEMINI_MODEL || 'gemini-2.5-pro';
    console.log(`[Funding Template] Using Gemini text extraction model: ${model}`);

    const rawText = await generateFromGemini(prompt, model);
    return { model, rawText };
  }

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.FUNDING_TEMPLATE_OPENAI_MODEL || 'gpt-4o-mini';
    const rawText = await generateFromOpenAI(prompt, model, SYSTEM_INSTRUCTIONS);
    return { model, rawText };
  }

  throw new Error('No LLM provider configured for funding template extraction');
}
function extractGeminiRestText(parsedBody: any, rawBody: string): string {
  const textParts =
    parsedBody?.candidates
      ?.flatMap((candidate: any) => candidate?.content?.parts ?? [])
      ?.filter((part: any) => typeof part?.text === 'string')
      ?.map((part: any) => String(part.text)) ?? [];

  if (textParts.length === 0) {
    throw new Error(`Gemini multimodal request returned no text parts: ${rawBody.slice(0, 1000)}`);
  }

  return textParts.join('');
}

async function callGeminiMultimodal(assets: TemplateExtractionAssetInput[]): Promise<{ model: string; rawText: string }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini multimodal extraction requires GOOGLE_AI_API_KEY');
  }

  const model = process.env.FUNDING_TEMPLATE_GEMINI_MODEL || 'gemini-2.5-pro';
  console.log(`[Funding Template] Using Gemini multimodal extraction model: ${model}`);
  const parts = await buildGeminiRestParts(assets);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    }
  );

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini multimodal request failed (${response.status} ${response.statusText}): ${rawBody}`);
  }

  let parsedBody: any;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (error) {
    throw new Error(`Gemini multimodal request returned non-JSON response: ${(error as Error).message}. Body: ${rawBody.slice(0, 1000)}`);
  }

  const rawText = extractGeminiRestText(parsedBody, rawBody);
  console.log(`[Funding Template] Gemini response length: ${rawText.length} chars`);
  if (rawText.length < 50) {
    console.warn(`[Funding Template] Suspiciously short response: ${rawText.slice(0, 200)}`);
  }

  return { model, rawText };
}

function safeParseJsonResponse(rawText: string): any {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('LLM returned empty response text');
  }

  try {
    return parseJsonResponse(trimmed);
  } catch (firstError) {
    console.warn('[Funding Template] Primary JSON parse failed, trying fallback strategies:', (firstError as Error).message);
  }

  const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  const candidates: string[] = [];
  while ((match = jsonBlockRegex.exec(trimmed)) !== null) {
    candidates.push(match[1]);
  }

  for (const candidate of candidates.reverse()) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      continue;
    }
  }

  const braceStart = trimmed.lastIndexOf('{"template"');
  if (braceStart >= 0) {
    let depth = 0;
    for (let i = braceStart; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++;
      if (trimmed[i] === '}') depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(braceStart, i + 1));
        } catch {
          break;
        }
      }
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (e) {
      console.error('[Funding Template] All JSON parse strategies failed. Raw text preview:', trimmed.slice(0, 500));
      throw new Error(`Failed to parse LLM response as JSON: ${(e as Error).message}`);
    }
  }

  console.error('[Funding Template] No JSON structure found in response. Raw text preview:', trimmed.slice(0, 500));
  throw new Error('LLM response does not contain any JSON structure');
}

function slugifyTemplateKey(value: unknown, fallback: string): string {
  const text = String(value || '').trim().toLowerCase();
  const slug = text
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return slug || fallback;
}

function coerceSupportLevel(value: unknown, fallback: GrantTemplateSupportLevel = 'partial'): GrantTemplateSupportLevel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'full' || normalized === 'partial' || normalized === 'manual' || normalized === 'unsupported') {
    return normalized;
  }

  return fallback;
}

function coerceItemType(value: unknown, fallback: GrantTemplateItemType): GrantTemplateItemType {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'field' ||
    normalized === 'section' ||
    normalized === 'table' ||
    normalized === 'budget' ||
    normalized === 'attachment' ||
    normalized === 'checklist' ||
    normalized === 'rule' ||
    normalized === 'rubric'
  ) {
    return normalized;
  }

  if (
    normalized.includes('long_text') ||
    normalized.includes('textarea') ||
    normalized.includes('narrative') ||
    normalized.includes('essay')
  ) {
    return 'section';
  }

  if (normalized.includes('table') || normalized.includes('grid')) {
    return 'table';
  }

  if (normalized.includes('budget')) {
    return 'budget';
  }

  if (normalized.includes('attachment') || normalized.includes('upload')) {
    return 'attachment';
  }

  if (normalized.includes('checklist')) {
    return 'checklist';
  }

  if (normalized.includes('rule')) {
    return 'rule';
  }

  if (normalized.includes('rubric') || normalized.includes('criteria')) {
    return 'rubric';
  }

  if (
    normalized.includes('text') ||
    normalized.includes('input') ||
    normalized.includes('number') ||
    normalized.includes('date') ||
    normalized.includes('select') ||
    normalized.includes('choice') ||
    normalized.includes('radio') ||
    normalized.includes('checkbox') ||
    normalized.includes('boolean')
  ) {
    return 'field';
  }

  return fallback;
}

function coerceAnchors(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((anchor) => anchor && typeof anchor === 'object' && typeof (anchor as Record<string, unknown>).asset_id === 'string')
    .map((anchor) => anchor as Record<string, unknown>);
}

function coerceConfidence(value: unknown, fallback = 0.7): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, numeric));
}

function combineGuidance(...values: Array<unknown>): string | null {
  const parts = values
    .flatMap((value) => {
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim());
      }

      return [String(value || '').trim()];
    })
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return Array.from(new Set(parts)).join('\n\n');
}

function coerceTemplateItem(
  item: any,
  fallbackType: GrantTemplateItemType,
  fallbackKeyPrefix: string,
  parentLabel?: string
): Record<string, unknown> {
  const primitiveLabel =
    typeof item === 'string' || typeof item === 'number'
      ? String(item).trim()
      : '';

  const label = String(
    item?.label ||
      item?.title ||
      item?.name ||
      item?.question ||
      item?.section ||
      item?.heading ||
      item?.subheading ||
      item?.groupLabel ||
      item?.prompt ||
      primitiveLabel ||
      `${fallbackKeyPrefix} item`
  ).trim();

  const key = slugifyTemplateKey(
    item?.key || item?.id || item?.question_id || item?.section_id || primitiveLabel || label,
    fallbackKeyPrefix
  );

  return {
    key,
    label,
    type: coerceItemType(item?.type || item?.fieldType || item?.inputType || item?.kind, fallbackType),
    workflowMode: coerceWorkflowMode(
      item?.workflowMode || item?.workflow_mode || item?.ownershipMode || item?.ownerMode
    ),
    required: Boolean(item?.required ?? item?.mandatory ?? item?.isRequired),
    repeatable: Boolean(item?.repeatable ?? item?.multiple),
    visibleWhen: item?.visibleWhen || item?.condition || item?.visibility || null,
    wordLimit: typeof item?.wordLimit === 'number' ? item.wordLimit : null,
    charLimit: typeof item?.charLimit === 'number' ? item.charLimit : null,
    options: Array.isArray(item?.options)
      ? item.options
      : Array.isArray(item?.choices)
        ? item.choices
        : Array.isArray(item?.enum)
          ? item.enum
          : [],
    schema: item?.schema || item?.properties || item?.validation || null,
    guidance: combineGuidance(
      item?.guidance,
      item?.description,
      item?.instructions,
      item?.notes,
      parentLabel ? `Parent section: ${parentLabel}` : null
    ),
    supportLevel: coerceSupportLevel(item?.supportLevel || item?.support || item?.compatibility, 'partial'),
    confidence: coerceConfidence(item?.confidence),
    sourceAnchors: coerceAnchors(item?.sourceAnchors || item?.anchors),
  };
}

function pickFirstArray(...values: unknown[]): any[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

const FIELD_CHILD_COLLECTION_KEYS = ['questions', 'items', 'fields', 'prompts'] as const;
const SECTION_CHILD_COLLECTION_KEYS = ['sections', 'subsections', 'subSections', 'children', 'blocks', 'groups'] as const;

function pushFlattenedTemplateItem(
  item: any,
  fallbackType: GrantTemplateItemType,
  fallbackKeyPrefix: string,
  normalizedQuestions: Array<Record<string, unknown>>,
  normalizedSections: Array<Record<string, unknown>>,
  parentLabel?: string
): void {
  const coerced = coerceTemplateItem(item, fallbackType, fallbackKeyPrefix, parentLabel);
  if (coerced.type === 'field') {
    normalizedQuestions.push(coerced);
  } else {
    normalizedSections.push(coerced);
  }

  const nextParentLabel = String(coerced.label || parentLabel || '').trim() || parentLabel;
  flattenNestedTemplateChildren(item, normalizedQuestions, normalizedSections, fallbackKeyPrefix, nextParentLabel);
}

function flattenNestedTemplateChildren(
  item: any,
  normalizedQuestions: Array<Record<string, unknown>>,
  normalizedSections: Array<Record<string, unknown>>,
  fallbackKeyPrefix: string,
  parentLabel?: string
): void {
  if (!item || typeof item !== 'object') {
    return;
  }

  for (const key of FIELD_CHILD_COLLECTION_KEYS) {
    const children = Array.isArray(item[key]) ? item[key] : [];
    for (let index = 0; index < children.length; index += 1) {
      pushFlattenedTemplateItem(
        children[index],
        'field',
        `${fallbackKeyPrefix}_${key}_${index + 1}`,
        normalizedQuestions,
        normalizedSections,
        parentLabel
      );
    }
  }

  for (const key of SECTION_CHILD_COLLECTION_KEYS) {
    const children = Array.isArray(item[key]) ? item[key] : [];
    for (let index = 0; index < children.length; index += 1) {
      pushFlattenedTemplateItem(
        children[index],
        'section',
        `${fallbackKeyPrefix}_${key}_${index + 1}`,
        normalizedQuestions,
        normalizedSections,
        parentLabel
      );
    }
  }
}

function coerceBudgetBlock(value: any): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const categories = Array.isArray(value.categories)
    ? value.categories
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.heads)
        ? value.heads
        : [];

  return {
    required: Boolean(value.required),
    yearWise: Boolean(value.yearWise || value.year_wise || value.yearly),
    workflowMode: coerceWorkflowMode(value.workflowMode || value.workflow_mode, 'app_support'),
    categories: categories.map((category: any, index: number) => ({
      key: slugifyTemplateKey(category?.key || category?.label || category?.title || `budget_${index + 1}`, `budget_${index + 1}`),
      label: String(category?.label || category?.title || category?.key || `Budget Category ${index + 1}`).trim(),
      cap: category?.cap || category?.limit || null,
      notes: combineGuidance(category?.notes, category?.description, category?.instructions),
      sourceAnchors: coerceAnchors(category?.sourceAnchors || category?.anchors),
    })),
    caps: value.caps || value.rules || null,
    justificationNotes: combineGuidance(value.justificationNotes, value.notes, value.description),
    supportLevel: coerceSupportLevel(value.supportLevel || value.support, 'partial'),
    confidence: coerceConfidence(value.confidence),
    sourceAnchors: coerceAnchors(value.sourceAnchors || value.anchors),
  };
}

export function coerceTemplateShape(raw: any): Record<string, unknown> {
  const base = raw && typeof raw === 'object' ? raw : {};
  const topLevelQuestions = pickFirstArray(base.questions, base.items, base.fields);
  const topLevelSections = pickFirstArray(base.sections, base.subsections, base.groups);
  const topLevelAttachments = pickFirstArray(base.attachments, base.uploads);
  const topLevelEvaluation = pickFirstArray(base.evaluationCriteria, base.criteria, base.rubrics);
  const submissionRules = base.submissionRules && typeof base.submissionRules === 'object'
    ? base.submissionRules
    : base.submission_rules && typeof base.submission_rules === 'object'
      ? base.submission_rules
      : {};

  const normalizedQuestions: Array<Record<string, unknown>> = [];
  const normalizedSections: Array<Record<string, unknown>> = [];

  for (let index = 0; index < topLevelQuestions.length; index += 1) {
    pushFlattenedTemplateItem(
      topLevelQuestions[index],
      'field',
      `question_${index + 1}`,
      normalizedQuestions,
      normalizedSections
    );
  }

  for (let index = 0; index < topLevelSections.length; index += 1) {
    pushFlattenedTemplateItem(
      topLevelSections[index],
      'section',
      `section_${index + 1}`,
      normalizedQuestions,
      normalizedSections
    );
  }

  return {
    questions: normalizedQuestions,
    sections: normalizedSections,
    budget: coerceBudgetBlock(base.budget || base.budgetTable || base.budget_table),
    attachments: topLevelAttachments.map((item: any, index: number) =>
      coerceTemplateItem(item, 'attachment', `attachment_${index + 1}`)
    ),
    evaluationCriteria: topLevelEvaluation.map((item: any, index: number) =>
      coerceTemplateItem(item, 'rubric', `criterion_${index + 1}`)
    ),
    submissionRules: {
      notes: combineGuidance(submissionRules.notes, submissionRules.description),
      items: Array.isArray(submissionRules.items)
        ? submissionRules.items.map((item: any, index: number) =>
            coerceTemplateItem(item, 'rule', `submission_rule_${index + 1}`)
          )
        : Array.isArray(base.rules)
          ? base.rules.map((item: any, index: number) =>
              coerceTemplateItem(item, 'rule', `submission_rule_${index + 1}`)
            )
          : [],
      sourceAnchors: coerceAnchors(submissionRules.sourceAnchors || submissionRules.anchors),
    },
    sourceAnchors: coerceAnchors(base.sourceAnchors || base.anchors),
    mergeConflicts: Array.isArray(base.mergeConflicts) ? base.mergeConflicts : [],
  };
}

function lenientNormalizeTemplate(raw: any): ReturnType<typeof normalizeGrantTemplate> {
  try {
    return normalizeGrantTemplate(raw);
  } catch (strictError) {
    console.warn('[Funding Template] Strict normalization failed, trying lenient pass:', (strictError as Error).message);
  }

  function stripInvalidAnchors(items: any[]): any[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      ...item,
      sourceAnchors: Array.isArray(item.sourceAnchors)
        ? item.sourceAnchors.filter((a: any) =>
            typeof a?.asset_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.asset_id)
          )
        : [],
    }));
  }

  const patched = { ...raw };
  for (const block of ['questions', 'sections', 'attachments', 'evaluationCriteria'] as const) {
    if (Array.isArray(patched[block])) {
      patched[block] = stripInvalidAnchors(patched[block]);
    }
  }
  if (patched.submissionRules && Array.isArray(patched.submissionRules.items)) {
    patched.submissionRules = {
      ...patched.submissionRules,
      items: stripInvalidAnchors(patched.submissionRules.items),
      sourceAnchors: Array.isArray(patched.submissionRules.sourceAnchors)
        ? patched.submissionRules.sourceAnchors.filter((a: any) =>
            typeof a?.asset_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.asset_id)
          )
        : [],
    };
  }
  if (patched.budget && Array.isArray(patched.budget.sourceAnchors)) {
    patched.budget = {
      ...patched.budget,
      sourceAnchors: patched.budget.sourceAnchors.filter((a: any) =>
        typeof a?.asset_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.asset_id)
      ),
      categories: Array.isArray(patched.budget.categories)
        ? patched.budget.categories.map((c: any) => ({
            ...c,
            sourceAnchors: Array.isArray(c.sourceAnchors)
              ? c.sourceAnchors.filter((a: any) =>
                  typeof a?.asset_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.asset_id)
                )
              : [],
          }))
        : [],
    };
  }
  if (Array.isArray(patched.sourceAnchors)) {
    patched.sourceAnchors = patched.sourceAnchors.filter((a: any) =>
      typeof a?.asset_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.asset_id)
    );
  }

  try {
    return normalizeGrantTemplate(patched);
  } catch (anchorOnlyError) {
    console.warn(
      '[Funding Template] Anchor cleanup was not enough, coercing alternate model shape:',
      (anchorOnlyError as Error).message
    );
  }

  const coerced = coerceTemplateShape(patched);
  return normalizeGrantTemplate(coerced);
}

export async function extractGrantTemplateFromAssets(
  assets: TemplateExtractionAssetInput[]
): Promise<TemplateExtractionResult> {
  const selectedAssets = assets.filter(Boolean);
  if (selectedAssets.length === 0) {
    throw new Error('At least one template asset is required for extraction');
  }

  console.log(`[Funding Template] Starting extraction with ${selectedAssets.length} assets: ${selectedAssets.map((a) => `${a.id} (${a.source_type})`).join(', ')}`);

  const hasBinaryAsset = selectedAssets.some(
    (asset) => (asset.source_type === 'pdf' || asset.source_type === 'image') && asset.storage_path
  );
  const hasTextContent = selectedAssets.some((asset) => Boolean(asset.ocr_text || asset.normalized_text || asset.raw_text));

  if (!hasBinaryAsset && !hasTextContent) {
    throw new Error('Selected assets do not contain extractable text or files');
  }

  let modelResponse: { model: string; rawText: string };
  if (hasBinaryAsset) {
    console.log('[Funding Template] Using multimodal extraction path (binary assets detected)');
    modelResponse = await callGeminiMultimodal(selectedAssets);
  } else {
    console.log('[Funding Template] Using text-only extraction path');
    modelResponse = await callTextExtractor(buildTextOnlyPrompt(selectedAssets));
  }

  const parsed = safeParseJsonResponse(modelResponse.rawText);
  console.log(`[Funding Template] Parsed response keys: ${Object.keys(parsed || {}).join(', ')}`);

  const templateCandidate = parsed?.template || parsed || {};
  const normalizedTemplate = lenientNormalizeTemplate(templateCandidate);
  const assetSequenceById = buildAssetSequenceMap(selectedAssets);
  const orderedTemplate = sortAndDeduplicateGrantTemplate(normalizedTemplate, {
    assetSequenceById,
  });

  const itemCount =
    orderedTemplate.questions.length +
    orderedTemplate.sections.length +
    orderedTemplate.attachments.length +
    orderedTemplate.evaluationCriteria.length +
    orderedTemplate.submissionRules.items.length;
  console.log(`[Funding Template] Extraction produced ${itemCount} total items (questions: ${orderedTemplate.questions.length}, sections: ${orderedTemplate.sections.length})`);

  if (itemCount === 0) {
    console.warn('[Funding Template] Extraction produced an empty template. Raw text preview:', modelResponse.rawText.slice(0, 800));
  }

  const warnings = Array.isArray(parsed?.warnings)
    ? parsed.warnings.map((warning: unknown) => String(warning))
    : [];
  const compatibility = buildCompatibilitySummary(orderedTemplate, warnings);

  return {
    template: orderedTemplate,
    compatibility,
    warnings,
    extractorModel: modelResponse.model,
    extractorVersion: TEMPLATE_EXTRACTOR_VERSION,
    promptVersion: TEMPLATE_PROMPT_VERSION,
    rawOutput: {
      rawText: modelResponse.rawText,
      parsed,
    },
  };
}
