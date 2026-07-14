import crypto from 'crypto'

import prisma from '@/lib/prisma'
import { llmGateway } from '@/lib/metering'
import { formatBibliographyMarkdown } from '@/lib/markdown-draft-formatter'
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service'
import {
  buildBudgetDraftingPrompt,
  buildBudgetStructuredScaffold,
  buildFallbackBudgetTemplate,
  mergeBudgetTemplateWithStructuredTable,
  validateBudgetDraftLlmResult,
} from '@/lib/grants/budgetTemplate'
import { collectUsedGrantCitationKeysForBibliography } from '@/lib/grants/bibliography'
import {
  getGrantWorkspace,
  resolveGrantTenantContext,
} from '@/lib/grants/workspace'
import {
  GRANT_BIBLIOGRAPHY_SECTION_KEY,
  isGrantBibliographySection,
  isGrantSectionAutoDraftable,
} from '@/lib/grants/workflowMode'
import type { GrantBlueprintPlanSection } from '@/types/grant'

const NUMERIC_BIBLIOGRAPHY_STYLES = new Set(['IEEE', 'VANCOUVER'])

type BibliographySortOrder = 'alphabetical' | 'order_of_appearance'

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
    ...String(section.seededContext || '').split('\n'),
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

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: Array.isArray(citation.authors) ? citation.authors : [],
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey,
  }
}

async function resolveBibliographyStyle(
  preferredStyleCode?: string | null,
  preferredSortOrder?: BibliographySortOrder | null
): Promise<{
  styleCode: string
  sortOrder: BibliographySortOrder
}> {
  const preferred = String(preferredStyleCode || process.env.DEFAULT_CITATION_STYLE || 'APA7').trim() || 'APA7'
  const preferredStyle = await citationStyleService.getCitationStyle(preferred)
  const style = preferredStyle || (preferred.toUpperCase() === 'APA7'
    ? null
    : await citationStyleService.getCitationStyle('APA7'))
  const styleCode = style?.code || 'APA7'
  const normalizedStyleCode = styleCode.toUpperCase()
  const sortOrder = NUMERIC_BIBLIOGRAPHY_STYLES.has(normalizedStyleCode)
    ? 'order_of_appearance'
    : preferredSortOrder === 'order_of_appearance'
      ? 'order_of_appearance'
    : style?.bibliographySortOrder === 'order_of_appearance'
      ? 'order_of_appearance'
      : 'alphabetical'

  return { styleCode, sortOrder }
}

async function generateGrantBibliographySectionDraft(input: {
  projectId: string
  grantSessionId: string
  tenantId: string
  userId: string
  draftingSessionId: string | null
  sectionDrafts?: Array<{
    sectionKey: string
    content?: string | null
    structuredResponses?: Array<{ responseJson?: unknown }> | null
  }>
  styleCode?: string | null
  sortOrder?: BibliographySortOrder | null
}) {
  const draftingSessionId = String(input.draftingSessionId || '').trim()
  if (!draftingSessionId) {
    throw new Error('No linked literature workspace is available for bibliography generation.')
  }

  const draftingSession = await prisma.draftingSession.findUnique({
    where: { id: draftingSessionId },
    include: {
      citationStyle: true,
      citations: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!draftingSession || draftingSession.tenantId !== input.tenantId) {
    throw new Error('No linked literature workspace is available for bibliography generation.')
  }
  if (draftingSession.citations.length === 0) {
    throw new Error('No active citations are available for bibliography generation.')
  }

  const persistedGrantSectionDrafts = await prisma.grantSectionDraft.findMany({
    where: {
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
    },
    orderBy: { sectionOrder: 'asc' },
    include: {
      structuredResponses: {
        select: {
          responseJson: true,
        },
      },
    },
  })

  const usedCitationKeys = collectUsedGrantCitationKeysForBibliography(
    persistedGrantSectionDrafts.length > 0 ? persistedGrantSectionDrafts : input.sectionDrafts || [],
    draftingSession.citations.map((citation) => citation.citationKey)
  )
  if (usedCitationKeys.length === 0) {
    return saveGrantSectionDraft({
      projectId: input.projectId,
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      sectionKey: GRANT_BIBLIOGRAPHY_SECTION_KEY,
      userId: input.userId,
      content: '',
      markReviewed: false,
    })
  }

  const citationsByKey = new Map(
    draftingSession.citations.map((citation) => [String(citation.citationKey || '').trim(), citation])
  )
  const usedCitations = usedCitationKeys
    .map((key) => citationsByKey.get(key))
    .filter(Boolean)

  if (usedCitations.length === 0) {
    return saveGrantSectionDraft({
      projectId: input.projectId,
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      sectionKey: GRANT_BIBLIOGRAPHY_SECTION_KEY,
      userId: input.userId,
      content: '',
      markReviewed: false,
    })
  }

  const { styleCode, sortOrder } = await resolveBibliographyStyle(
    input.styleCode || draftingSession.citationStyle?.code,
    input.sortOrder
  )
  const rawBibliography = await citationStyleService.generateBibliography(
    usedCitations.map(toCitationData),
    styleCode,
    { sortOrder }
  )
  const bibliography = formatBibliographyMarkdown(rawBibliography, sortOrder)
  if (!bibliography) {
    throw new Error('No bibliography content could be generated from the active citations.')
  }

  return saveGrantSectionDraft({
    projectId: input.projectId,
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
    sectionKey: GRANT_BIBLIOGRAPHY_SECTION_KEY,
    userId: input.userId,
    content: bibliography,
    markReviewed: false,
  })
}

export async function generateGrantSectionDraft(input: {
  projectId: string
  grantSessionId: string
  tenantId: string
  sectionKey: string
  userId: string
  userInstructions?: string | null
  allowInstructionAmounts?: boolean
  overwriteAmounts?: boolean
  useCurrentBudgetValues?: boolean
  bibliographyStyle?: string | null
  bibliographySortOrder?: BibliographySortOrder | null
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })

  if (!workspace || !workspace.blueprint) {
    throw new Error('Grant workspace not found')
  }
  if (workspace.grantSession.projectId !== input.projectId) {
    throw new Error('Grant workspace not found')
  }

  const blueprint = workspace.blueprint
  if (blueprint.status !== 'FROZEN') {
    throw new Error('Freeze the blueprint before generating draft sections.')
  }

  if (isGrantBibliographySection(input.sectionKey)) {
    return generateGrantBibliographySectionDraft({
      projectId: input.projectId,
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      draftingSessionId: workspace.grantSession.draftingSessionId,
      sectionDrafts: blueprint.sectionDrafts,
      styleCode: input.bibliographyStyle,
      sortOrder: input.bibliographySortOrder,
    })
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
      sectionKey: sectionDraft.sectionKey,
      sectionType: sectionDraft.sectionType,
      workflowMode: (sectionDraft as { workflowMode?: string }).workflowMode,
    })) {
      throw new Error('App draft sections are generated in the linked literature workspace.')
    }
    throw new Error('Only budget sections are eligible for structured generation.')
  }

  const currency = workspace.grantSession.fundingCall?.currency || null
  const scaffoldData = buildBudgetStructuredScaffold({
    section: sectionPlan,
    currency,
  })
  const savedStructuredData = getStructuredResponseValue(sectionDraft)
  const useCurrentBudgetValues = input.useCurrentBudgetValues === true
  const budgetContextData = useCurrentBudgetValues && savedStructuredData
    ? savedStructuredData
    : scaffoldData
  const budgetTemplate = sectionPlan.budgetTemplate
    ? { ...sectionPlan.budgetTemplate, currency: sectionPlan.budgetTemplate.currency || currency }
    : buildFallbackBudgetTemplate(currency)
  const generationBudgetTemplate = useCurrentBudgetValues
    ? mergeBudgetTemplateWithStructuredTable(budgetTemplate, budgetContextData)
    : budgetTemplate
  const prompt = buildBudgetDraftingPrompt({
    budgetTemplate: generationBudgetTemplate,
    currentData: budgetContextData,
    grantContextSummary: summarizeFundingContext(workspace),
    prepFacts: collectBudgetPrepFacts(sectionPlan),
    userInstructions: input.userInstructions || null,
    allowInstructionAmounts: input.allowInstructionAmounts === true,
    overwriteAmounts: input.overwriteAmounts === true,
    useCurrentBudgetValues,
  })
  const tenantContext = await resolveGrantTenantContext(input.tenantId, input.userId)
  if (!tenantContext) {
    throw new Error('Unable to resolve tenant context for budget generation.')
  }

  const result = await llmGateway.executeLLMOperation(
    { tenantContext },
    {
      taskCode: 'GRANT_SECTION_GENERATE',
      stageCode: 'PAPER_SECTION_DRAFT',
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
        skipFeaturePolicy: true,
      },
    }
  )

  if (!result.success || !result.response?.output) {
    throw new Error(result.error?.message || 'Budget section generation failed.')
  }

  const structuredData = validateBudgetDraftLlmResult({
    rawOutput: result.response.output,
    template: generationBudgetTemplate,
    currentData: budgetContextData,
    allowNewNumericValues: input.allowInstructionAmounts === true || input.overwriteAmounts === true,
    preserveCurrentNumericValues: useCurrentBudgetValues && input.overwriteAmounts !== true,
  })

  return saveGrantSectionDraft({
    projectId: input.projectId,
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
    sectionKey: input.sectionKey,
    userId: input.userId,
    structuredData,
    markReviewed: false,
  })
}

export async function saveGrantSectionDraft(input: {
  projectId: string
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
  if (workspace.grantSession.projectId !== input.projectId) {
    throw new Error('Grant workspace not found')
  }

  const blueprint = workspace.blueprint
  const freezePayload = blueprint.freezePayloadJson && typeof blueprint.freezePayloadJson === 'object'
    ? blueprint.freezePayloadJson as Record<string, unknown>
    : {}
  const currentIdeaAnchorHash = String(freezePayload.ideaAnchorHash || '').trim() || null
  const sectionDraft = blueprint.sectionDrafts.find((section) => section.sectionKey === input.sectionKey)
  if (!sectionDraft) {
    throw new Error('Grant section not found')
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
          isStale: false,
          staleReason: null,
          sourceIdeaAnchorHash: currentIdeaAnchorHash,
        },
        include: {
          structuredResponses: true,
        },
      })
      savedDraft = {
        ...sectionDraft,
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
          isStale: false,
          staleReason: null,
          sourceIdeaAnchorHash: currentIdeaAnchorHash,
        },
        include: {
          structuredResponses: true,
        },
      })
      savedDraft = {
        ...sectionDraft,
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
