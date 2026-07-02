import crypto from 'crypto'

import { z } from 'zod'

import { llmGateway, type TenantContext } from '@/lib/metering'
import {
  buildGeneratedGrantProposalFoundation,
  enrichGrantBlueprintSections,
  isGrantBlueprintSectionCitationWorthy,
  type GrantBlueprintEnrichmentContext,
} from '@/lib/grants/blueprintEnrichment'
import { normalizeGrantCitationMode } from '@/lib/grants/citationMode'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type {
  GrantBlueprintPlanSection,
} from '@/types/grant'
import { GRANT_CITATION_MODES } from '@/types/grant'

const sectionSchema = z.object({
  sectionKey: z.string().min(1),
  citationMode: z.enum(GRANT_CITATION_MODES).optional(),
  suggestedCitationCount: z.number().int().min(0).max(50).nullable().optional(),
  dimensions: z.array(z.string().min(1)).optional(),
  citationDecisionRationale: z.string().optional(),
})

const responseSchema = z.object({
  sections: z.array(sectionSchema).default([]),
})

function cleanLlmList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const next: string[] = []

  for (const item of value) {
    const text = String(item || '').trim().replace(/\s+/g, ' ')
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(text)
    if (next.length >= limit) break
  }

  return next
}

function compactText(value: unknown, maxLength = 220): string {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trim()}...`
}

function compactList(value: unknown, limit = 6, maxLength = 180): string[] {
  return cleanLlmList(value, limit)
    .map((item) => compactText(item, maxLength))
    .filter(Boolean)
}

function compactSeededContext(value: unknown): string[] {
  return compactList(String(value || '').split('\n'), 2, 140)
}

function compactSectionForDimensions(section: GrantBlueprintPlanSection) {
  const prepContextBlock = section.prepContextBlock || null
  const grantRuleProfile = section.grantRuleProfile || null
  const complianceContract = section.grantSectionComplianceContract || null

  return {
    sectionKey: section.sectionKey,
    label: compactText(section.label, 120),
    grantSemantic: section.grantSemantic,
    purpose: compactText(section.purpose, 240),
    reviewerIntent: compactText(section.reviewerIntent, 180),
    wordBudget: section.wordBudget,
    currentCitationMode: normalizeGrantCitationMode(section.citationMode, {
      sectionType: section.sectionType,
      workflowMode: section.workflowMode,
      suggestedCitationCount: section.suggestedCitationCount,
    }),
    suggestedCitationCount: section.suggestedCitationCount,
    sectionWritingPointers: compactList(section.mustCover, 4, 140),
    currentDimensions: compactList(section.dimensions || [], 6, 120),
    mustAvoid: compactList(section.mustAvoid, 2, 120),
    prepAnchors: prepContextBlock ? {
      stageKeys: compactList(prepContextBlock.stageKeys, 5, 80),
      bullets: compactList(prepContextBlock.bullets, 3, 140),
      keywords: compactList(prepContextBlock.keywords, 8, 50),
    } : undefined,
    ruleAnchors: {
      requiredPoints: compactList(
        grantRuleProfile?.requiredPoints || complianceContract?.requiredPoints || [],
        3,
        140
      ),
      evaluationFocus: compactList(
        grantRuleProfile?.evaluationFocus || complianceContract?.evaluationFocus || [],
        3,
        140
      ),
      reviewerSignals: compactList(
        grantRuleProfile?.reviewerSignals || complianceContract?.reviewerSignals || [],
        2,
        140
      ),
      fundingCallSummary: compactList(complianceContract?.fundingCallSummary || [], 2, 140),
    },
    seededContext: compactSeededContext(section.seededContext),
  }
}

function buildPrompt(input: {
  baseSectionPlan: GrantBlueprintPlanSection[]
  context: GrantBlueprintEnrichmentContext
  overrideReason?: string
}): string {
  const sectionPayload = input.baseSectionPlan
    .filter(isLlmCitationDecisionCandidateSection)
    .map(compactSectionForDimensions)

  const evaluationCriteria = input.context.guidelinePack?.evaluationCriteria
    ?.map((item) => compactText(item.text, 180))
    .filter(Boolean)
    .slice(0, 4) || []
  const prepFacts = [
    ...(input.context.prepEvidence || []),
    ...Object.values(input.context.prepEvidenceBySection || {}).flatMap((items) => items),
  ]
    .filter((item) => item.status === 'covered')
    .slice(0, 6)
    .map((item) => [
      compactText(item.label, 120),
      compactList(item.factBullets, 1, 120).join(' ; '),
      compactList(item.keywords, 5, 50).join(', '),
    ].filter(Boolean).join(' | '))

  return [
    'You are generating citation decisions and literature dimensions for a grant blueprint.',
    'The blueprint already exists. Your job is to decide which candidate sections need mapped citations and generate/refine dimensions only for those sections.',
    'Return JSON only. Do not include prose before or after the JSON.',
    'Preserve section keys and section ordering.',
    'Do not add, remove, reorder, or rename sections. Do not output or modify purpose, mustCover, mustAvoid, workflowMode, reviewer rules, or proposal foundation.',
    'For each candidate section, return citationMode and suggestedCitationCount.',
    'Use citationMode="mapped_evidence" only when the section genuinely needs external literature, statistics, prior work, benchmarks, validation, or state-of-the-art support.',
    'Use citationMode="direct_draft" when the section should be drafted from Grant Prep facts, section rules, and funding-call context without mapped citations.',
    'Use citationMode="no_citations" only when citations would be inappropriate or explicitly excluded.',
    'If citationMode is not "mapped_evidence", return suggestedCitationCount=0 and dimensions=[].',
    'Dimensions are literature-searchable pillars for sections that genuinely need external evidence, paper mapping, evidence extraction, citations, and evidence-aware drafting.',
    'Be selective: dimensions belong in introduction/background, literature review/state-of-the-art, problem/need definition, methodology, and other sections whose claims require external backing.',
    'Do not create dimensions for simple summary, objectives, alignment, workplan, team, budget, attachment, or prep-only response sections unless they are explicitly present in the eligible payload.',
    'Avoid duplicating dimensions across sections unless the same literature pillar genuinely supports multiple sections.',
    'Return 2-5 dimensions per section, fewer for short sections and more only when citation count or section scope justifies it.',
    'For mapped_evidence sections, honor an existing positive suggestedCitationCount from the candidate payload; otherwise use 2-6 by default and fewer for short answers.',
    'Every dimension must be a searchable concept or anchor point, not a final draft sentence. It should be searchable in paper titles, abstracts, methods, findings, or policy literature.',
    'Do not write generic headings such as "Evidence for the problem", "Methodology overview", "Background", or "Expected impact".',
    'Prefer pillar labels like "Role of nutrition in child physical development", "Current state of art of malnutrition in India", "Implementation feasibility of school-based nutrition programs", or "Validation methods for child growth and cognitive outcomes".',
    'Use prep facts, section-writing pointers, evaluation criteria, and reviewer intent as anchors, but convert them into literature-facing concepts.',
    'The finalized idea anchor defines proposal identity. Literature dimensions may support or test it but must not redefine its problem, approach, target setting, differentiators, or scope boundaries.',
    'Section semantic guidance:',
    '- problem_need: burden statistics, prevalence data, policy gap evidence, target population baseline',
    '- methodology: feasibility precedent from analogous implementations, validation evidence, methodological benchmarks',
    '- innovation: comparative advantage against current practice, novelty substantiation, precedent for adoption',
    '- impact_outcomes: quantified outcomes from related interventions, adoption/scaling precedent',
    '- evaluation: measurement validation evidence, indicator reliability precedent',
    '- sustainability: continuation model evidence, institutionalization or scale-up precedent',
    input.overrideReason ? `Override reason from user: ${input.overrideReason}` : '',
    `Project title: ${input.context.projectTitle || ''}`,
    `Funding call title: ${input.context.fundingCallTitle || ''}`,
    `Agency name: ${input.context.agencyName || ''}`,
    input.context.ideaAnchor ? `FINALIZED IDEA ANCHOR (do not drift):\n${JSON.stringify({
      hash: input.context.ideaAnchorHash || null,
      title: input.context.ideaAnchor.title,
      summary: input.context.ideaAnchor.oneSentenceSummary,
      problemOrOpportunity: input.context.ideaAnchor.problemOrOpportunity,
      coreApproach: input.context.ideaAnchor.coreApproach,
      targetBeneficiariesOrSetting: input.context.ideaAnchor.targetBeneficiariesOrSetting,
      funderFit: input.context.ideaAnchor.funderFit,
      distinguishingFeatures: input.context.ideaAnchor.distinguishingFeatures,
      nonNegotiables: input.context.ideaAnchor.nonNegotiables,
      scopeBoundaries: input.context.ideaAnchor.scopeBoundaries,
    })}` : '',
    `Global keywords: ${compactList(input.context.globalKeywords || [], 12, 50).join(', ')}`,
    evaluationCriteria.length > 0 ? `Evaluation criteria:\n${evaluationCriteria.map((item) => `- ${item}`).join('\n')}` : '',
    prepFacts.length > 0 ? `Prep-captured facts already committed in the workspace:\n${prepFacts.map((item) => `- ${item}`).join('\n')}` : '',
    '',
    'JSON schema:',
    '{"sections":[{"sectionKey":"","citationMode":"mapped_evidence|direct_draft|no_citations","suggestedCitationCount":0,"dimensions":["literature-searchable evidence pillar"],"citationDecisionRationale":"short reason"}]}',
    '',
    'Candidate sections:',
    JSON.stringify(sectionPayload, null, 2),
  ].filter(Boolean).join('\n')
}

function isLlmCitationDecisionCandidateSection(section: GrantBlueprintPlanSection): boolean {
  if (!isGrantSectionAutoDraftable(section)) return false
  return normalizeGrantCitationMode(section.citationMode, {
    sectionType: section.sectionType,
    workflowMode: section.workflowMode,
    suggestedCitationCount: section.suggestedCitationCount,
  }) !== 'no_citations'
}

function clampLlmCitationCount(
  value: unknown,
  section: GrantBlueprintPlanSection,
  fallback: number
): number {
  const numeric = Number(value)
  const raw = Number.isFinite(numeric) ? Math.round(numeric) : fallback
  const max = section.sectionType === 'short_answer' ? 10 : 50
  return Math.max(0, Math.min(max, raw))
}

function applyLlmCitationDecision(
  section: GrantBlueprintPlanSection,
  llmSection: z.infer<typeof sectionSchema> | undefined,
  candidateSectionKeys: Set<string>,
  explicitCitationTarget?: number
): GrantBlueprintPlanSection {
  if (!llmSection || !candidateSectionKeys.has(section.sectionKey)) {
    return section
  }

  const requestedMode = normalizeGrantCitationMode(llmSection.citationMode, {
    sectionType: section.sectionType,
    workflowMode: section.workflowMode,
    suggestedCitationCount: section.suggestedCitationCount,
  })
  const nextDimensions = cleanLlmList(llmSection.dimensions)

  if (requestedMode !== 'mapped_evidence') {
    return {
      ...section,
      citationMode: requestedMode === 'no_citations' ? 'no_citations' : 'direct_draft',
      suggestedCitationCount: 0,
      dimensions: [],
      dimensionTyping: undefined,
      thematicBlueprint: section.thematicBlueprint
        ? {
            ...section.thematicBlueprint,
            dimensions: [],
            dimensionTyping: undefined,
            suggestedCitationCount: 0,
          }
        : section.thematicBlueprint,
    }
  }

  const currentMode = normalizeGrantCitationMode(section.citationMode, {
    sectionType: section.sectionType,
    workflowMode: section.workflowMode,
    suggestedCitationCount: section.suggestedCitationCount,
  })
  const citationWorthy = currentMode === 'mapped_evidence' || isGrantBlueprintSectionCitationWorthy(section)
  const fallbackCount = typeof section.suggestedCitationCount === 'number'
    ? section.suggestedCitationCount
    : Math.max(2, nextDimensions.length)
  const suggestedCitationCount = typeof explicitCitationTarget === 'number' && explicitCitationTarget > 0
    ? clampLlmCitationCount(explicitCitationTarget, section, explicitCitationTarget)
    : clampLlmCitationCount(
        llmSection.suggestedCitationCount,
        section,
        fallbackCount
      )

  if (!citationWorthy || nextDimensions.length === 0 || suggestedCitationCount <= 0) {
    return {
      ...section,
      citationMode: 'direct_draft',
      suggestedCitationCount: 0,
      dimensions: [],
      dimensionTyping: undefined,
      thematicBlueprint: section.thematicBlueprint
        ? {
            ...section.thematicBlueprint,
            dimensions: [],
            dimensionTyping: undefined,
            suggestedCitationCount: 0,
          }
        : section.thematicBlueprint,
    }
  }

  return {
    ...section,
    citationMode: 'mapped_evidence',
    suggestedCitationCount,
    dimensions: nextDimensions,
    dimensionTyping: undefined,
    thematicBlueprint: section.thematicBlueprint
      ? {
          ...section.thematicBlueprint,
          dimensions: nextDimensions,
          dimensionTyping: undefined,
          suggestedCitationCount,
        }
      : section.thematicBlueprint,
  }
}

function findDuplicateDimensions(sections: Array<{ dimensions?: string[] }>): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const section of sections) {
    for (const dimension of section.dimensions || []) {
      const key = String(dimension || '').trim().toLowerCase()
      if (!key) continue
      if (seen.has(key)) {
        duplicates.add(String(dimension || '').trim())
      }
      seen.add(key)
    }
  }

  return [...duplicates]
}

export async function generateGrantBlueprintWithLlm(input: {
  baseSectionPlan: GrantBlueprintPlanSection[]
  context: GrantBlueprintEnrichmentContext
  proposalFoundationHint?: {
    thesisStatement: string
    centralObjective: string
    keyContributions: string[]
  }
  tenantContext?: TenantContext | null
  sessionId: string
  overrideReason?: string
  requireLlm?: boolean
}): Promise<{
  sectionPlan: GrantBlueprintPlanSection[]
  proposalFoundation: {
    thesisStatement: string
    centralObjective: string
    keyContributions: string[]
  }
  source: 'llm' | 'fallback' | 'mixed'
  diagnostics: { invalidSections: string[]; duplicateDimensions: string[] }
}> {
  const fallbackSectionPlan = enrichGrantBlueprintSections(
    input.baseSectionPlan,
    input.context,
    'generate'
  )
  const fallbackFoundation = input.proposalFoundationHint
    || buildGeneratedGrantProposalFoundation(fallbackSectionPlan, input.context)
  const explicitCitationTargetsByKey = new Map(
    input.baseSectionPlan
      .map((section) => [
        section.sectionKey,
        typeof section.suggestedCitationCount === 'number' && section.suggestedCitationCount > 0
          ? section.suggestedCitationCount
          : null,
      ] as const)
      .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number')
  )
  const candidateSectionKeys = new Set(
    fallbackSectionPlan
      .filter(isLlmCitationDecisionCandidateSection)
      .map((section) => section.sectionKey)
  )

  if (candidateSectionKeys.size === 0) {
    if (input.requireLlm) {
      throw new Error('No grant sections are eligible for LLM citation-decision and dimension generation.')
    }

    return {
      sectionPlan: fallbackSectionPlan,
      proposalFoundation: fallbackFoundation,
      source: 'fallback',
      diagnostics: { invalidSections: [], duplicateDimensions: [] },
    }
  }

  if (!input.tenantContext) {
    if (input.requireLlm) {
      throw new Error('LLM literature-dimension generation requires an active tenant plan, but no tenant context was resolved.')
    }

    return {
      sectionPlan: fallbackSectionPlan,
      proposalFoundation: fallbackFoundation,
      source: 'fallback',
      diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
    }
  }

  const prompt = buildPrompt({
    baseSectionPlan: fallbackSectionPlan,
    context: input.context,
    overrideReason: input.overrideReason,
  })

  try {
    const result = await llmGateway.executeLLMOperation(
      { tenantContext: input.tenantContext },
      {
        taskCode: 'GRANT_BLUEPRINT_GENERATE',
        stageCode: 'GRANT_BLUEPRINT_GEN',
        prompt,
        parameters: {
          purpose: 'grant_blueprint_generation',
          temperature: 0.4,
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          sessionId: input.sessionId,
          purpose: 'grant_blueprint_generation',
          ...(input.requireLlm
            ? {
                skipFeaturePolicy: true,
                primaryModelCode: 'gemini-2.5-pro',
                disableModelFallbacks: true,
              }
            : {}),
        },
      }
    )

    if (!result.success || !result.response?.output) {
      if (input.requireLlm) {
        throw new Error(result.error?.message || 'LLM literature-dimension generation failed before returning output.')
      }

      return {
        sectionPlan: fallbackSectionPlan,
        proposalFoundation: fallbackFoundation,
        source: 'fallback',
        diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
      }
    }

    const jsonStart = result.response.output.indexOf('{')
    const jsonEnd = result.response.output.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
      if (input.requireLlm) {
        throw new Error('LLM literature-dimension generation returned non-JSON output.')
      }

      return {
        sectionPlan: fallbackSectionPlan,
        proposalFoundation: fallbackFoundation,
        source: 'fallback',
        diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
      }
    }

    const parsed = responseSchema.safeParse(
      JSON.parse(result.response.output.slice(jsonStart, jsonEnd + 1))
    )
    if (!parsed.success) {
      if (input.requireLlm) {
        throw new Error(`LLM literature-dimension generation returned invalid JSON: ${parsed.error.message}`)
      }

      return {
        sectionPlan: fallbackSectionPlan,
        proposalFoundation: fallbackFoundation,
        source: 'fallback',
        diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
      }
    }

    const llmSectionsByKey = new Map(parsed.data.sections.map((section) => [section.sectionKey, section]))
    const invalidSections = parsed.data.sections
      .map((section) => section.sectionKey)
      .filter((sectionKey) => !candidateSectionKeys.has(sectionKey))
    const duplicateDimensions = findDuplicateDimensions(parsed.data.sections)
    const mergedPlan = enrichGrantBlueprintSections(
      fallbackSectionPlan.map((section) =>
        applyLlmCitationDecision(
          section,
          llmSectionsByKey.get(section.sectionKey),
          candidateSectionKeys,
          explicitCitationTargetsByKey.get(section.sectionKey)
        )
      ),
      input.context,
      'hydrate'
    )

    return {
      sectionPlan: mergedPlan,
      proposalFoundation: fallbackFoundation,
      source: 'llm',
      diagnostics: { invalidSections, duplicateDimensions },
    }
  } catch (error) {
    if (input.requireLlm) {
      throw error
    }

    return {
      sectionPlan: fallbackSectionPlan,
      proposalFoundation: fallbackFoundation,
      source: 'fallback',
      diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
    }
  }
}
