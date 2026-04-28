import crypto from 'crypto'

import { z } from 'zod'

import { llmGateway, type TenantContext } from '@/lib/metering'
import {
  buildGeneratedGrantProposalFoundation,
  enrichGrantBlueprintSections,
  type GrantBlueprintEnrichmentContext,
} from '@/lib/grants/blueprintEnrichment'
import { normalizeGrantCitationMode } from '@/lib/grants/citationMode'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type {
  GrantBlueprintPlanSection,
} from '@/types/grant'

const sectionSchema = z.object({
  sectionKey: z.string().min(1),
  dimensions: z.array(z.string().min(1)).optional(),
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
    .filter(isLlmDimensionEligibleSection)
    .map(compactSectionForDimensions)

  const evaluationCriteria = input.context.guidelinePack?.evaluationCriteria
    ?.map((item) => compactText(item.text, 180))
    .filter(Boolean)
    .slice(0, 4) || []
  const prepFacts = Object.values(input.context.prepEvidenceBySection || {})
    .flatMap((items) => items)
    .filter((item) => item.status === 'covered')
    .slice(0, 6)
    .map((item) => [
      compactText(item.label, 120),
      compactList(item.factBullets, 1, 120).join(' ; '),
      compactList(item.keywords, 5, 50).join(', '),
    ].filter(Boolean).join(' | '))

  return [
    'You are generating literature dimensions for a grant blueprint.',
    'The blueprint already exists. Your only job is to generate or refine dimensions for the eligible sections below.',
    'Return JSON only. Do not include prose before or after the JSON.',
    'Preserve section keys and section ordering.',
    'Do not add, remove, reorder, or rename sections. Do not output purpose, mustCover, mustAvoid, citationMode, counts, workflowMode, reviewer rules, or proposal foundation.',
    'Dimensions are literature-searchable pillars that connect grant sections to literature search, paper mapping, evidence extraction, citations, and section drafting.',
    'Avoid duplicating dimensions across sections unless the same literature pillar genuinely supports multiple sections.',
    'Return 3-7 dimensions per section, fewer for short sections and more only when citation count or section scope justifies it.',
    'Every dimension must be a searchable concept or anchor point, not a final draft sentence. It should be searchable in paper titles, abstracts, methods, findings, or policy literature.',
    'Do not write generic headings such as "Evidence for the problem", "Methodology overview", "Background", or "Expected impact".',
    'Prefer pillar labels like "Role of nutrition in child physical development", "Current state of art of malnutrition in India", "Implementation feasibility of school-based nutrition programs", or "Validation methods for child growth and cognitive outcomes".',
    'Use prep facts, section-writing pointers, evaluation criteria, and reviewer intent as anchors, but convert them into literature-facing concepts.',
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
    `Global keywords: ${compactList(input.context.globalKeywords || [], 12, 50).join(', ')}`,
    evaluationCriteria.length > 0 ? `Evaluation criteria:\n${evaluationCriteria.map((item) => `- ${item}`).join('\n')}` : '',
    prepFacts.length > 0 ? `Prep-captured facts already committed in the workspace:\n${prepFacts.map((item) => `- ${item}`).join('\n')}` : '',
    '',
    'JSON schema:',
    '{"sections":[{"sectionKey":"","dimensions":["literature-searchable evidence pillar"]}]}',
    '',
    'Eligible sections:',
    JSON.stringify(sectionPayload, null, 2),
  ].filter(Boolean).join('\n')
}

function isLlmDimensionEligibleSection(section: GrantBlueprintPlanSection): boolean {
  return (
    isGrantSectionAutoDraftable(section)
    && normalizeGrantCitationMode(section.citationMode, {
      sectionType: section.sectionType,
      workflowMode: section.workflowMode,
      suggestedCitationCount: section.suggestedCitationCount,
    }) === 'mapped_evidence'
    && (section.suggestedCitationCount || 0) > 0
  )
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
  const eligibleSectionKeys = new Set(
    fallbackSectionPlan
      .filter(isLlmDimensionEligibleSection)
      .map((section) => section.sectionKey)
  )

  if (eligibleSectionKeys.size === 0) {
    if (input.requireLlm) {
      throw new Error('No citation-mapped grant sections are eligible for LLM literature-dimension generation.')
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
      .filter((sectionKey) => !eligibleSectionKeys.has(sectionKey))
    const duplicateDimensions = findDuplicateDimensions(parsed.data.sections)
    const mergedPlan = enrichGrantBlueprintSections(
      fallbackSectionPlan.map((section) => {
        const llmSection = llmSectionsByKey.get(section.sectionKey)
        if (!llmSection) {
          return section
        }

        const eligible = eligibleSectionKeys.has(section.sectionKey)
        const nextDimensions = cleanLlmList(llmSection.dimensions)
        const useLlmDimensions = eligible && nextDimensions.length > 0

        return {
          ...section,
          dimensions: useLlmDimensions
            ? nextDimensions
            : section.dimensions,
          dimensionTyping: useLlmDimensions ? undefined : section.dimensionTyping,
          thematicBlueprint: useLlmDimensions ? undefined : section.thematicBlueprint,
        }
      }),
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
