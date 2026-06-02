import fs from 'fs/promises';
import path from 'path';
import { parseJsonResponse } from '../fundingIntake/utils';
import {
  FUNDING_TEMPLATE_EXTRACT_TASK_CODE,
  FUNDING_TEMPLATE_MULTIMODAL_STAGE_CODE,
  FUNDING_TEMPLATE_TEXT_STAGE_CODE,
  runFundingGatewayText,
  type FundingLlmRoutingContext,
} from '../funding/llmRouting';
import {
  normalizeGrantTemplateIntent,
  normalizeGrantTemplateIntentConfidence,
  normalizeGrantTemplateIntentList,
} from '../grants/templateIntent';
import { normalizeGrantWorkflowMode } from '../grants/workflowMode';
import { buildAssetSequenceMap, buildCompatibilitySummary, normalizeGrantTemplate, sortAndDeduplicateGrantTemplate } from './utils';
import type { FundingTemplateCompatibilitySummary, GrantTemplateDocument } from './types';
import type { ContentPart } from '../metering';

const TEMPLATE_PROMPT_VERSION = 'funding-template-v6';
const TEMPLATE_EXTRACTOR_VERSION = 'funding-template-extractor-v6';

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
Classify the top-level budget block as app_draft because the app generates it through a dedicated structured budget drafting stage.
Classify app_support for structured implementation matrices and other structured support blocks that remain manual.
Classify team_manual for personnel details, institution metadata, category selectors, declarations, proofs, certificates, letters, annexures, attachments, signatures, and uploads.
For each response-bearing item, also classify templateIntent using only: summary, problem_need, objectives, methodology, workplan, innovation, evaluation, impact_outcomes, alignment, sustainability, risk, team, budget, eligibility, submission, attachments, institutional, default.
Use templateIntent="default" when the intent is unclear.
Return at most 2 templateIntentAlternates for ambiguity/audit context and a numeric templateIntentConfidence between 0 and 1.
If you see more than 1 plausible alternate, that means the item is ambiguous and downstream routing will fall back to heuristics instead of trusting templateIntent.
Preserve section-specific instructions, reviewer-facing guidance, explicit required inclusions, and exact word/character limits on the extracted item they belong to.
When a heading or prompt includes both the section label and embedded drafting instructions, keep the label concise in "label" and place the drafting instructions in "guidance" without dropping any concrete requirements.
For each response-bearing item, also extract grant-drafting guidance metadata:
- requiredFacts: short, atomic facts or content elements the applicant must provide in this item.
- reviewerGoal: what a reviewer should be convinced of after reading the response.
- forbiddenMoves: explicit do-not instructions, exclusions, unsupported-claim risks, or common non-compliant moves for this item.
- draftingVsSubmission: drafting, submission, or both.
Use draftingVsSubmission="drafting" for proposal narrative, "submission" for uploads/declarations/admin-only fields, and "both" for items that shape narrative and final compliance.
Keep requiredFacts and forbiddenMoves source-grounded; do not invent a proposal strategy that is not implied by the template.
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

function coerceTemplateIntent(value: unknown) {
  return normalizeGrantTemplateIntent(value) || 'default';
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
        "templateIntent": "summary|problem_need|objectives|methodology|workplan|innovation|evaluation|impact_outcomes|alignment|sustainability|risk|team|budget|eligibility|submission|attachments|institutional|default",
        "templateIntentAlternates": ["string"],
        "templateIntentConfidence": 0.0,
        "requiredFacts": ["string"],
        "reviewerGoal": "string|null",
        "forbiddenMoves": ["string"],
        "draftingVsSubmission": "drafting|submission|both",
        "supportLevel": "full|partial|manual|unsupported",
        "confidence": 0.0,
        "sourceAnchors": [
          {
            "asset_id": "asset id",
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
        "templateIntent": "summary|problem_need|objectives|methodology|workplan|innovation|evaluation|impact_outcomes|alignment|sustainability|risk|team|budget|eligibility|submission|attachments|institutional|default",
        "templateIntentAlternates": ["string"],
        "templateIntentConfidence": 0.0,
        "requiredFacts": ["string"],
        "reviewerGoal": "string|null",
        "forbiddenMoves": ["string"],
        "draftingVsSubmission": "drafting|submission|both",
        "supportLevel": "full|partial|manual|unsupported",
        "confidence": 0.0,
        "sourceAnchors": []
      }
    ],
    "budget": {
      "required": true,
      "yearWise": false,
      "workflowMode": "app_draft",
      "columns": [
        {
          "key": "string",
          "label": "string",
          "kind": "category|amount|year|total|co_funding|justification|notes|text|number|null",
          "required": true,
          "sourceAnchors": []
        }
      ],
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
For budget tables, preserve visible column headers in budget.columns. Use stable lowercase snake_case keys. Mark amount, total, year, co-funding, justification, and notes columns with the closest kind. Preserve fixed budget category rows in budget.categories.
For evaluationCriteria and rubric-like blocks, use type "rubric", workflowMode "app_support", and include reviewerGoal or requiredFacts that make the criterion actionable for drafting.
For attachments, declarations, signatures, certificates, CVs, letters, and institutional proofs, use workflowMode "team_manual", templateIntent "attachments" or "institutional", and draftingVsSubmission "submission".
For eligibility or applicant-fit prompts, use templateIntent "eligibility"; use draftingVsSubmission "both" when the answer affects narrative fit and compliance.
For section prompts that ask the applicant to "describe", "justify", "explain", "demonstrate", "provide evidence", or "show impact", set workflowMode "app_draft" unless the field is purely administrative.
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

async function callTextExtractor(
  prompt: string,
  context?: FundingLlmRoutingContext | null
): Promise<{ model: string; rawText: string }> {
  const result = await runFundingGatewayText({
    taskCode: FUNDING_TEMPLATE_EXTRACT_TASK_CODE,
    stageCode: FUNDING_TEMPLATE_TEXT_STAGE_CODE,
    prompt,
    systemPrompt: SYSTEM_INSTRUCTIONS,
    context,
    responseMimeType: 'application/json',
    temperature: 0,
    maxTokensOut: 24000,
    promptCacheKey: `funding-intake:template:${TEMPLATE_PROMPT_VERSION}`,
    promptCacheRetention: '24h',
    skipFeaturePolicy: true,
    metadata: {
      purpose: 'funding_template_text_extract',
      extractorVersion: TEMPLATE_EXTRACTOR_VERSION,
      promptVersion: TEMPLATE_PROMPT_VERSION,
      promptCacheKey: `funding-intake:template:${TEMPLATE_PROMPT_VERSION}`,
    },
  });

  if (!result) {
    throw new Error('No LLM provider configured for funding template extraction');
  }

  return result;
}

async function buildGatewayContentParts(assets: TemplateExtractionAssetInput[]): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  const restParts = await buildGeminiRestParts(assets);

  for (const part of restParts) {
    if (typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
    } else {
      const inlineData = part.inline_data && typeof part.inline_data === 'object'
        ? part.inline_data as Record<string, unknown>
        : null;
      const data = typeof inlineData?.data === 'string' ? inlineData.data : '';
      if (!data) {
        continue;
      }
      const mimeType = typeof inlineData?.mime_type === 'string'
        ? inlineData.mime_type
        : 'application/pdf';
      parts.push(
        mimeType.includes('pdf')
          ? {
              type: 'file',
              file: {
                mimeType,
                data,
              },
            }
          : {
              type: 'image',
              image: {
                mimeType,
                data,
              },
            }
      );
    }
  }

  return parts;
}

async function callGeminiMultimodal(
  assets: TemplateExtractionAssetInput[],
  context?: FundingLlmRoutingContext | null
): Promise<{ model: string; rawText: string }> {
  const result = await runFundingGatewayText({
    taskCode: FUNDING_TEMPLATE_EXTRACT_TASK_CODE,
    stageCode: FUNDING_TEMPLATE_MULTIMODAL_STAGE_CODE,
    prompt: SYSTEM_INSTRUCTIONS,
    context,
    contentParts: await buildGatewayContentParts(assets),
    responseMimeType: 'application/json',
    temperature: 0,
    maxTokensOut: 24000,
    promptCacheKey: `funding-intake:template:${TEMPLATE_PROMPT_VERSION}:multimodal`,
    promptCacheRetention: '24h',
    skipFeaturePolicy: true,
    metadata: {
      purpose: 'funding_template_multimodal_extract',
      extractorVersion: TEMPLATE_EXTRACTOR_VERSION,
      promptVersion: TEMPLATE_PROMPT_VERSION,
      promptCacheKey: `funding-intake:template:${TEMPLATE_PROMPT_VERSION}:multimodal`,
    },
  });

  if (!result) {
    throw new Error('No LLM provider configured for funding template multimodal extraction');
  }

  console.log(`[Funding Template] Gateway response length: ${result.rawText.length} chars`);
  if (result.rawText.length < 50) {
    console.warn(`[Funding Template] Suspiciously short response: ${result.rawText.slice(0, 200)}`);
  }

  return result;
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

function normalizeStringArray(value: unknown, limit = 10): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of source) {
    const normalized = String(item || '').trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
    if (next.length >= limit) break;
  }
  return next;
}

function inferBudgetColumnKind(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!normalized) return null;
  if (/\b(category|head|item|cost item|expense)\b/.test(normalized)) return 'category';
  if (/\b(justification|rationale|basis|description)\b/.test(normalized)) return 'justification';
  if (/\b(co funding|cofunding|matching|match|cost share|contribution)\b/.test(normalized)) return 'co_funding';
  if (/\b(total|subtotal|grand total)\b/.test(normalized)) return 'total';
  if (/\b(year|yr|fy|financial year|fiscal year)\b/.test(normalized)) return 'year';
  if (/\b(amount|cost|budget|requested|funds|salary|fee|rate)\b/.test(normalized)) return 'amount';
  if (/\b(note|remark|comment)\b/.test(normalized)) return 'notes';
  if (/\b(number|qty|quantity|unit)\b/.test(normalized)) return 'number';
  return 'text';
}

function coerceBudgetColumns(value: any): Array<Record<string, unknown>> {
  const source = Array.isArray(value?.columns)
    ? value.columns
    : Array.isArray(value?.headers)
      ? value.headers
      : Array.isArray(value?.fields)
        ? value.fields
        : [];
  const seen = new Set<string>();
  const columns: Array<Record<string, unknown>> = [];

  for (let index = 0; index < source.length; index += 1) {
    const column = source[index];
    const rawLabel = typeof column === 'string'
      ? column
      : column?.label || column?.title || column?.name || column?.key || column?.id;
    const label = String(rawLabel || '').trim();
    if (!label) continue;
    const key = slugifyTemplateKey(
      typeof column === 'string' ? label : column?.key || column?.id || label,
      `column_${index + 1}`
    );
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push({
      key,
      label,
      kind: typeof column === 'string'
        ? inferBudgetColumnKind(label)
        : column?.kind || column?.type || inferBudgetColumnKind(label),
      required: typeof column === 'object' && column !== null ? column.required === true : false,
      sourceAnchors: typeof column === 'object' && column !== null
        ? coerceAnchors(column.sourceAnchors || column.anchors)
        : [],
    });
  }

  return columns;
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
    templateIntent: coerceTemplateIntent(item?.templateIntent || item?.intent || item?.sectionIntent),
    templateIntentAlternates: normalizeGrantTemplateIntentList(
      item?.templateIntentAlternates || item?.intentAlternates || item?.alternateIntents,
      2
    ).filter((intent) => intent !== coerceTemplateIntent(item?.templateIntent || item?.intent || item?.sectionIntent)),
    templateIntentConfidence: normalizeGrantTemplateIntentConfidence(
      item?.templateIntentConfidence || item?.intentConfidence
    ),
    requiredFacts: normalizeStringArray(
      item?.requiredFacts || item?.mustCover || item?.mustInclude || item?.requiredContent,
      8
    ),
    reviewerGoal: combineGuidance(
      item?.reviewerGoal,
      item?.reviewer_goal,
      item?.reviewerIntent,
      item?.reviewer_intent
    ),
    forbiddenMoves: normalizeStringArray(
      item?.forbiddenMoves || item?.mustAvoid || item?.avoid || item?.doNotInclude,
      8
    ),
    draftingVsSubmission: item?.draftingVsSubmission || item?.drafting_vs_submission || item?.draftingMode || undefined,
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
    workflowMode: 'app_draft',
    columns: coerceBudgetColumns(value),
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

  const hasUsableAssetId = (anchor: any) =>
    typeof anchor?.asset_id === 'string' && anchor.asset_id.trim().length > 0;

  function stripInvalidAnchors(items: any[]): any[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      ...item,
      sourceAnchors: Array.isArray(item.sourceAnchors)
        ? item.sourceAnchors.filter(hasUsableAssetId)
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
        ? patched.submissionRules.sourceAnchors.filter(hasUsableAssetId)
        : [],
    };
  }
  if (patched.budget) {
    patched.budget = {
      ...patched.budget,
      sourceAnchors: Array.isArray(patched.budget.sourceAnchors)
        ? patched.budget.sourceAnchors.filter(hasUsableAssetId)
        : [],
      columns: Array.isArray(patched.budget.columns)
        ? patched.budget.columns.map((c: any) => ({
            ...c,
            sourceAnchors: Array.isArray(c.sourceAnchors)
              ? c.sourceAnchors.filter(hasUsableAssetId)
              : [],
          }))
        : [],
      categories: Array.isArray(patched.budget.categories)
        ? patched.budget.categories.map((c: any) => ({
            ...c,
            sourceAnchors: Array.isArray(c.sourceAnchors)
              ? c.sourceAnchors.filter(hasUsableAssetId)
              : [],
          }))
        : [],
    };
  }
  if (Array.isArray(patched.sourceAnchors)) {
    patched.sourceAnchors = patched.sourceAnchors.filter(hasUsableAssetId);
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
  assets: TemplateExtractionAssetInput[],
  context?: FundingLlmRoutingContext | null
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
    modelResponse = await callGeminiMultimodal(selectedAssets, context);
  } else {
    console.log('[Funding Template] Using text-only extraction path');
    modelResponse = await callTextExtractor(buildTextOnlyPrompt(selectedAssets), context);
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
