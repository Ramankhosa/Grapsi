import crypto from 'crypto'

import { z } from 'zod'

import { llmGateway, type TenantContext } from '@/lib/metering'
import {
  buildGeneratedGrantProposalFoundation,
  enrichGrantBlueprintSections,
  type GrantBlueprintEnrichmentContext,
} from '@/lib/grants/blueprintEnrichment'
import type {
  GrantBlueprintPlanSection,
  GrantCitationMode,
} from '@/types/grant'

const sectionSchema = z.object({
  sectionKey: z.string().min(1),
  purpose: z.string().min(1).optional(),
  mustCover: z.array(z.string().min(1)).optional(),
  mustAvoid: z.array(z.string().min(1)).optional(),
  suggestedCitationCount: z.number().int().min(0).max(50).nullable().optional(),
  citationMode: z.enum(['mapped_evidence', 'direct_draft', 'no_citations']).optional(),
})

const responseSchema = z.object({
  proposalFoundation: z.object({
    thesisStatement: z.string().default(''),
    centralObjective: z.string().default(''),
    keyContributions: z.array(z.string()).default([]),
  }).optional(),
  sections: z.array(sectionSchema).default([]),
})

function buildPrompt(input: {
  baseSectionPlan: GrantBlueprintPlanSection[]
  context: GrantBlueprintEnrichmentContext
  overrideReason?: string
}): string {
  const sectionPayload = input.baseSectionPlan.map((section) => ({
    sectionKey: section.sectionKey,
    label: section.label,
    sectionType: section.sectionType,
    workflowMode: section.workflowMode,
    purpose: section.purpose,
    reviewerIntent: section.reviewerIntent,
    wordBudget: section.wordBudget,
    mustCover: section.mustCover,
    mustAvoid: section.mustAvoid,
    suggestedCitationCount: section.suggestedCitationCount,
    citationMode: section.citationMode,
    grantSemantic: section.grantSemantic,
    seededContext: section.seededContext,
    prepContextBlock: section.prepContextBlock,
    grantRuleProfile: section.grantRuleProfile,
    grantSectionComplianceContract: section.grantSectionComplianceContract,
  }))

  const evaluationCriteria = input.context.guidelinePack?.evaluationCriteria?.map((item) => item.text).slice(0, 8) || []
  const prepFacts = Object.values(input.context.prepEvidenceBySection || {})
    .flatMap((items) => items)
    .filter((item) => item.status === 'covered')
    .slice(0, 12)
    .map((item) => [
      item.label,
      item.factBullets.slice(0, 2).join(' ; '),
      item.keywords.slice(0, 5).join(', '),
    ].filter(Boolean).join(' | '))

  return [
    'You are rewriting a grant blueprint for a proposal writing workspace.',
    'Think like a grant strategist preparing sections for reviewers, not like an academic outlining a paper.',
    'Return JSON only. Do not include prose before or after the JSON.',
    'Preserve section keys and section ordering.',
    'Improve section-specific mustCover, mustAvoid, citationMode, and proposal foundation quality.',
    'Avoid duplicating mustCover points across sections.',
    'For structured sections like checklist/table/budget_rows, prefer citationMode=no_citations.',
    'For narrative sections that need literature grounding, prefer citationMode=mapped_evidence.',
    'For direct-writing narrative/support sections that should not require mapped evidence, use citationMode=direct_draft.',
    'Every mustCover item for a grant-backed narrative section must be a reviewer-convincing evidence claim: a specific assertion that should be proven with external evidence.',
    'Do not write generic dimensions such as "Evidence for the problem", "Methodology overview", or "Background".',
    'Prefer specific grant-native dimensions such as burden statistics, policy gap evidence, feasibility precedent, validation evidence, comparative advantage, outcome precedent, or continuation model precedent.',
    'Use prep-captured facts as anchors. Dimensions should help prove the user\'s committed claims rather than drifting into generic topic coverage.',
    'Use evaluation criteria and reviewer intent to shape the mustCover list toward scoring logic.',
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
    `Global keywords: ${(input.context.globalKeywords || []).join(', ')}`,
    evaluationCriteria.length > 0 ? `Evaluation criteria:\n${evaluationCriteria.map((item) => `- ${item}`).join('\n')}` : '',
    prepFacts.length > 0 ? `Prep-captured facts already committed in the workspace:\n${prepFacts.map((item) => `- ${item}`).join('\n')}` : '',
    '',
    'JSON schema:',
    '{"proposalFoundation":{"thesisStatement":"","centralObjective":"","keyContributions":[]},"sections":[{"sectionKey":"","purpose":"","mustCover":[],"mustAvoid":[],"suggestedCitationCount":0,"citationMode":"mapped_evidence|direct_draft|no_citations"}]}',
    '',
    'Sections:',
    JSON.stringify(sectionPayload, null, 2),
  ].filter(Boolean).join('\n')
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
  if (!input.tenantContext) {
    return {
      sectionPlan: fallbackSectionPlan,
      proposalFoundation: fallbackFoundation,
      source: 'fallback',
      diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
    }
  }

  const prompt = buildPrompt({
    baseSectionPlan: input.baseSectionPlan,
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
        },
      }
    )

    if (!result.success || !result.response?.output) {
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
      return {
        sectionPlan: fallbackSectionPlan,
        proposalFoundation: fallbackFoundation,
        source: 'fallback',
        diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
      }
    }

    const llmSectionsByKey = new Map(parsed.data.sections.map((section) => [section.sectionKey, section]))
    const mergedPlan = enrichGrantBlueprintSections(
      input.baseSectionPlan.map((section) => {
        const llmSection = llmSectionsByKey.get(section.sectionKey)
        if (!llmSection) {
          return section
        }

        return {
          ...section,
          purpose: llmSection.purpose?.trim() || section.purpose,
          mustCover: Array.isArray(llmSection.mustCover) && llmSection.mustCover.length > 0
            ? llmSection.mustCover
            : section.mustCover,
          mustAvoid: Array.isArray(llmSection.mustAvoid)
            ? llmSection.mustAvoid
            : section.mustAvoid,
          suggestedCitationCount: typeof llmSection.suggestedCitationCount === 'number'
            ? llmSection.suggestedCitationCount
            : section.suggestedCitationCount,
          citationMode: llmSection.citationMode as GrantCitationMode | undefined || section.citationMode,
        }
      }),
      input.context,
      'generate'
    )

    return {
      sectionPlan: mergedPlan,
      proposalFoundation: parsed.data.proposalFoundation || fallbackFoundation,
      source: 'llm',
      diagnostics: { invalidSections: [], duplicateDimensions: [] },
    }
  } catch {
    return {
      sectionPlan: fallbackSectionPlan,
      proposalFoundation: fallbackFoundation,
      source: 'fallback',
      diagnostics: { invalidSections: input.baseSectionPlan.map((section) => section.sectionKey), duplicateDimensions: [] },
    }
  }
}
