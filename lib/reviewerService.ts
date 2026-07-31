// @ts-nocheck
import crypto from 'crypto';

import { llmGateway } from '@/lib/metering/gateway';
import {
  hasMeaningfulSectionContent,
  normalizeStringArray,
  parseReviewerScore,
} from '@/lib/reviewer/content';
import {
  buildReviewerPromptScope,
  dedupeStrings,
  normalizeKey,
} from '@/lib/reviewer/promptScope';
import { generateFromOpenAI } from './openaiService';
import { generateFromGemini } from './geminiService';

const GRANT_REVIEWER_FULL_REVIEW_STAGE = 'GRANT_REVIEWER_FULL_REVIEW';
const GRANT_REVIEWER_FULL_REVIEW_FALLBACK_MODEL = 'gemini-2.5-pro';

function normalizeRequestHeaders(headers?: Record<string, string | string[] | undefined>) {
  if (!headers) return null;
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === 'string' || Array.isArray(value))
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value as string])
  );
}

async function executeConfiguredGrantReviewerReview(input: {
  prompt: string;
  requestHeaders?: Record<string, string | string[] | undefined>;
  tenantContext?: any;
  stageCode?: string;
  promptCacheKey?: string;
}) {
  const request = input.tenantContext
    ? { tenantContext: input.tenantContext }
    : input.requestHeaders
      ? { headers: normalizeRequestHeaders(input.requestHeaders) || {} }
      : null;

  if (!request) return null;

  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'GRANT_SECTION_GENERATE',
    stageCode: input.stageCode || GRANT_REVIEWER_FULL_REVIEW_STAGE,
    prompt: input.prompt,
    inputTokens: Math.ceil(input.prompt.length / 4),
    parameters: {
      temperature: 0.2,
      // Every section of one funding call shares an identical prompt prefix
      // (persona, call context, global rules, output schema). Caching it means
      // only the section-specific tail is billed at full rate after the first
      // review in a workspace.
      ...(input.promptCacheKey
        ? { prompt_cache_key: input.promptCacheKey, prompt_cache_retention: '24h' }
        : {}),
    },
    metadata: {
      skipFeaturePolicy: true,
      operation: 'grant_reviewer_full_review',
      ...(input.promptCacheKey ? { promptCacheKey: input.promptCacheKey } : {}),
    },
    idempotencyKey: `grant-reviewer-full-review-${crypto.randomUUID()}`,
  });

  if (!result.success || !result.response?.output) {
    console.warn('Configured grant reviewer full-review model failed; falling back to direct Gemini call:', result.error);
    return null;
  }

  return result.response.output;
}

// Define the section order based on the specified review flow
export const SECTION_ORDER = [
  'Abstract',
  'Introduction',
  'Objectives',
  'Literature Review',
  'Methodology',
  'Project Timeline',
  'Budget Justification',
  'Team Expertise',
  'Expected Outcomes',
  'Societal Impact',
  'Sustainability',
  'Risk & Mitigation',
  'IP & Commercialization',
  'Conclusion'
];

// Define dependencies between sections for contextual review
export const SECTION_DEPENDENCIES: Record<string, string[]> = {
  // Abstract depends on nothing (it's usually the first section)
  'abstract': [],
  
  // Introduction depends on Abstract
  'introduction': ['abstract'],
  
  // Literature Review depends on Introduction and Abstract
  'literature_review': ['introduction', 'abstract'],
  
  // Objectives depend on Abstract and Introduction
  'objectives': ['abstract', 'introduction'],
  
  // Methodology depends on Objectives and Literature Review
  'methodology': ['objectives', 'literature_review'],
  
  // Project Timeline depends on Methodology and Objectives
  'timeline': ['methodology', 'objectives'],
  
  // Budget Justification depends on Methodology and Project Timeline
  'budget': ['methodology', 'timeline'],
  
  // Expected Outcomes depends on Objectives and Methodology
  'outcomes': ['objectives', 'methodology'],
  
  // Conclusion depends on Abstract, Objectives, Expected Outcomes, and any Impact sections
  'conclusion': ['abstract', 'objectives', 'outcomes', 'impact'],
  
  // Default dependency is on all previous sections
  'default': []
};

type ReviewInput = {
  section: {
    section_title: string;
    user_input: string;
    is_revision: boolean;
    version: number;
  };
  previousSection?: {
    section_title: string;
    user_input: string;
    ai_review_json: any;
    context_summary?: string;
  } | null;
  contextSection?: {
    section_title: string;
    ai_review_json: any;
    context_summary?: string;
  } | null;
  priorSectionSummaries?: {
    section_title: string;
    context_summary: string;
  }[];
  callData: any;
  modelType: string;
  requestHeaders?: Record<string, string | string[] | undefined>;
  tenantContext?: any;
  stageCode?: string;
};

type ReviewResult = {
  review: {
    score: number;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    improvement_over_previous?: boolean;
    context_summary?: string;
  };
  isImprovement: boolean;
};

function formatRuleList(title: string, rules: string[], fallback: string): string {
  return `${title}:\n${rules.length > 0 ? rules.map((rule) => `- ${rule}`).join('\n') : `- ${fallback}`}`;
}

/**
 * Stable cache key for the call-wide prompt prefix. Identical prefix bytes
 * across sections produce the same key, so the provider can serve the persona,
 * call context, global rules, and response schema from cache after the first
 * section review in a workspace.
 */
function promptPrefixCacheKey(prefix: string): string {
  return crypto.createHash('sha256').update(prefix).digest('hex').slice(0, 32);
}

/**
 * A full prior review JSON is mostly prose the model does not need again.
 * Re-sending only what the revision is judged against keeps revision reviews
 * from costing noticeably more than first-pass reviews.
 */
function summarizePreviousReview(reviewJson: any): string {
  if (!reviewJson || typeof reviewJson !== 'object') return 'No previous review is available.';

  const lines = [
    typeof reviewJson.score === 'number' ? `Score: ${reviewJson.score}` : '',
    ...dedupeStrings(reviewJson.weaknesses || [], 8).map((item) => `Weakness: ${item}`),
    ...dedupeStrings(reviewJson.suggestions || reviewJson.recommendations || [], 8).map(
      (item) => `Suggestion: ${item}`
    ),
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : 'The previous review recorded no weaknesses or suggestions.';
}

/**
 * Which sections are actually consumed as review context by some other
 * section. Only these need a pre-generated context summary; generating one for
 * a section nothing depends on (a Conclusion, an IP annexure) is a paid call
 * whose output is never read.
 */
export function selectContextProviderTitles(sectionTitles: string[]): Set<string> {
  const needed = new Set<string>();

  for (const title of sectionTitles) {
    const candidates = sectionTitles
      .filter((other) => other !== title)
      .map((other) => ({ section_title: other, context_summary: '' }));

    for (const relevant of filterRelevantContextSummaries(title, candidates)) {
      needed.add(relevant.section_title);
    }
  }

  return needed;
}

function normalizeSectionRecommendations(reviewJson: any, scope: any): any[] {
  const validKeys = new Set((scope.linkedSectionKeys || []).map((key: string) => normalizeKey(key)));
  const raw = Array.isArray(reviewJson?.section_recommendations) ? reviewJson.section_recommendations : [];
  const normalized = raw
    .map((item: any) => {
      const sectionKey = String(item?.sectionKey || '').trim();
      if (!sectionKey || !validKeys.has(normalizeKey(sectionKey))) return null;
      const recommendation = String(item?.recommendation || item?.suggestedRemark || item?.issue || '').trim();
      if (!recommendation) return null;
      return {
        sectionKey,
        priority: ['high', 'medium', 'low'].includes(String(item?.priority || '').toLowerCase())
          ? String(item.priority).toLowerCase()
          : 'medium',
        issue: String(item?.issue || recommendation).trim(),
        recommendation,
        suggestedRemark: String(item?.suggestedRemark || recommendation).trim(),
        autoFixable: item?.autoFixable !== false,
        linkedRuleKeys: Array.isArray(item?.linkedRuleKeys) ? item.linkedRuleKeys.map(String).filter(Boolean) : [],
      };
    })
    .filter(Boolean);

  if (normalized.length > 0 || validKeys.size !== 1) return normalized;

  const [sectionKey] = scope.linkedSectionKeys || [];
  return normalizeStringArray(reviewJson?.suggestions || reviewJson?.recommendations).slice(0, 6).map((suggestion) => ({
    sectionKey,
    priority: 'medium',
    issue: suggestion,
    recommendation: suggestion,
    suggestedRemark: suggestion,
    autoFixable: true,
    linkedRuleKeys: [],
  }));
}

const COMPLIANCE_STATUSES = new Set(['met', 'partial', 'missing', 'unverifiable']);
const ADDRESSED_STATUSES = new Set(['addressed', 'partially', 'not_addressed']);

export interface AddressedPreviousPoint {
  point: string;
  status: 'addressed' | 'partially' | 'not_addressed';
  evidence: string;
}

/**
 * The revision review's account of what happened to each earlier remark. This
 * is what lets the UI show "4 of 6 previous points resolved" without a second
 * comparison call.
 */
export function normalizeAddressedPreviousPoints(value: unknown): AddressedPreviousPoint[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: AddressedPreviousPoint[] = [];

  for (const item of value) {
    const point = String((item as any)?.point || (item as any)?.issue || '').trim();
    if (!point) continue;
    const key = point.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const status = String((item as any)?.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    next.push({
      point,
      status: (ADDRESSED_STATUSES.has(status) ? status : 'partially') as AddressedPreviousPoint['status'],
      evidence: String((item as any)?.evidence || '').trim(),
    });
  }

  return next.slice(0, 20);
}

export function summarizeAddressedPoints(points: AddressedPreviousPoint[]) {
  return {
    total: points.length,
    addressed: points.filter((point) => point.status === 'addressed').length,
    partially: points.filter((point) => point.status === 'partially').length,
    notAddressed: points.filter((point) => point.status === 'not_addressed').length,
  };
}

/**
 * Per-criterion scores let the final report show a panel-style scorecard
 * instead of one opaque number. Anything without a criterion label or a usable
 * score is dropped rather than guessed at.
 */
export function normalizeCriterionScores(value: unknown): Array<{ criterion: string; score: number; evidence: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: Array<{ criterion: string; score: number; evidence: string }> = [];

  for (const item of value) {
    const criterion = String((item as any)?.criterion || (item as any)?.label || '').trim();
    if (!criterion) continue;
    const key = criterion.toLowerCase();
    if (seen.has(key)) continue;

    const raw = (item as any)?.score;
    const score = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    if (!Number.isFinite(score)) continue;

    seen.add(key);
    next.push({
      criterion,
      score: Math.max(0, Math.min(10, score)),
      evidence: String((item as any)?.evidence || '').trim(),
    });
  }

  return next.slice(0, 12);
}

export function normalizeComplianceFlags(value: unknown): Array<{ rule: string; status: string; detail: string }> {
  if (!Array.isArray(value)) return [];
  const next: Array<{ rule: string; status: string; detail: string }> = [];

  for (const item of value) {
    const rule = String((item as any)?.rule || '').trim();
    if (!rule) continue;
    const status = String((item as any)?.status || '').trim().toLowerCase();
    next.push({
      rule,
      status: COMPLIANCE_STATUSES.has(status) ? status : 'unverifiable',
      detail: String((item as any)?.detail || '').trim(),
    });
  }

  return next.slice(0, 20);
}

// Get section position in the logical review flow
export function getSectionPosition(sectionTitle: string): number {
  const normalizedTitle = sectionTitle.trim().toLowerCase();
  
  // Check for exact matches first
  const exactIndex = SECTION_ORDER.findIndex(
    title => title.toLowerCase() === normalizedTitle
  );
  
  if (exactIndex !== -1) return exactIndex;
  
  // Check for partial matches
  for (let i = 0; i < SECTION_ORDER.length; i++) {
    if (normalizedTitle.includes(SECTION_ORDER[i].toLowerCase()) || 
        SECTION_ORDER[i].toLowerCase().includes(normalizedTitle)) {
      return i;
    }
  }
  
  // If no match found, return a high number to place at the end
  return 999;
}

/**
 * Filters context summaries based on section dependencies
 * @param sectionTitle The title of the current section being reviewed
 * @param allContextSummaries All available context summaries
 * @returns Only the context summaries relevant for reviewing the current section
 */
export function filterRelevantContextSummaries(
  sectionTitle: string,
  allContextSummaries: { section_title: string, context_summary: string }[]
): { section_title: string, context_summary: string }[] {
  // Normalize section title for matching
  const normalizedSectionTitle = sectionTitle.toLowerCase();
  
  // Find the matching dependency key
  let dependencyKey = 'default';
  
  // Check for each section type
  if (normalizedSectionTitle.includes('abstract')) {
    dependencyKey = 'abstract';
  } else if (normalizedSectionTitle.includes('introduction') || normalizedSectionTitle.includes('background')) {
    dependencyKey = 'introduction';
  } else if (normalizedSectionTitle.includes('literature') || normalizedSectionTitle.includes('prior work')) {
    dependencyKey = 'literature_review';
  } else if (normalizedSectionTitle.includes('objective') || normalizedSectionTitle.includes('goal')) {
    dependencyKey = 'objectives';
  } else if (normalizedSectionTitle.includes('method') || normalizedSectionTitle.includes('approach')) {
    dependencyKey = 'methodology';
  } else if (normalizedSectionTitle.includes('timeline') || normalizedSectionTitle.includes('schedule')) {
    dependencyKey = 'timeline';
  } else if (normalizedSectionTitle.includes('budget')) {
    dependencyKey = 'budget';
  } else if (normalizedSectionTitle.includes('outcome') || normalizedSectionTitle.includes('result')) {
    dependencyKey = 'outcomes';
  } else if (normalizedSectionTitle.includes('conclusion') || normalizedSectionTitle.includes('summary')) {
    dependencyKey = 'conclusion';
  }
  
  // If we don't have specific dependencies for this section type, return all summaries
  if (dependencyKey === 'default' || !SECTION_DEPENDENCIES[dependencyKey]) {
    return allContextSummaries;
  }
  
  // Get the dependency list for this section
  const dependencies = SECTION_DEPENDENCIES[dependencyKey];
  
  // If no dependencies, return empty array
  if (dependencies.length === 0) {
    return [];
  }
  
  // Filter context summaries based on dependencies
  return allContextSummaries.filter(summary => {
    const normalizedTitle = summary.section_title.toLowerCase();
    
    // Check if this summary's section matches any of the dependencies
    return dependencies.some(dep => {
      if (dep === 'abstract') {
        return normalizedTitle.includes('abstract');
      } else if (dep === 'introduction') {
        return normalizedTitle.includes('introduction') || normalizedTitle.includes('background');
      } else if (dep === 'literature_review') {
        return normalizedTitle.includes('literature') || normalizedTitle.includes('prior work');
      } else if (dep === 'objectives') {
        return normalizedTitle.includes('objective') || normalizedTitle.includes('goal');
      } else if (dep === 'methodology') {
        return normalizedTitle.includes('method') || normalizedTitle.includes('approach');
      } else if (dep === 'timeline') {
        return normalizedTitle.includes('timeline') || normalizedTitle.includes('schedule');
      } else if (dep === 'budget') {
        return normalizedTitle.includes('budget');
      } else if (dep === 'outcomes') {
        return normalizedTitle.includes('outcome') || normalizedTitle.includes('result');
      } else if (dep === 'impact') {
        return normalizedTitle.includes('impact') || normalizedTitle.includes('significance');
      } else {
        return false;
      }
    });
  });
}

/**
 * Reviews a proposal section using the specified LLM
 */
export async function reviewSection(input: ReviewInput): Promise<ReviewResult> {
  const { section, previousSection, contextSection, priorSectionSummaries, callData, modelType } = input;
  // Presence of a reviewed earlier draft is what makes this a revision review.
  // Relying on the `is_revision` flag alone silently skipped the comparison for
  // sections that were re-submitted without the UI labelling them revisions.
  const isRevision = Boolean(previousSection?.ai_review_json);

  if (!hasMeaningfulSectionContent(section.user_input)) {
    throw new Error('Section has no meaningful content to review');
  }
  
  // Get the project title and call summary
  const projectTitle = callData.project_title || callData.title || "Grant Proposal";
  const callSummary = callData.reviewer_context_text || callData.call_summary || callData.agency_name || "Funding opportunity";
  const thrustAreas = Array.isArray(callData.thrust_areas) ? callData.thrust_areas.join(', ') : callData.thrust_areas || 'Not specified';
  const promptScope = buildReviewerPromptScope(section, callData);
  const sectionRulesText = formatRuleList('SECTION_SCORING_RULES', promptScope.sectionRules, 'No section-specific rules were mapped. Use the global scoring rules where assessable from the provided draft.');
  const callWideRulesText = [
    formatRuleList('GLOBAL_SCORING_RULES', promptScope.globalRules, 'No global scoring rules were provided. Score using reviewer judgment and the provided funding call context.'),
    formatRuleList('NON_SCORING_SUPPLEMENTARY_REQUIREMENTS', promptScope.supplementaryRules, 'No supplementary non-scoring requirements were identified.'),
  ].join('\n\n');

  // Prepare the prompt based on whether this is a revision or new section
  const systemPrompt = `You are a senior grant reviewer entrusted with evaluating very competitive research proposals for funding agencies in fields related to "${projectTitle}". Your mindset combines critical thinking, fairness, and a focus on real-world impact. You are not just checking language—you assess alignment, logic, feasibility, and value-for-money from the perspective of a funder deciding whether this project is worth investing in.

Maintain the following personality and reviewer stance throughout your review:

- Be analytical and rigorous: Dissect the proposal like a reviewer in a competitive panel. Examine claims, methods, budgets, and timelines with precision.
- Be constructive, not just critical: Identify weaknesses but also suggest specific, actionable improvements in a supportive yet firm tone.
- Be impact-focused: Keep asking: Why does this matter? Who benefits? Is this a valuable investment of public money?
- Be funding-call aligned: Ensure all aspects of the proposal match the agency's priorities, approved format template, and manual reviewer rubric provided in the review context.
- Be neutral and professional: Avoid over-praise or emotional language. Provide firm but respectful feedback in a structured, academic tone.
- Be integrative: Assess how well this section connects with prior ones if context is provided. If prior sections are unavailable, evaluate the current section standalone but note any assumptions about its integration. Logical flow matters.
- Be evidence-seeking: Look for specific details, justification, and clarity. Vague, generic language or missing information (e.g., budget, methodology, or impact) is a significant weakness—flag it and note its impact on your evaluation.

Score only the draft section content provided. Do not infer missing proposal sections. Assume attachments, submission forms, signatures, CVs, institutional letters, separate budget workbooks, and other non-reviewed procedural materials will be arranged separately by the user unless their absence directly affects the reviewed text.

Do not be lenient for weak sections. Proposals that sound nice but lack specificity, alignment, or feasibility should receive critical evaluation. Balance the need for specificity with the proposal's stage (e.g., exploratory vs. implementation), acknowledging justified uncertainty in early-stage research if supported by a clear rationale.

You must be professional and precise. You do not guess — cite only what is provided. Return the results in structured JSON.`;

  // Format prior section summaries if available in a more structured manner
  let priorSummariesText = '';
  if (priorSectionSummaries && priorSectionSummaries.length > 0) {
    priorSummariesText = `### NON-SCORING CONTEXT FROM RELATED SECTIONS
Use these summaries only to understand continuity, cross-section commitments, and consistency checks. They are not evidence for scoring the current section. Do not penalize the current section for details that belong only in these other sections.

${priorSectionSummaries.map(s => `- **${s.section_title}**: ${s.context_summary}`).join('\n\n')}`;
  }

  // Include classic context summary if available (for backward compatibility)
  const contextSummaryText = contextSection?.context_summary && !priorSectionSummaries ?
    `### NON-SCORING CONTEXT FROM RELATED SECTION
Use this summary only to understand continuity and consistency. It is not evidence for scoring the current section.

- **${contextSection.section_title}**: ${contextSection.context_summary}` : '';

  // ---------------------------------------------------------------------
  // Prompt is split into a call-stable prefix and a section-specific tail.
  // The prefix is byte-identical for every section of the same funding call,
  // which is what makes provider prompt caching pay off across a workspace.
  // Nothing section-specific may move above `stablePrefix`.
  // ---------------------------------------------------------------------
  const stablePrefix = `${systemPrompt}

### PROJECT TITLE
${projectTitle}

### FUNDING CALL CONTEXT
${callSummary}
Focus Areas: ${thrustAreas}

### CALL-WIDE REVIEW RULES
${callWideRulesText}

Scoring rule: SECTION_SCORING_RULES and GLOBAL_SCORING_RULES may affect the score only when they are assessable from the provided draft text. NON_SCORING_SUPPLEMENTARY_REQUIREMENTS must be reported as reminders only and must not reduce this section score.

### RESPONSE FORMAT
Respond with JSON in the following format:
{
  "score": (number between 1.0-10.0),
  "summary": (1-2 paragraph summary of evaluation),
  "strengths": [(array of specific strengths)],
  "weaknesses": [(array of specific weaknesses)],
  "suggestions": [(array of actionable suggestions for improvement)],
  "linked_section_feedback": [{"sectionKey": "grant section key when visible in headings", "feedback": "specific feedback for that linked draft section"}],
  "rules_used_for_scoring": [(array of section or global rules actually used to assign this score)],
  "global_rules_considered": [(array of global rules considered when assessable from the draft)],
  "non_scoring_reminders": [(array of reminders from NON_SCORING_SUPPLEMENTARY_REQUIREMENTS)],
  "criterion_scores": [{"criterion": "evaluation criterion this section speaks to", "score": (1.0-10.0), "evidence": "the specific claim or sentence in the draft that justifies it"}],
  "compliance_flags": [{"rule": "the stated rule", "status": "met|partial|missing|unverifiable", "detail": "one line of evidence"}],
  "section_recommendations": [{"sectionKey": "one of the linked section keys", "priority": "high|medium|low", "issue": "specific issue", "recommendation": "specific fix", "suggestedRemark": "instruction that can be passed to drafting regeneration", "autoFixable": true, "linkedRuleKeys": ["rule key or label"]}],
  "supplementary_materials": [(array of most important non-reviewed materials the user should prepare separately)],
  "addressed_previous_points": [{"point": "the earlier weakness or suggestion, quoted or closely paraphrased", "status": "addressed|partially|not_addressed", "evidence": "what in the new draft settles it, or what is still missing"}],
  "improvement_over_previous": (true/false boolean; include only when a previous version is supplied),
  "context_summary": (factual non-scoring continuity summary of this section for future LLM use, explicit facts/commitments only, < 200 tokens)
}

For criterion_scores, only include criteria this section can actually evidence; do not score a criterion the section is not responsible for.
For compliance_flags, use "unverifiable" when the rule concerns material outside the reviewed text rather than penalizing the section.
Fill addressed_previous_points only when a PREVIOUS REVIEW block is supplied, and then cover every weakness and suggestion it lists — one entry each, no omissions. Leave it empty otherwise.
For section_recommendations, set autoFixable=true only when the fix can be handled by regenerating the linked section text. Set autoFixable=false for recommendations that require user decisions, attachments, institutional documents, external forms, missing data the model cannot invent, or cross-section coordination outside this section.`;

  const sectionTail = isRevision
    ? `### TASK
You are reviewing a revised version of the [${section.section_title}] section (version ${section.version ?? 2}, revised from version ${previousSection?.version ?? 1}).

Score this draft on its own merits — do not carry the previous score forward, and do not award marks for effort. Then account for every point the previous review raised in addressed_previous_points, and set improvement_over_previous based on whether the substantive weaknesses are genuinely resolved, not on whether the text merely changed.

### SECTION_SCORING_RULES
${sectionRulesText}

${priorSummariesText || contextSummaryText}

### CURRENT SECTION: ${section.section_title}
${section.user_input}

### PREVIOUS REVIEW OF THIS SECTION
${summarizePreviousReview(previousSection?.ai_review_json)}`
    : `### TASK
Review the [${section.section_title}] section below and return the critical evaluation as JSON.

### SECTION_SCORING_RULES
${sectionRulesText}

${priorSummariesText || contextSummaryText}

### SECTION TO REVIEW: ${section.section_title}
${section.user_input}${contextSection && !priorSectionSummaries ? `

### EARLIER REVIEW OF ${contextSection.section_title}
${summarizePreviousReview(contextSection.ai_review_json)}` : ''}`;

  const userPrompt = sectionTail;
  const gatewayPrompt = `${stablePrefix}\n\n${sectionTail}`;

  let responseText: string | null = null;

  responseText = await executeConfiguredGrantReviewerReview({
    prompt: gatewayPrompt,
    requestHeaders: input.requestHeaders,
    tenantContext: input.tenantContext,
    stageCode: input.stageCode,
    promptCacheKey: `reviewer:section-review:${promptPrefixCacheKey(stablePrefix)}`,
  });

  if (!responseText && modelType === 'O') {
    // Use OpenAI
    responseText = await generateFromOpenAI(userPrompt, 'gpt-4-turbo', systemPrompt);
  } else if (!responseText) {
    responseText = await generateFromGemini(gatewayPrompt, GRANT_REVIEWER_FULL_REVIEW_FALLBACK_MODEL);
  }

  // Parse the response into JSON
  let reviewJson: any;
  try {
    // Try to extract JSON from response (might be wrapped in markdown code blocks)
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                     responseText.match(/```\n([\s\S]*?)\n```/) ||
                     [null, responseText];
                     
    reviewJson = JSON.parse(jsonMatch[1] || responseText);

    // Ensure we have all expected fields
    reviewJson.score = parseReviewerScore(reviewJson.score);
    reviewJson.summary = reviewJson.summary || "No summary provided";
    reviewJson.strengths = normalizeStringArray(reviewJson.strengths);
    reviewJson.weaknesses = normalizeStringArray(reviewJson.weaknesses);
    
    // Handle both recommendations and suggestions fields for consistency
    if (reviewJson.suggestions && !reviewJson.recommendations) {
      reviewJson.recommendations = reviewJson.suggestions;
    } else if (reviewJson.recommendations && !reviewJson.suggestions) {
      reviewJson.suggestions = reviewJson.recommendations;
    } else if (!reviewJson.suggestions && !reviewJson.recommendations) {
      reviewJson.suggestions = [];
      reviewJson.recommendations = [];
    }
    reviewJson.suggestions = normalizeStringArray(reviewJson.suggestions);
    reviewJson.recommendations = normalizeStringArray(reviewJson.recommendations);
    
    reviewJson.context_summary = reviewJson.context_summary || "Not Available";
    reviewJson.linked_section_feedback = Array.isArray(reviewJson.linked_section_feedback)
      ? reviewJson.linked_section_feedback
      : [];
    reviewJson.rules_used_for_scoring = normalizeStringArray(reviewJson.rules_used_for_scoring).length
      ? normalizeStringArray(reviewJson.rules_used_for_scoring)
      : promptScope.rulesUsedForScoring;
    reviewJson.global_rules_considered = normalizeStringArray(reviewJson.global_rules_considered).length
      ? normalizeStringArray(reviewJson.global_rules_considered)
      : promptScope.globalRulesConsidered;
    reviewJson.non_scoring_reminders = normalizeStringArray(reviewJson.non_scoring_reminders).length
      ? normalizeStringArray(reviewJson.non_scoring_reminders)
      : promptScope.nonScoringReminders;
    reviewJson.supplementary_materials = normalizeStringArray(reviewJson.supplementary_materials).length
      ? normalizeStringArray(reviewJson.supplementary_materials)
      : promptScope.nonScoringReminders;
    reviewJson.section_recommendations = normalizeSectionRecommendations(reviewJson, promptScope);
    reviewJson.criterion_scores = normalizeCriterionScores(reviewJson.criterion_scores);
    reviewJson.compliance_flags = normalizeComplianceFlags(reviewJson.compliance_flags);
    reviewJson.addressed_previous_points = isRevision
      ? normalizeAddressedPreviousPoints(reviewJson.addressed_previous_points)
      : [];

    // For revisions, determine improvement
    const previousScore = typeof previousSection?.ai_review_json?.score === 'number'
      ? previousSection.ai_review_json.score
      : null;
    const isImprovement = isRevision
      ? (reviewJson.improvement_over_previous === true
        || (previousScore !== null && reviewJson.score > previousScore))
      : false;

    if (isRevision) {
      reviewJson.improvement_over_previous = isImprovement;
      reviewJson.revision_of_version = previousSection?.version ?? null;
      reviewJson.previous_score = previousScore;
      reviewJson.score_delta = previousScore !== null
        ? Number((reviewJson.score - previousScore).toFixed(2))
        : null;
      reviewJson.addressed_summary = summarizeAddressedPoints(reviewJson.addressed_previous_points);
    }

    return {
      review: reviewJson,
      isImprovement: isImprovement
    };
  } catch (error) {
    console.error('Error parsing LLM response:', error);
    throw new Error('The reviewer model returned an invalid review. Please retry the review.');
  }
}
