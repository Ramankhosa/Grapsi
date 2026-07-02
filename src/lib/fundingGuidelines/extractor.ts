import {
  FUNDING_GUIDELINE_EXTRACT_TASK_CODE,
  FUNDING_GUIDELINE_TEXT_STAGE_CODE,
  runFundingGatewayText,
  type FundingLlmRoutingContext,
} from '../funding/llmRouting';
import { parseJsonResponse } from '../fundingIntake/utils';
import type { GuidelinePackDocument } from './types';
import { normalizeGuidelinePack } from './utils';

const FUNDING_GUIDELINE_PROMPT_VERSION = 'funding-guideline-v4';
const FUNDING_GUIDELINE_EXTRACTOR_VERSION = '1.2.0';
const MAX_GUIDELINE_SOURCE_CHARS = 40000;

export type GuidelineExtractionInput = {
  fundingCallId: string;
  agencyName: string;
  schemeTitle: string;
  description: string;
  openDate: string | null;
  closeDate: string | null;
  isRolling: boolean;
  geographyScope: string | null;
  eligibleCountries: string[];
  eligibleRegions: string[];
  hostCountries: string[];
  funderCountry: string | null;
  fundingKinds: string[];
  institutionTypes: string[];
  careerStages: string[];
  citizenshipRequirements: string[];
  residencyRequirements: string[];
  applicationLanguages: string[];
  disciplines: string[];
  amountMin: number | null;
  amountMax: number | null;
  currency: string | null;
  projectDurationMinMonths: number | null;
  projectDurationMaxMonths: number | null;
  projectDurationText: string | null;
  eligibilityText: string | null;
  expectedDeliverablesText: string | null;
  officialUrls: string[];
  contactInfo: string | null;
  sponsorType: string | null;
  rawText: string | null;
  normalizedText: string | null;
  extractedJson: unknown;
  llmContext?: FundingLlmRoutingContext | null;
};

const SYSTEM_INSTRUCTIONS = `
You extract grant-writing guidelines and constraints from a funding call.
Focus on reviewer-facing guidance, application constraints, and rule-like information.
Do not reconstruct the application template structure here.
Only return rules explicitly supported by the source facts or source text.
If a block is unsupported, return an empty array for that block.
Keep rule extraction atomic: split combined paragraphs into separate rule items whenever the source states separate obligations, limits, or reviewer expectations.
Preserve exact numeric limits, page caps, character caps, file-format constraints, and explicit must/do-not wording from the source whenever available.
Separate narrative/reviewer rules from operational submission steps as cleanly as the source allows.
Return concise rules. Include appliesTo, draftingStage, and draftingVsSubmission only when the source makes the routing clear; deterministic normalization enriches omitted routing metadata for Grant Prep.
Return no more than 6 non-duplicate rules per block. Prefer hard requirements and high-value reviewer guidance.
Return strict JSON only.
`;

function compactCanonicalFacts(input: GuidelineExtractionInput) {
  return Object.fromEntries(Object.entries({
    fundingCallId: input.fundingCallId,
    agencyName: input.agencyName,
    schemeTitle: input.schemeTitle,
    description: input.description,
    openDate: input.openDate,
    closeDate: input.closeDate,
    isRolling: input.isRolling || undefined,
    geographyScope: input.geographyScope,
    eligibleCountries: input.eligibleCountries,
    eligibleRegions: input.eligibleRegions,
    hostCountries: input.hostCountries,
    funderCountry: input.funderCountry,
    fundingKinds: input.fundingKinds,
    institutionTypes: input.institutionTypes,
    careerStages: input.careerStages,
    citizenshipRequirements: input.citizenshipRequirements,
    residencyRequirements: input.residencyRequirements,
    applicationLanguages: input.applicationLanguages,
    disciplines: input.disciplines,
    amountMin: input.amountMin,
    amountMax: input.amountMax,
    currency: input.currency,
    projectDurationMinMonths: input.projectDurationMinMonths,
    projectDurationMaxMonths: input.projectDurationMaxMonths,
    projectDurationText: input.projectDurationText,
    eligibilityText: input.eligibilityText,
    expectedDeliverablesText: input.expectedDeliverablesText,
    officialUrls: input.officialUrls,
    contactInfo: input.contactInfo,
    sponsorType: input.sponsorType,
  }).filter(([, value]) => value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)));
}

const HIGH_SIGNAL_GUIDELINE_PATTERN = /\b(must|shall|required|mandatory|eligible|eligibility|priority|criterion|criteria|evaluate|review|score|budget|cost|funding|amount|duration|timeline|deadline|submit|submission|portal|upload|attachment|annex|page|word|character|font|format|deliverable|milestone|report|prohibited|cannot|may not)\b|[$€£₹]|\d+\s*(?:%|pages?|words?|characters?|months?|years?)/gi;

export function selectGuidelineSourceText(source: string, maxChars = MAX_GUIDELINE_SOURCE_CHARS) {
  const normalized = source.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) return normalized;

  const chunks = normalized.match(/[\s\S]{1,1600}/g) || [normalized];
  const selected = new Set<number>();
  const edgeCount = Math.min(4, chunks.length);
  for (let index = 0; index < edgeCount; index += 1) {
    selected.add(index);
    selected.add(chunks.length - 1 - index);
  }

  const ranked = chunks
    .map((chunk, index) => {
      const matches = chunk.match(HIGH_SIGNAL_GUIDELINE_PATTERN)?.length || 0;
      return { index, score: matches };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  let selectedLength = Array.from(selected).reduce((total, index) => total + chunks[index].length + 2, 0);
  for (const candidate of ranked) {
    if (selected.has(candidate.index)) continue;
    if (selectedLength + chunks[candidate.index].length + 2 > maxChars) continue;
    selected.add(candidate.index);
    selectedLength += chunks[candidate.index].length + 2;
  }

  return Array.from(selected)
    .sort((left, right) => left - right)
    .map((index) => chunks[index].trim())
    .join('\n\n')
    .slice(0, maxChars);
}

function buildPrompt(input: GuidelineExtractionInput) {
  return `
Return JSON in this exact shape:
{
  "priorities": [{ "key": string, "text": string, "importance": "high"|"medium"|"low", "appliesTo"?: [string], "draftingStage"?: [string], "draftingVsSubmission"?: "drafting"|"submission"|"both", "rationale"?: string|null, "confidence": number, "sourceAnchors": [{ "sourceType": "raw_text"|"normalized_text"|"official_url"|"field"|"manual", "fieldKey"?: string|null, "url"?: string|null, "quote"?: string|null }] }],
  "mustAddress": [{ ...same shape as priorities items... }],
  "avoid": [{ ...same shape as priorities items... }],
  "evaluationCriteria": [{ ...same shape as priorities items... }],
  "budgetRules": [{ ...same shape as priorities items... }],
  "durationRules": [{ ...same shape as priorities items... }],
  "formatRules": [{ ...same shape as priorities items... }],
  "submissionRules": [{ ...same shape as priorities items... }],
  "deliverableRules": [{ ...same shape as priorities items... }],
  "reviewerSignals": [{ ...same compact shape as priorities items... }],
  "sourceAnchors": [{ "sourceType": "raw_text"|"normalized_text"|"official_url"|"field"|"manual", "fieldKey": string|null, "url": string|null, "quote": string|null, "note": string|null, "confidence": number|null }]
}

Classification guidance:
- priorities: big themes or strategic emphases the proposal should foreground
- mustAddress: non-optional issues the proposal narrative must cover
- avoid: common mistakes, prohibited moves, or non-compliant behaviors
- evaluationCriteria: how reviewers appear to judge the proposal
- budgetRules: caps, non-allowable costs, justification expectations, year-wise rules
- durationRules: minimum/maximum/fixed durations and milestone timing constraints
- formatRules: page limits, section limits, formatting, file-format or structure constraints
- submissionRules: procedural submission rules, deadlines, portal steps, attachments timing
- deliverableRules: outputs, reports, pilots, dissemination, milestones
- reviewerSignals: what usually signals a strong submission from the call language

Optional routing guidance:
- draftingVsSubmission="drafting" for narrative content the proposal writer must address, "submission" for portal/upload/admin steps, and "both" for rules that affect both writing and final compliance.
- appliesTo should name proposal/template section semantics the rule directly affects. Use "all" only when the rule is genuinely global.
- draftingStage should name visible grant-prep stages where the rule should appear. Use fit_and_scope for priority alignment, methodology for workplan/timeline/deliverables, and innovation for sustainability or scale. Prefer precise stages over broad "all".
- Put applicant eligibility, host/institution eligibility, consortium, PI, citizenship/residency, and exclusion rules in mustAddress or avoid as appropriate, with draftingVsSubmission="both" when they shape both narrative fit and final compliance.
- Put research-area fit, mission/thrust alignment, target beneficiaries, impact pathway, adoption/commercialization, sustainability, team capacity, methodology rigor, evaluation metrics, risk/ethics, and dissemination requirements into the most specific blocks available.

Canonical funding call facts:
${JSON.stringify(compactCanonicalFacts(input))}

Primary source text:
${selectGuidelineSourceText(input.normalizedText || input.rawText || '')}
`;
}

async function callExtractor(prompt: string, context?: FundingLlmRoutingContext | null) {
  const result = await runFundingGatewayText({
    taskCode: FUNDING_GUIDELINE_EXTRACT_TASK_CODE,
    stageCode: FUNDING_GUIDELINE_TEXT_STAGE_CODE,
    prompt,
    systemPrompt: SYSTEM_INSTRUCTIONS,
    context,
    responseMimeType: 'application/json',
    temperature: 0,
    maxTokensOut: 7000,
    promptCacheKey: `funding-intake:guidelines:${FUNDING_GUIDELINE_PROMPT_VERSION}`,
    promptCacheRetention: '24h',
    skipFeaturePolicy: true,
    metadata: {
      purpose: 'funding_guideline_extract',
      extractorVersion: FUNDING_GUIDELINE_EXTRACTOR_VERSION,
      promptVersion: FUNDING_GUIDELINE_PROMPT_VERSION,
      promptCacheKey: `funding-intake:guidelines:${FUNDING_GUIDELINE_PROMPT_VERSION}`,
    },
  });

  if (!result) {
    throw new Error('No LLM provider configured for guideline extraction');
  }

  return result;
}

export async function extractFundingGuidelines(input: GuidelineExtractionInput): Promise<{
  guidelinePack: GuidelinePackDocument;
  rawOutput: unknown;
  extractorModel: string;
  extractorVersion: string;
  promptVersion: string;
}> {
  const startedAt = Date.now();
  const prompt = buildPrompt(input);
  console.info(`[Funding Guidelines] extraction started promptChars=${prompt.length} sourceChars=${(input.normalizedText || input.rawText || '').length}`);
  const { model, rawText } = await callExtractor(prompt, input.llmContext);
  const rawOutput = parseJsonResponse(rawText);
  const guidelinePack = normalizeGuidelinePack(rawOutput);
  console.info(`[Funding Guidelines] extraction completed model=${model} durationMs=${Date.now() - startedAt} outputChars=${rawText.length}`);

  return {
    guidelinePack,
    rawOutput,
    extractorModel: model,
    extractorVersion: FUNDING_GUIDELINE_EXTRACTOR_VERSION,
    promptVersion: FUNDING_GUIDELINE_PROMPT_VERSION,
  };
}
