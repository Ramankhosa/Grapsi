import crypto from 'crypto'

import prisma from '@/lib/prisma'
import { llmGateway } from '@/lib/metering'
import {
  GRANT_AI_REVIEW_FIELD_KEY,
  computeGrantContentHash,
  deriveGrantAiReviewVerdict,
  normalizeGrantAiReviewFindings,
} from '@/lib/grants/aiReviewReport'
import {
  getGrantWorkspace,
  resolveGrantTenantContext,
} from '@/lib/grants/workspace'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type { GrantAiReviewReport, GrantBlueprintPlanSection } from '@/types/grant'

/**
 * LLM reviewer for one grant section. This is where agency-specific rules are
 * enforced — drafting stays unblocked, and this review (not the deterministic
 * keyword matcher) decides whether a section is submission-ready.
 */

function compactList(value: unknown, limit: number, maxLength = 220): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of value) {
    const text = String(item || '').trim().replace(/\s+/g, ' ')
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    output.push(text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text)
    if (output.length >= limit) break
  }
  return output
}

function countWords(text: string): number {
  const trimmed = String(text || '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function ruleBlock(label: string, rules: string[]): string {
  if (!rules.length) return ''
  return `${label}:\n${rules.map((rule) => `- ${rule}`).join('\n')}`
}

function buildReviewPrompt(input: {
  agencyName: string | null
  fundingCallTitle: string | null
  planSection: GrantBlueprintPlanSection | null
  label: string
  content: string
  wordBudget: number | null
  characterLimit: number | null
}): string {
  const plan = input.planSection
  const profile = plan?.grantRuleProfile || null
  const contract = plan?.grantSectionComplianceContract || null
  const words = countWords(input.content)

  const requiredPoints = compactList(profile?.requiredPoints || contract?.requiredPoints, 12)
  const avoidRules = compactList(profile?.avoidRules, 8)
  const evaluationFocus = compactList(profile?.evaluationFocus || contract?.evaluationFocus, 8)
  const reviewerSignals = compactList(profile?.reviewerSignals || contract?.reviewerSignals, 6)
  const formatConstraints = compactList(
    [...(profile?.formatConstraints || []), ...(profile?.narrativeConstraints || [])],
    8
  )
  const mustCover = compactList(plan?.mustCover, 10)
  const fundingCallSummary = compactList(contract?.fundingCallSummary, 6)

  const budgetLine = input.wordBudget
    ? `Word budget: ${input.wordBudget} words. The draft currently has ${words} words${words > input.wordBudget ? ` (OVER by ${words - input.wordBudget})` : ''}.`
    : `No explicit word budget. The draft currently has ${words} words.`

  return [
    `You are a senior grant reviewer for ${input.agencyName || 'the funding agency'}, scoring a proposal section for the call "${input.fundingCallTitle || 'this funding call'}".`,
    'Judge this section the way the agency\'s review panel would: against the section rules below, the evaluation criteria, and general standards of a fundable proposal (specificity, evidence, feasibility, coherence).',
    '',
    `SECTION UNDER REVIEW: "${input.label}"`,
    plan?.purpose ? `Section purpose: ${String(plan.purpose).slice(0, 300)}` : '',
    plan?.reviewerIntent ? `What reviewers look for here: ${String(plan.reviewerIntent).slice(0, 300)}` : '',
    budgetLine,
    input.characterLimit ? `Character limit: ${input.characterLimit} (draft has ${input.content.length}).` : '',
    '',
    ruleBlock('REQUIRED POINTS (each must be substantively addressed)', requiredPoints),
    ruleBlock('MUST COVER', mustCover),
    ruleBlock('AVOID (flag any violation)', avoidRules),
    ruleBlock('EVALUATION CRITERIA (how the panel scores)', evaluationFocus),
    ruleBlock('REVIEWER SIGNALS', reviewerSignals),
    ruleBlock('FORMAT / NARRATIVE CONSTRAINTS', formatConstraints),
    ruleBlock('FUNDING CALL CONTEXT', fundingCallSummary),
    '',
    'SECTION DRAFT:',
    '"""',
    input.content.slice(0, 24000),
    input.content.length > 24000 ? `\n[Draft continues for ${input.content.length - 24000} more characters]` : '',
    '"""',
    '',
    'Return ONLY raw JSON (no markdown fences) with this exact shape:',
    '{"verdict":"ready|minor_revisions|major_revisions","score":0-100,"summary":"one-sentence panel assessment","strengths":["what already works"],"findings":[{"severity":"critical|important|polish","rule":"the specific rule or expectation involved (or null)","issue":"what is wrong or missing","fix":"self-contained instruction to fix it, quoting draft text where useful"}]}',
    '',
    'Rules:',
    '- severity "critical" = would sink the section with this agency (missing required point, avoid-rule violation, hard limit breach, factual incoherence).',
    '- severity "important" = weakens the score but is fixable (thin evidence, vague claims, budget overrun under 15%).',
    '- severity "polish" = wording/flow improvements.',
    '- Maximum 8 findings, most severe first. If the section genuinely meets the rules, return an empty findings array — do not invent issues.',
    '- Every "fix" must be actionable by a drafting model WITHOUT any other context.',
    '- Do not penalize [CITE:key] citation anchors or markdown tables — both are valid formatting.',
    '- score: 0-100 funding-readiness for THIS section (90+ ready as-is, 70-89 minor work, below 70 substantive work).',
  ].filter(Boolean).join('\n')
}

function parseJsonObject(output: string): Record<string, unknown> {
  const text = String(output || '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('The AI reviewer returned no JSON verdict.')
  }
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

export async function runGrantSectionAiReview(input: {
  projectId: string
  grantSessionId: string
  tenantId: string
  userId: string
  sectionKey: string
}): Promise<GrantAiReviewReport> {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })
  if (!workspace?.blueprint || workspace.grantSession.projectId !== input.projectId) {
    throw new Error('Grant workspace not found')
  }

  const sectionDraft = workspace.blueprint.sectionDrafts.find(
    (draft) => draft.sectionKey === input.sectionKey
  )
  if (!sectionDraft) {
    throw new Error('Grant section not found')
  }
  if (!isGrantSectionAutoDraftable({
    sectionKey: sectionDraft.sectionKey,
    sectionType: sectionDraft.sectionType,
    workflowMode: (sectionDraft as { workflowMode?: string | null }).workflowMode,
  })) {
    throw new Error('Only AI-draftable sections can be AI-reviewed.')
  }
  const content = String(sectionDraft.content || '').trim()
  if (!content) {
    throw new Error('This section has no draft content to review yet.')
  }

  const planSection = workspace.blueprint.sectionPlan.find(
    (section) => section.sectionKey === input.sectionKey
  ) || null

  const tenantContext = await resolveGrantTenantContext(input.tenantId, input.userId)
  if (!tenantContext) {
    throw new Error('Unable to resolve tenant context for the AI review.')
  }

  const prompt = buildReviewPrompt({
    agencyName: workspace.grantSession.fundingCall?.agency_name || null,
    fundingCallTitle: workspace.grantSession.fundingCall?.scheme_title || null,
    planSection,
    label: sectionDraft.label || input.sectionKey,
    content,
    wordBudget: sectionDraft.wordBudget ?? planSection?.wordBudget ?? null,
    characterLimit: sectionDraft.characterLimit ?? planSection?.characterLimit ?? null,
  })

  const result = await llmGateway.executeLLMOperation(
    { tenantContext },
    {
      taskCode: 'GRANT_SECTION_GENERATE',
      stageCode: 'DRAFT_REVIEW',
      prompt,
      parameters: {
        purpose: 'grant_section_ai_review',
        temperature: 0.2,
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        grantSessionId: input.grantSessionId,
        sectionKey: input.sectionKey,
        purpose: 'grant_section_ai_review',
        skipFeaturePolicy: true,
      },
    }
  )

  if (!result.success || !result.response?.output) {
    throw new Error(result.error?.message || 'The AI review failed before returning a verdict.')
  }

  const parsed = parseJsonObject(result.response.output)
  const findings = normalizeGrantAiReviewFindings(parsed.findings)
  const rawScore = Number(parsed.score)
  const report: GrantAiReviewReport = {
    version: 1,
    verdict: deriveGrantAiReviewVerdict(findings, parsed.verdict),
    score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0,
    summary: String(parsed.summary || '').trim().replace(/\s+/g, ' ').slice(0, 600),
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    findings,
    reviewedContentHash: computeGrantContentHash(content),
    generatedAt: new Date().toISOString(),
  }

  await prisma.grantStructuredFieldResponse.upsert({
    where: {
      sectionDraftId_fieldKey: {
        sectionDraftId: sectionDraft.id,
        fieldKey: GRANT_AI_REVIEW_FIELD_KEY,
      },
    },
    update: {
      responseJson: report as never,
      updatedByUserId: input.userId,
    },
    create: {
      grantSessionId: sectionDraft.grantSessionId,
      sectionDraftId: sectionDraft.id,
      tenantId: sectionDraft.tenantId,
      projectId: sectionDraft.projectId,
      sectionKey: sectionDraft.sectionKey,
      fieldKey: GRANT_AI_REVIEW_FIELD_KEY,
      responseJson: report as never,
      updatedByUserId: input.userId,
    },
  })

  return report
}
