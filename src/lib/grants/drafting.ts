import crypto from 'crypto'

import prisma from '@/lib/prisma'
import { llmGateway } from '@/lib/metering'
import {
  buildBudgetDraftingPrompt,
  buildBudgetStructuredScaffold,
  buildFallbackBudgetTemplate,
  validateBudgetDraftLlmResult,
} from '@/lib/grants/budgetTemplate'
import {
  getGrantWorkspace,
  resolveGrantTenantContext,
} from '@/lib/grants/workspace'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type { GrantBlueprintPlanSection } from '@/types/grant'

function getStructuredResponseValue(sectionDraft: {
  structuredResponses?: Array<{ fieldKey: string; responseJson: unknown }>
}) {
  const responses = sectionDraft.structuredResponses || []
  return responses.find((response) => response.fieldKey === 'structuredData')?.responseJson
    ?? responses[0]?.responseJson
}

function summarizeFundingContext(workspace: NonNullable<Awaited<ReturnType<typeof getGrantWorkspace>>>): string[] {
  const fundingCall = workspace.grantSession.fundingCall
  const project = workspace.grantSession.project
  const closeDate = fundingCall?.close_date instanceof Date
    ? fundingCall.close_date.toISOString()
    : fundingCall?.close_date
      ? String(fundingCall.close_date)
      : ''
  return [
    project?.name ? `Project: ${project.name}` : '',
    fundingCall?.scheme_title ? `Funding call: ${fundingCall.scheme_title}` : '',
    fundingCall?.agency_name ? `Agency: ${fundingCall.agency_name}` : '',
    fundingCall?.currency ? `Currency: ${fundingCall.currency}` : '',
    fundingCall?.amount_min || fundingCall?.amount_max
      ? `Funding range: ${[
          fundingCall.amount_min ? `${fundingCall.amount_min}` : '',
          fundingCall.amount_max ? `${fundingCall.amount_max}` : '',
        ].filter(Boolean).join(' - ')}`
      : '',
    closeDate ? `Deadline: ${closeDate}` : '',
  ].map((line) => line.trim()).filter(Boolean)
}

function collectBudgetPrepFacts(section: GrantBlueprintPlanSection): string[] {
  const facts = [
    ...(section.authoritativePrepBundle?.bullets || []),
    ...(section.prepContextBlock?.bullets || []),
    ...(section.relatedPrepAwareness?.bullets || []),
    ...(section.mustCover || []),
  ]
  const seen = new Set<string>()
  const next: string[] = []
  for (const fact of facts) {
    const normalized = String(fact || '').trim().replace(/\s+/g, ' ')
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
    if (next.length >= 30) break
  }
  return next
}

function stringifyStructuredSection(value: unknown) {
  if (!value) return ''

  const record = value as Record<string, unknown>
  if (Array.isArray(record.items)) {
    return record.items
      .map((item) => {
        const row = item as Record<string, unknown>
        return `- ${String(row.label || 'Item')}${row.notes ? `: ${String(row.notes)}` : ''}`
      })
      .join('\n')
  }

  if (Array.isArray(record.rows)) {
    return record.rows
      .map((row) => JSON.stringify(row))
      .join('\n')
  }

  return JSON.stringify(value, null, 2)
}

export async function generateGrantSectionDraft(input: {
  grantSessionId: string
  tenantId: string
  sectionKey: string
  userId: string
  userInstructions?: string | null
  overwriteAmounts?: boolean
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })

  if (!workspace || !workspace.blueprint) {
    throw new Error('Grant workspace not found')
  }

  const blueprint = workspace.blueprint

  if (blueprint.status !== 'FROZEN') {
    throw new Error('Freeze the blueprint before generating draft sections.')
  }

  const sectionDraft = blueprint.sectionDrafts.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionDraft) {
    throw new Error('Grant section not found')
  }

  const sectionPlan = blueprint.sectionPlan.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionPlan) {
    throw new Error('Grant section plan not found')
  }

  if (sectionDraft.sectionType !== 'budget_rows') {
    if (isGrantSectionAutoDraftable({
      sectionType: sectionDraft.sectionType,
      workflowMode: (sectionDraft as { workflowMode?: string }).workflowMode,
    })) {
      throw new Error('App draft sections are generated in the linked literature workspace.')
    }
    throw new Error('Only budget sections are eligible for structured generation.')
  }

  const currency = workspace.grantSession.fundingCall?.currency || null
  const currentData = getStructuredResponseValue(sectionDraft)
    || buildBudgetStructuredScaffold({
      section: sectionPlan,
      currency,
    })
  const budgetTemplate = sectionPlan.budgetTemplate
    ? { ...sectionPlan.budgetTemplate, currency: sectionPlan.budgetTemplate.currency || currency }
    : buildFallbackBudgetTemplate(currency)
  const prompt = buildBudgetDraftingPrompt({
    budgetTemplate,
    currentData,
    grantContextSummary: summarizeFundingContext(workspace),
    prepFacts: collectBudgetPrepFacts(sectionPlan),
    userInstructions: input.userInstructions || null,
  })
  const tenantContext = await resolveGrantTenantContext(input.tenantId, input.userId)
  if (!tenantContext) {
    throw new Error('Unable to resolve tenant context for budget generation.')
  }

  const result = await llmGateway.executeLLMOperation(
    { tenantContext },
    {
      taskCode: 'GRANT_SECTION_GENERATE',
      stageCode: 'GRANT_BUDGET_DRAFT',
      prompt,
      parameters: {
        purpose: 'grant_budget_structured_draft',
        temperature: 0.1,
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        grantSessionId: input.grantSessionId,
        sectionKey: input.sectionKey,
        purpose: 'grant_budget_structured_draft',
      },
    }
  )

  if (!result.success || !result.response?.output) {
    throw new Error(result.error?.message || 'Budget section generation failed.')
  }

  const structuredData = validateBudgetDraftLlmResult({
    rawOutput: result.response.output,
    template: budgetTemplate,
    currentData,
    allowNewNumericValues: Boolean(String(input.userInstructions || '').trim()),
    preserveCurrentNumericValues: input.overwriteAmounts !== true,
  })

  return saveGrantSectionDraft({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
    sectionKey: input.sectionKey,
    userId: input.userId,
    structuredData,
    markReviewed: false,
  })
}

export async function saveGrantSectionDraft(input: {
  grantSessionId: string
  tenantId: string
  sectionKey: string
  userId: string
  content?: string | null
  structuredData?: unknown
  markReviewed?: boolean
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })

  if (!workspace || !workspace.blueprint) {
    throw new Error('Grant workspace not found')
  }

  const blueprint = workspace.blueprint
  const sectionDraft = blueprint.sectionDrafts.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionDraft) {
    throw new Error('Grant section not found')
  }

  if (sectionDraft.workflowMode === 'app_draft') {
    throw new Error('App draft sections are edited in the linked literature workspace.')
  }

  return prisma.$transaction(async (tx) => {
    let savedDraft = sectionDraft

    if (sectionDraft.sectionType === 'narrative' || sectionDraft.sectionType === 'short_answer') {
      const updatedDraft = await tx.grantSectionDraft.update({
        where: { id: sectionDraft.id },
        data: {
          content: input.content ?? sectionDraft.content,
          status: input.markReviewed ? 'REVIEWED' : 'DRAFT',
          version: { increment: 1 },
          updatedByUserId: input.userId,
        },
        include: {
          structuredResponses: true,
        },
      })
      savedDraft = {
        ...updatedDraft,
        workflowMode: sectionDraft.workflowMode,
        citationMode: sectionDraft.citationMode,
      }
    } else if (typeof input.structuredData !== 'undefined') {
      await tx.grantStructuredFieldResponse.upsert({
        where: {
          sectionDraftId_fieldKey: {
            sectionDraftId: sectionDraft.id,
            fieldKey: 'structuredData',
          },
        },
        update: {
          responseJson: input.structuredData as never,
          updatedByUserId: input.userId,
        },
        create: {
          grantSessionId: sectionDraft.grantSessionId,
          sectionDraftId: sectionDraft.id,
          tenantId: sectionDraft.tenantId,
          projectId: sectionDraft.projectId,
          sectionKey: sectionDraft.sectionKey,
          fieldKey: 'structuredData',
          responseJson: input.structuredData as never,
          updatedByUserId: input.userId,
        },
      })

      const updatedDraft = await tx.grantSectionDraft.update({
        where: { id: sectionDraft.id },
        data: {
          status: input.markReviewed ? 'REVIEWED' : 'DRAFT',
          version: { increment: 1 },
          updatedByUserId: input.userId,
        },
        include: {
          structuredResponses: true,
        },
      })
      savedDraft = {
        ...updatedDraft,
        workflowMode: sectionDraft.workflowMode,
        citationMode: sectionDraft.citationMode,
      }
    }

    return savedDraft
  })
}

export function renderGrantSectionForExport(sectionDraft: {
  sectionType: string
  content: string | null
  structuredResponses: Array<{ fieldKey: string; responseJson: unknown }>
}) {
  if (sectionDraft.sectionType === 'narrative' || sectionDraft.sectionType === 'short_answer') {
    return sectionDraft.content || ''
  }

  const structuredData = sectionDraft.structuredResponses.find((response) => response.fieldKey === 'structuredData')
  return stringifyStructuredSection(structuredData?.responseJson)
}
