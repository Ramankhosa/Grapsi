import { generateFromGemini } from '../geminiService';
import { generateFromOpenAI } from '../openaiService';
import { parseJsonResponse } from '../fundingIntake/utils';
import type { GuidelinePackDocument } from './types';
import { normalizeGuidelinePack } from './utils';

const FUNDING_GUIDELINE_PROMPT_VERSION = 'funding-guideline-v2';
const FUNDING_GUIDELINE_EXTRACTOR_VERSION = '1.0.0';

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
Return strict JSON only.
`;

function buildPrompt(input: GuidelineExtractionInput) {
  return `
${SYSTEM_INSTRUCTIONS}

Return JSON in this exact shape:
{
  "priorities": [{ "key": string, "text": string, "importance": "high"|"medium"|"low", "rationale": string|null, "confidence": number, "sourceAnchors": [{ "sourceType": "raw_text"|"normalized_text"|"official_url"|"field"|"manual", "fieldKey": string|null, "url": string|null, "quote": string|null, "note": string|null, "confidence": number|null }] }],
  "mustAddress": [{ ...same shape as priorities items... }],
  "avoid": [{ ...same shape as priorities items... }],
  "evaluationCriteria": [{ ...same shape as priorities items... }],
  "budgetRules": [{ ...same shape as priorities items... }],
  "durationRules": [{ ...same shape as priorities items... }],
  "formatRules": [{ ...same shape as priorities items... }],
  "submissionRules": [{ ...same shape as priorities items... }],
  "deliverableRules": [{ ...same shape as priorities items... }],
  "reviewerSignals": [{ ...same shape as priorities items... }],
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

Canonical funding call facts:
${JSON.stringify(
    {
      fundingCallId: input.fundingCallId,
      agencyName: input.agencyName,
      schemeTitle: input.schemeTitle,
      description: input.description,
      openDate: input.openDate,
      closeDate: input.closeDate,
      isRolling: input.isRolling,
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
      extractedJson: input.extractedJson,
    },
    null,
    2
  )}

Primary source text:
${(input.normalizedText || input.rawText || '').slice(0, 80000)}
`;
}

async function callExtractor(prompt: string) {
  if (process.env.GOOGLE_AI_API_KEY) {
    const model = process.env.FUNDING_GUIDELINE_GEMINI_MODEL || 'gemini-2.5-pro';
    const rawText = await generateFromGemini(prompt, model);
    return { model, rawText };
  }

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.FUNDING_GUIDELINE_OPENAI_MODEL || 'gpt-4.1-mini';
    const rawText = await generateFromOpenAI(prompt, model, SYSTEM_INSTRUCTIONS);
    return { model, rawText };
  }

  throw new Error('No LLM provider configured for guideline extraction');
}

export async function extractFundingGuidelines(input: GuidelineExtractionInput): Promise<{
  guidelinePack: GuidelinePackDocument;
  rawOutput: unknown;
  extractorModel: string;
  extractorVersion: string;
  promptVersion: string;
}> {
  const prompt = buildPrompt(input);
  const { model, rawText } = await callExtractor(prompt);
  const rawOutput = parseJsonResponse(rawText);
  const guidelinePack = normalizeGuidelinePack(rawOutput);

  return {
    guidelinePack,
    rawOutput,
    extractorModel: model,
    extractorVersion: FUNDING_GUIDELINE_EXTRACTOR_VERSION,
    promptVersion: FUNDING_GUIDELINE_PROMPT_VERSION,
  };
}
