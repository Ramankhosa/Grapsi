import prisma from '@/lib/prisma'
import {
  FUNDING_GUIDELINE_EXTRACT_TASK_CODE,
  FUNDING_GUIDELINE_TEXT_STAGE_CODE,
  runFundingGatewayText,
  type FundingLlmRoutingContext,
} from '@/lib/funding/llmRouting'
import { parseJsonResponse } from '@/lib/fundingIntake/utils'
import {
  normalizeReviewerCallContext,
  type ReviewerCallContext,
} from '@/lib/reviewer/callContext'
import { buildReviewerSourceBundle, type ReviewerSourceBundle } from '@/lib/reviewer/sourceText'

export const REVIEWER_CALL_EXTRACT_PROMPT_VERSION = 'reviewer-call-extract-v1'

const SYSTEM_INSTRUCTIONS = `You convert a funding call's published text into the rule set a grant reviewer scores against.

Rules:
- Extract only what the source states. Never invent limits, criteria, or deadlines.
- Leave a field empty (empty string or empty array) when the source is silent. Do not write "NA", "not specified", or similar filler.
- Keep every rule atomic: one obligation, limit, or expectation per item.
- Preserve exact numbers, units, currencies, page/word caps, and must / must-not wording from the source.
- Separate scoring rules (what a reviewer judges the written proposal on) from submission rules (portal steps, uploads, signatures, forms, certificates). Submission items must go in submissionRules only.
- Return strict JSON. No prose, no markdown fences.`

const EXTRACTION_SCHEMA_HINT = `{
  "title": string,
  "agencyName": string,
  "description": string,
  "eligibilityCriteria": string,
  "thrustAreas": [string],
  "budgetCap": string,
  "projectDurationLimit": string,
  "submissionDeadline": string,
  "scoringCriteria": [{ "label": string, "weight": number|null, "description": string }],
  "reviewerSignals": [string],
  "mustAddress": [string],
  "avoid": [string],
  "formatRules": [string],
  "submissionRules": [string],
  "sections": [{
    "key": string,
    "label": string,
    "bucketKey": "summary"|"problem_need"|"objectives"|"methodology"|"workplan"|"budget"|"evaluation"|"impact_outcomes"|"team"|"sustainability_risk"|"attachments_submission"|"other",
    "required": boolean,
    "wordLimit": number|null,
    "charLimit": number|null,
    "reviewerGoal": string,
    "guidanceText": [string],
    "requiredFacts": [string],
    "forbiddenMoves": [string]
  }],
  "confidence": number,
  "warnings": [string]
}`

function buildPrompt(bundle: ReviewerSourceBundle): string {
  return `Read the funding call below and return the reviewer rule set as JSON in exactly this shape:

${EXTRACTION_SCHEMA_HINT}

Field guidance:
- sections: one entry per proposal section, question, or annexure the applicant must write. bucketKey routes it to the reviewer's scoring bucket. Set required=false only when the call marks it optional. Put word/character/page caps in wordLimit/charLimit when the call states them numerically; describe anything else (page counts, font sizes) in formatRules.
- reviewerGoal: one sentence on what a reviewer is looking for in that section.
- requiredFacts: concrete items the section must state. forbiddenMoves: things the call rules out.
- scoringCriteria: the published evaluation criteria. Include weight (percentage or marks) only when the call states one, otherwise null.
- reviewerSignals: phrases from the call that signal what a competitive proposal looks like.
- mustAddress / avoid: call-wide obligations and prohibitions that are not tied to a single section.
- submissionRules: portal steps, uploads, attachments, signatures, certificates, forms, and deadlines-as-process. These are reminders only and never affect the score.
- confidence: 0-1, how completely the source described the application requirements.
- warnings: note anything important that appeared to be missing, truncated, or behind a login.

Source documents (${bundle.documents.length}, ${bundle.promptChars} characters${bundle.truncated ? ', compacted from ' + bundle.totalChars : ''}):
${bundle.promptText}`
}

export interface ReviewerCallExtractionResult {
  context: ReviewerCallContext
  bundle: ReviewerSourceBundle
  reused: boolean
  model: string
}

/**
 * Look for a previous reviewer workspace built from byte-identical source text.
 * Repeat analyses of the same call (a colleague, a retry, a second project on
 * the same scheme) then cost nothing.
 */
async function findCachedExtraction(sourceHash: string, userId: string, tenantId: string | null) {
  const cached = await prisma.reviewerCall.findFirst({
    where: {
      call_input_type: 'url',
      call_input_data: { contains: sourceHash },
      review_status: 'parsed',
      OR: [{ user_id: userId }, ...(tenantId ? [{ tenantId }] : [])],
    },
    orderBy: { updated_at: 'desc' },
    select: { id: true, parsed_json: true },
  })

  if (!cached?.parsed_json) return null
  const parsed = cached.parsed_json as Record<string, unknown>
  if (!Array.isArray(parsed.template_sections) || parsed.template_sections.length === 0) return null
  return { id: cached.id, parsedJson: parsed }
}

/**
 * Fetch the supplied funding-call URLs and turn them into reviewer context.
 * Exactly one LLM call, and none at all on a cache hit.
 */
export async function extractReviewerContextFromUrls(input: {
  urls: string[]
  manualRubric?: unknown
  userId: string
  tenantId?: string | null
  llmContext?: FundingLlmRoutingContext | null
  forceRefresh?: boolean
}): Promise<ReviewerCallExtractionResult> {
  const bundle = await buildReviewerSourceBundle(input.urls)

  if (!input.forceRefresh) {
    const cached = await findCachedExtraction(bundle.sourceHash, input.userId, input.tenantId || null)
    if (cached) {
      const context = normalizeReviewerCallContext({
        ...cached.parsedJson,
        manual_rubric: input.manualRubric ?? (cached.parsedJson as any).manual_rubric,
        source_urls: bundle.urls,
        extraction: {
          ...((cached.parsedJson as any).extraction || {}),
          reusedFromCallId: cached.id,
          sourceHash: bundle.sourceHash,
        },
      })
      return { context, bundle, reused: true, model: context.extraction?.model || 'cache' }
    }
  }

  const result = await runFundingGatewayText({
    taskCode: FUNDING_GUIDELINE_EXTRACT_TASK_CODE,
    stageCode: FUNDING_GUIDELINE_TEXT_STAGE_CODE,
    prompt: buildPrompt(bundle),
    systemPrompt: SYSTEM_INSTRUCTIONS,
    context: input.llmContext,
    responseMimeType: 'application/json',
    temperature: 0,
    maxTokensOut: 8000,
    promptCacheKey: `reviewer:call-extract:${REVIEWER_CALL_EXTRACT_PROMPT_VERSION}`,
    promptCacheRetention: '24h',
    skipFeaturePolicy: true,
    metadata: {
      purpose: 'reviewer_call_extract',
      promptVersion: REVIEWER_CALL_EXTRACT_PROMPT_VERSION,
      sourceHash: bundle.sourceHash,
    },
  })

  if (!result) {
    throw new Error('No LLM provider is configured for funding call extraction')
  }

  const raw = parseJsonResponse(result.rawText) as Record<string, any>

  const context = normalizeReviewerCallContext({
    title: raw.title,
    agency_name: raw.agencyName,
    description: raw.description,
    call_summary: raw.description,
    rules_source: 'url_extracted',
    source_urls: bundle.urls,
    template_sections: Array.isArray(raw.sections) ? raw.sections : [],
    manual_rubric: input.manualRubric,
    scoring_criteria: raw.scoringCriteria,
    reviewer_signals: raw.reviewerSignals,
    dos: raw.mustAddress,
    donts: raw.avoid,
    mandatory_sections: (Array.isArray(raw.sections) ? raw.sections : [])
      .filter((section: any) => section?.required !== false)
      .map((section: any) => section?.label)
      .filter(Boolean),
    format_rules: raw.formatRules,
    submission_rules: raw.submissionRules,
    eligibility_criteria: raw.eligibilityCriteria,
    thrust_areas: raw.thrustAreas,
    budget_cap: raw.budgetCap,
    project_duration_limit: raw.projectDurationLimit,
    submission_deadline: raw.submissionDeadline,
    extraction: {
      model: result.model,
      promptVersion: REVIEWER_CALL_EXTRACT_PROMPT_VERSION,
      extractedAt: new Date().toISOString(),
      sourceUrls: bundle.urls,
      sourceHash: bundle.sourceHash,
      sourceChars: bundle.totalChars,
      promptChars: bundle.promptChars,
      truncated: bundle.truncated,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
      warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    },
  })

  if (context.template_sections.length === 0) {
    throw new Error(
      'The page was readable but no application sections or reviewer rules could be identified. Try the PDF guidelines URL for this call, or start from a stored funding call instead.'
    )
  }

  return { context, bundle, reused: false, model: result.model }
}
