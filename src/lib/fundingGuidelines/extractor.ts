import {
  FUNDING_GUIDELINE_EXTRACT_TASK_CODE,
  FUNDING_GUIDELINE_TEXT_STAGE_CODE,
  runFundingGatewayText,
  type FundingLlmRoutingContext,
} from '../funding/llmRouting';
import { parseJsonResponse } from '../fundingIntake/utils';
import type { GuidelinePackDocument } from './types';
import { normalizeGuidelinePack } from './utils';

const FUNDING_GUIDELINE_PROMPT_VERSION = 'funding-guideline-v3';
const FUNDING_GUIDELINE_EXTRACTOR_VERSION = '1.1.0';

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
For each rule, include routing metadata when the source makes it clear: ruleClass, enforcementLevel, appliesTo, draftingStage, draftingVsSubmission, and detectorHints. Downstream grant prep and compliance use these fields to route the right rule to the right proposal section.
Return strict JSON only.
`;

function buildPrompt(input: GuidelineExtractionInput) {
  return `
${SYSTEM_INSTRUCTIONS}

Return JSON in this exact shape:
{
  "priorities": [{ "key": string, "text": string, "importance": "high"|"medium"|"low", "ruleClass": "priority|must_address|avoid|evaluation|budget|duration|format|submission|deliverable|reviewer_signal|other", "enforcementLevel": "hard|soft|info", "appliesTo": ["summary|problem_need|objectives|methodology|workplan|innovation|evaluation|impact_outcomes|alignment|sustainability|risk|team|budget|eligibility|submission|attachments|institutional|all"], "draftingStage": ["ideation|problem_definition|root_cause|beneficiaries|fit_and_scope|methodology|team_and_partnerships|outcomes|evaluation|risk_and_ethics|budget_strategy|innovation"], "draftingVsSubmission": "drafting|submission|both", "detectorHints": ["string"], "rationale": string|null, "confidence": number, "sourceAnchors": [{ "sourceType": "raw_text"|"normalized_text"|"official_url"|"field"|"manual", "fieldKey": string|null, "url": string|null, "quote": string|null, "note": string|null, "confidence": number|null }] }],
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

Routing metadata guidance:
- ruleClass should mirror the selected block unless the rule text clearly belongs elsewhere.
- enforcementLevel="hard" for mandatory requirements, prohibitions, eligibility constraints, caps, deadlines, page/word/format limits, and submission obligations.
- enforcementLevel="soft" for priorities, reviewer preferences, and evaluation emphasis that should shape drafting but are not strict compliance gates.
- enforcementLevel="info" only for low-risk contextual notes.
- draftingVsSubmission="drafting" for narrative content the proposal writer must address, "submission" for portal/upload/admin steps, and "both" for rules that affect both writing and final compliance.
- appliesTo should name proposal/template section semantics the rule directly affects. Use "all" only when the rule is genuinely global.
- draftingStage should name visible grant-prep stages where the rule should appear. Use fit_and_scope for priority alignment, methodology for workplan/timeline/deliverables, and innovation for sustainability or scale. Prefer precise stages over broad "all".
- detectorHints should be short compliance/audit hints such as word_limit, character_limit, format_rule, budget_limit, duration_limit, submission_checklist, priority_alignment, deliverable_presence, evaluation_metric, eligibility_constraint, required_evidence, reviewer_signal, or avoid_claim.
- Put applicant eligibility, host/institution eligibility, consortium, PI, citizenship/residency, and exclusion rules in mustAddress or avoid as appropriate, with draftingVsSubmission="both" when they shape both narrative fit and final compliance.
- Put research-area fit, mission/thrust alignment, target beneficiaries, impact pathway, adoption/commercialization, sustainability, team capacity, methodology rigor, evaluation metrics, risk/ethics, and dissemination requirements into the most specific blocks available.

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

async function callExtractor(prompt: string, context?: FundingLlmRoutingContext | null) {
  const result = await runFundingGatewayText({
    taskCode: FUNDING_GUIDELINE_EXTRACT_TASK_CODE,
    stageCode: FUNDING_GUIDELINE_TEXT_STAGE_CODE,
    prompt,
    systemPrompt: SYSTEM_INSTRUCTIONS,
    context,
    responseMimeType: 'application/json',
    temperature: 0,
    maxTokensOut: 16000,
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
  const prompt = buildPrompt(input);
  const { model, rawText } = await callExtractor(prompt, input.llmContext);
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
