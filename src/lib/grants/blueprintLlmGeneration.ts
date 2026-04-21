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
    prepContextBlock: section.prepContextBlock,
    grantRuleProfile: section.grantRuleProfile,
  }))

  return [
    'You are rewriting a grant blueprint for a proposal writing workspace.',
    'Return JSON only. Do not include prose before or after the JSON.',
    'Preserve section keys and section ordering.',
    'Improve section-specific mustCover, mustAvoid, citationMode, and proposal foundation quality.',
    'Avoid duplicating mustCover points across sections.',
    'For structured sections like checklist/table/budget_rows, prefer citationMode=no_citations.',
    'For narrative sections that need literature grounding, prefer citationMode=mapped_evidence.',
    'For direct-writing narrative/support sections that should not require mapped evidence, use citationMode=direct_draft.',
    input.overrideReason ? `Override reason from user: ${input.overrideReason}` : '',
    `Project title: ${input.context.projectTitle || ''}`,
    `Funding call title: ${input.context.fundingCallTitle || ''}`,
    `Agency name: ${input.context.agencyName || ''}`,
    `Global keywords: ${(input.context.globalKeywords || []).join(', ')}`,
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
