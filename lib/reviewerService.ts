// @ts-nocheck
import crypto from 'crypto';

import { llmGateway } from '@/lib/metering/gateway';
import {
  hasMeaningfulSectionContent,
  normalizeStringArray,
  parseReviewerScore,
} from '@/lib/reviewer/content';
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
    parameters: { temperature: 0.2 },
    metadata: {
      skipFeaturePolicy: true,
      operation: 'grant_reviewer_full_review',
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

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function dedupeStrings(values: unknown[], limit?: number): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(text);
    if (limit && next.length >= limit) break;
  }
  return next;
}

function flattenRuleProfile(profile: any): string[] {
  if (!profile || typeof profile !== 'object') return [];
  return dedupeStrings([
    ...(Array.isArray(profile.requiredPoints) ? profile.requiredPoints : []),
    ...(Array.isArray(profile.evaluationFocus) ? profile.evaluationFocus : []),
    ...(Array.isArray(profile.reviewerSignals) ? profile.reviewerSignals : []),
    ...(Array.isArray(profile.avoidRules) ? profile.avoidRules.map((item: string) => `Avoid: ${item}`) : []),
    ...(Array.isArray(profile.formatConstraints) ? profile.formatConstraints.map((item: string) => `Format: ${item}`) : []),
    ...(Array.isArray(profile.narrativeConstraints) ? profile.narrativeConstraints : []),
  ]);
}

function flattenComplianceContract(contract: any): { scoring: string[]; supplementary: string[] } {
  if (!contract || typeof contract !== 'object') return { scoring: [], supplementary: [] };
  const scoringChecks = [
    ...(Array.isArray(contract.hardChecks) ? contract.hardChecks : []),
    ...(Array.isArray(contract.softChecks) ? contract.softChecks : []),
  ].filter((check: any) => {
    const mode = String(check?.draftingVsSubmission || '').toLowerCase();
    return mode === 'drafting' || mode === 'both' || !mode;
  }).map((check: any) => check?.ruleText || check?.message || check?.label);

  const supplementaryChecks = [
    ...(Array.isArray(contract.submissionChecklist) ? contract.submissionChecklist : []),
    ...(Array.isArray(contract.hardChecks) ? contract.hardChecks : []),
    ...(Array.isArray(contract.softChecks) ? contract.softChecks : []),
  ].filter((check: any) => {
    if (typeof check === 'string') return true;
    const mode = String(check?.draftingVsSubmission || '').toLowerCase();
    return mode === 'submission';
  }).map((check: any) => typeof check === 'string' ? check : (check?.ruleText || check?.message || check?.label));

  return {
    scoring: dedupeStrings([
      ...(Array.isArray(contract.requiredPoints) ? contract.requiredPoints : []),
      ...(Array.isArray(contract.evaluationFocus) ? contract.evaluationFocus : []),
      ...(Array.isArray(contract.reviewerSignals) ? contract.reviewerSignals : []),
      ...(Array.isArray(contract.avoidRules) ? contract.avoidRules.map((item: string) => `Avoid: ${item}`) : []),
      ...(Array.isArray(contract.formatConstraints) ? contract.formatConstraints.map((item: string) => `Format: ${item}`) : []),
      ...(Array.isArray(contract.narrativeConstraints) ? contract.narrativeConstraints : []),
      ...scoringChecks,
    ]),
    supplementary: dedupeStrings(supplementaryChecks),
  };
}

function ruleToText(rule: any): string {
  const parts = [
    rule?.label ? `${rule.label}` : '',
    rule?.reviewerGoal ? `goal: ${rule.reviewerGoal}` : '',
    Array.isArray(rule?.guidanceText) && rule.guidanceText.length ? `guidance: ${rule.guidanceText.join('; ')}` : '',
    Array.isArray(rule?.requiredFacts) && rule.requiredFacts.length ? `required facts: ${rule.requiredFacts.join('; ')}` : '',
    Array.isArray(rule?.forbiddenMoves) && rule.forbiddenMoves.length ? `avoid: ${rule.forbiddenMoves.join('; ')}` : '',
    rule?.wordLimit ? `word limit: ${rule.wordLimit}` : '',
    rule?.charLimit ? `character limit: ${rule.charLimit}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function isSupplementaryRule(rule: any): boolean {
  const workflowMode = String(rule?.workflowMode || '').toLowerCase();
  const type = normalizeKey(rule?.type);
  const bucket = normalizeKey(rule?.bucketKey);
  const text = `${rule?.label || ''} ${rule?.reviewerGoal || ''} ${(rule?.guidanceText || []).join(' ')}`.toLowerCase();
  return (
    (workflowMode && workflowMode !== 'app_draft')
    || bucket === 'attachments_submission'
    || ['attachment', 'attachments', 'submission', 'eligibility', 'checklist'].includes(type)
    || /\b(attachment|appendix|portal|upload|signature|signed|cv|biosketch|institutional|ethics|irb|declaration|certificate|budget form|workbook|invoice|quote)\b/.test(text)
  );
}

function buildLinkedSectionRules(link: any): { scoring: string[]; supplementary: string[] } {
  const compliance = flattenComplianceContract(link?.grantSectionComplianceContract);
  const templateGuidance = link?.grantTemplateGuidance && typeof link.grantTemplateGuidance === 'object'
    ? dedupeStrings([
        ...(Array.isArray(link.grantTemplateGuidance.guidanceText) ? link.grantTemplateGuidance.guidanceText : []),
        ...(Array.isArray(link.grantTemplateGuidance.requiredFacts) ? link.grantTemplateGuidance.requiredFacts : []),
        ...(Array.isArray(link.grantTemplateGuidance.forbiddenMoves) ? link.grantTemplateGuidance.forbiddenMoves.map((item: string) => `Avoid: ${item}`) : []),
        link.grantTemplateGuidance.reviewerGoal ? `Reviewer goal: ${link.grantTemplateGuidance.reviewerGoal}` : '',
      ])
    : [];

  return {
    scoring: dedupeStrings([
      link?.reviewerIntent ? `Reviewer intent: ${link.reviewerIntent}` : '',
      ...(Array.isArray(link?.mustCover) ? link.mustCover : []),
      ...(Array.isArray(link?.mustAvoid) ? link.mustAvoid.map((item: string) => `Avoid: ${item}`) : []),
      ...flattenRuleProfile(link?.grantRuleProfile),
      ...templateGuidance,
      ...compliance.scoring,
    ]),
    supplementary: compliance.supplementary,
  };
}

function buildReviewerPromptScope(section: any, callData: any) {
  const templateRules = Array.isArray(callData?.template_sections) ? callData.template_sections : [];
  const manualRubric = callData?.manual_rubric || {};
  const mappingJson = section?.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {};
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : [];
  const linkedKeys = new Set(linkedSections.map((link: any) => normalizeKey(link?.sectionKey)).filter(Boolean));
  const bucketKey = normalizeKey(section?.reviewerBucketKey || mappingJson.bucketKey || section?.section_title);

  const sectionRules: string[] = [];
  const globalRules: string[] = [];
  const supplementaryRules: string[] = [];
  const scoringRuleKeys: string[] = [];
  const globalRuleKeys: string[] = [];

  for (const link of linkedSections) {
    if (String(link?.workflowMode || 'app_draft') !== 'app_draft') continue;
    const linked = buildLinkedSectionRules(link);
    sectionRules.push(...linked.scoring.map((rule) => `${link.label || link.sectionKey}: ${rule}`));
    supplementaryRules.push(...linked.supplementary.map((rule) => `${link.label || link.sectionKey}: ${rule}`));
  }

  for (const rule of templateRules) {
    const key = normalizeKey(rule?.key);
    const ruleBucket = normalizeKey(rule?.bucketKey);
    const text = ruleToText(rule);
    if (!text) continue;

    if (isSupplementaryRule(rule)) {
      supplementaryRules.push(text);
      continue;
    }

    const exactSectionMatch = key && linkedKeys.has(key);
    const bucketMatch = ruleBucket && bucketKey && ruleBucket === bucketKey;
    const appDraft = String(rule?.workflowMode || '').toLowerCase() === 'app_draft';

    if (exactSectionMatch || (appDraft && bucketMatch)) {
      sectionRules.push(text);
      scoringRuleKeys.push(rule?.key || rule?.label || text);
      continue;
    }

    const type = normalizeKey(rule?.type);
    if (type === 'rubric' || type === 'evaluation' || type === 'evaluation_criteria' || !rule?.workflowMode) {
      globalRules.push(text);
      globalRuleKeys.push(rule?.key || rule?.label || text);
    }
  }

  const sectionOverrides = manualRubric?.sectionOverrides || {};
  for (const key of linkedKeys) {
    const override = sectionOverrides[key] || sectionOverrides[normalizeKey(key)];
    if (!override || typeof override !== 'object') continue;
    sectionRules.push(...dedupeStrings([
      ...(Array.isArray(override.evaluationCriteria) ? override.evaluationCriteria : []),
      ...(Array.isArray(override.reviewerSignals) ? override.reviewerSignals : []),
      ...(Array.isArray(override.mustAddress) ? override.mustAddress : []),
      ...(Array.isArray(override.avoid) ? override.avoid.map((item: string) => `Avoid: ${item}`) : []),
      ...(Array.isArray(override.formatRules) ? override.formatRules.map((item: string) => `Format: ${item}`) : []),
    ]));
  }

  globalRules.push(...dedupeStrings([
    ...(Array.isArray(callData?.evaluation_criteria) ? callData.evaluation_criteria : []),
    ...(Array.isArray(callData?.reviewer_signals) ? callData.reviewer_signals.map((item: string) => `Reviewer signal: ${item}`) : []),
    ...(Array.isArray(manualRubric?.evaluationCriteria) ? manualRubric.evaluationCriteria : []),
    ...(Array.isArray(manualRubric?.reviewerSignals) ? manualRubric.reviewerSignals.map((item: string) => `Reviewer signal: ${item}`) : []),
    ...(Array.isArray(manualRubric?.mustAddress) ? manualRubric.mustAddress : []),
    ...(Array.isArray(manualRubric?.avoid) ? manualRubric.avoid.map((item: string) => `Avoid: ${item}`) : []),
    callData?.budget_cap ? `Budget cap: ${callData.budget_cap}` : '',
    callData?.project_duration_limit ? `Project duration: ${callData.project_duration_limit}` : '',
  ]));

  return {
    linkedSectionKeys: Array.from(linkedKeys),
    sectionRules: dedupeStrings(sectionRules, 40),
    globalRules: dedupeStrings(globalRules, 30),
    supplementaryRules: dedupeStrings(supplementaryRules, 30),
    rulesUsedForScoring: dedupeStrings([...scoringRuleKeys, ...sectionRules], 40),
    globalRulesConsidered: dedupeStrings([...globalRuleKeys, ...globalRules], 30),
    nonScoringReminders: dedupeStrings(supplementaryRules, 30),
  };
}

function formatRuleList(title: string, rules: string[], fallback: string): string {
  return `${title}:\n${rules.length > 0 ? rules.map((rule) => `- ${rule}`).join('\n') : `- ${fallback}`}`;
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
  const isRevision = section.is_revision && previousSection;

  if (!hasMeaningfulSectionContent(section.user_input)) {
    throw new Error('Section has no meaningful content to review');
  }
  
  // Get the project title and call summary
  const projectTitle = callData.project_title || callData.title || "Grant Proposal";
  const callSummary = callData.reviewer_context_text || callData.call_summary || callData.agency_name || "Funding opportunity";
  const thrustAreas = Array.isArray(callData.thrust_areas) ? callData.thrust_areas.join(', ') : callData.thrust_areas || 'Not specified';
  const promptScope = buildReviewerPromptScope(section, callData);
  const scopedRulesText = [
    formatRuleList('SECTION_SCORING_RULES', promptScope.sectionRules, 'No section-specific rules were mapped. Use the global scoring rules where assessable from the provided draft.'),
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

  let userPrompt: string;
  
  // Format prior section summaries if available in a more structured manner
  let priorSummariesText = '';
  if (priorSectionSummaries && priorSectionSummaries.length > 0) {
    priorSummariesText = `### CONTEXT FROM PREVIOUS SECTIONS:

${priorSectionSummaries.map(s => `- **${s.section_title}**: ${s.context_summary}`).join('\n\n')}`;
  }
  
  // Include classic context summary if available (for backward compatibility)
  const contextSummaryText = contextSection?.context_summary && !priorSectionSummaries ? 
    `### CONTEXT FROM PREVIOUS SECTION:
    
- **${contextSection.section_title}**: ${contextSection.context_summary}` : '';
  
  if (isRevision) {
    // For revision reviews
    userPrompt = `You are reviewing a revised version of the [${section.section_title}] section of a grant proposal titled "${projectTitle}". Below is the updated section content, and below that is the AI-generated review of the earlier version.

Evaluate if the user has addressed earlier weaknesses and suggestions. Provide a new review in structured JSON format. Indicate if the revision shows meaningful improvement.

### PROJECT TITLE
${projectTitle}

### FUNDING CALL CONTEXT
${callSummary}
Focus Areas: ${thrustAreas}

### REVIEW SCOPE AND RULES
${scopedRulesText}

Scoring rule: SECTION_SCORING_RULES and GLOBAL_SCORING_RULES may affect the score only when they are assessable from the provided draft text. NON_SCORING_SUPPLEMENTARY_REQUIREMENTS must be reported as reminders only and must not reduce this section score.

${priorSummariesText || contextSummaryText}

### CURRENT SECTION: ${section.section_title}
${section.user_input}

### PREVIOUS AI REVIEW
${JSON.stringify(previousSection?.ai_review_json, null, 2)}

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
  "section_recommendations": [{"sectionKey": "one of the linked section keys", "priority": "high|medium|low", "issue": "specific issue", "recommendation": "specific fix", "suggestedRemark": "instruction that can be passed to drafting regeneration", "autoFixable": true, "linkedRuleKeys": ["rule key or label"]}],
  "supplementary_materials": [(array of most important non-reviewed materials the user should prepare separately)],
  "improvement_over_previous": (true/false boolean),
  "context_summary": (condensed summary of this section for future LLM use, < 200 tokens)
}`;
  } else {
    // For new section reviews
    userPrompt = `Review the following [${section.section_title}] section of a grant proposal titled "${projectTitle}". Provide a critical evaluation in structured JSON format.

### PROJECT TITLE
${projectTitle}

### FUNDING CALL CONTEXT
${callSummary}
Focus Areas: ${thrustAreas}

### REVIEW SCOPE AND RULES
${scopedRulesText}

Scoring rule: SECTION_SCORING_RULES and GLOBAL_SCORING_RULES may affect the score only when they are assessable from the provided draft text. NON_SCORING_SUPPLEMENTARY_REQUIREMENTS must be reported as reminders only and must not reduce this section score.

${priorSummariesText || contextSummaryText}

### SECTION TO REVIEW: ${section.section_title}
${section.user_input}

${contextSection && !priorSectionSummaries ? `
### PREVIOUS SECTION REVIEW
For context, here's the review of the ${contextSection.section_title} section:
${JSON.stringify(contextSection.ai_review_json, null, 2)}` : ''}

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
  "section_recommendations": [{"sectionKey": "one of the linked section keys", "priority": "high|medium|low", "issue": "specific issue", "recommendation": "specific fix", "suggestedRemark": "instruction that can be passed to drafting regeneration", "autoFixable": true, "linkedRuleKeys": ["rule key or label"]}],
  "supplementary_materials": [(array of most important non-reviewed materials the user should prepare separately)],
  "context_summary": (condensed summary of this section for future LLM use, < 200 tokens)
}`;
  }

  // Choose the appropriate service based on modelType
  let responseText: string | null = null;
  const gatewayPrompt = systemPrompt + '\n\n' + userPrompt;

  responseText = await executeConfiguredGrantReviewerReview({
    prompt: gatewayPrompt,
    requestHeaders: input.requestHeaders,
    tenantContext: input.tenantContext,
    stageCode: input.stageCode,
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
    
    // For revisions, determine improvement
    const isImprovement = isRevision ? 
      (reviewJson.improvement_over_previous === true || 
       (reviewJson.score > (previousSection?.ai_review_json?.score || 0))) : 
      false;
    
    if (isRevision) {
      reviewJson.improvement_over_previous = reviewJson.improvement_over_previous === true || isImprovement;
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
