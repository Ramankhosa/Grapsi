import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { buildGrantPrepFreezePayload } from '@/lib/grantPrep/handoff/handoffBuilder'
import type { GrantPrepActor } from '@/lib/grantPrep/access'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import type { GrantTemplateDocument, FundingTemplateItem } from '@/lib/fundingTemplates/types'
import { normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'
import { blueprintService, type BlueprintFreezeReadiness } from '@/lib/services/blueprint-service'
import type {
  CompiledGrantTemplate,
  CompiledGrantTemplateSection,
  CompiledGrantTemplateSectionType,
} from '@/types/grant'

type JsonObject = Record<string, unknown>

export interface GrantBlueprintPlanSection {
  sectionKey: string
  label: string
  order: number
  sectionType: CompiledGrantTemplateSectionType
  required: boolean
  wordBudget: number | null
  characterLimit: number | null
  purpose: string
  reviewerIntent: string | null
  dependencies: string[]
  sourceTemplatePointer: string | null
  mustCover: string[]
  mustAvoid: string[]
  seededContext: string
}

export interface LocalGrantLaunchPreview {
  blockers: Array<{ stageKey: string; pointKey: string; message: string }>
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
  payloadHash: string
  sectionPreview: Array<{
    sectionKey: string
    label: string
    sectionType: CompiledGrantTemplateSectionType
    required: boolean
  }>
  canLaunch: boolean
  grantSessionId: string | null
  launchUrl: string | null
}

export interface GrantProposalFoundation {
  thesisStatement: string
  centralObjective: string
  keyContributions: string[]
  status: string | null
  version: number | null
}

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isCompiledGrantTemplate(value: unknown): value is CompiledGrantTemplate {
  const record = asObject(value)
  return Array.isArray(record.sections) && typeof record.version === 'string'
}

function resolveSectionType(item: FundingTemplateItem): CompiledGrantTemplateSectionType {
  if (item.type === 'table') return 'table'
  if (item.type === 'budget') return 'budget_rows'
  if (item.type === 'checklist' || item.type === 'attachment') return 'checklist'
  if (item.type === 'field') return 'short_answer'
  if ((item.wordLimit || 0) <= 350 && (item.charLimit || 0) <= 2500) {
    return 'short_answer'
  }
  return 'narrative'
}

function normalizeCompiledSection(
  section: Partial<CompiledGrantTemplateSection>,
  index: number
): CompiledGrantTemplateSection {
  return {
    sectionKey: String(section.sectionKey || `section_${index + 1}`),
    label: String(section.label || section.sectionKey || `Section ${index + 1}`),
    order: Number.isFinite(section.order) ? Number(section.order) : index + 1,
    sectionType: (section.sectionType || 'narrative') as CompiledGrantTemplateSectionType,
    required: section.required !== false,
    wordBudget: section.wordBudget ?? null,
    characterLimit: section.characterLimit ?? null,
    purpose: String(section.purpose || ''),
    reviewerIntent: section.reviewerIntent ?? null,
    dependencies: Array.isArray(section.dependencies) ? section.dependencies : [],
    sourceTemplatePointer: section.sourceTemplatePointer ?? null,
    mustCover: Array.isArray(section.mustCover) ? section.mustCover : [],
    mustAvoid: Array.isArray(section.mustAvoid) ? section.mustAvoid : [],
  }
}

function compileGrantTemplateDocument(input: {
  fundingCallId: string
  templateRevisionId: string
  guidelineRevisionId: string | null
  document: GrantTemplateDocument
}): CompiledGrantTemplate {
  const sections: CompiledGrantTemplateSection[] = []
  const seenKeys = new Set<string>()
  let order = 0

  const pushItem = (
    item: FundingTemplateItem,
    fallbackLabel: string,
    forcedType?: CompiledGrantTemplateSectionType
  ) => {
    const rawKey = item.key || slugify(item.label || fallbackLabel) || `section_${order + 1}`
    if (seenKeys.has(rawKey)) return
    seenKeys.add(rawKey)
    order += 1
    const label = item.label || fallbackLabel || rawKey
    const guidance = item.guidance?.trim() || ''
    sections.push({
      sectionKey: rawKey,
      label,
      order,
      sectionType: forcedType || resolveSectionType(item),
      required: item.required !== false,
      wordBudget: item.wordLimit ?? null,
      characterLimit: item.charLimit ?? null,
      purpose: guidance || `Prepare ${label}.`,
      reviewerIntent: guidance || null,
      dependencies: [],
      sourceTemplatePointer: rawKey,
      mustCover: guidance ? [guidance] : [],
      mustAvoid: [],
    })
  }

  for (const section of input.document.sections || []) {
    pushItem(section, section.label || 'Narrative Section')
  }

  for (const question of input.document.questions || []) {
    pushItem(question, question.label || 'Response', 'short_answer')
  }

  if (input.document.budget && (input.document.budget.required || input.document.budget.categories.length > 0)) {
    order += 1
    sections.push({
      sectionKey: 'budget',
      label: 'Budget',
      order,
      sectionType: 'budget_rows',
      required: input.document.budget.required,
      wordBudget: null,
      characterLimit: null,
      purpose: input.document.budget.justificationNotes || 'Provide the requested project budget.',
      reviewerIntent: input.document.budget.justificationNotes || null,
      dependencies: [],
      sourceTemplatePointer: 'budget',
      mustCover: input.document.budget.categories.map((category) => category.label),
      mustAvoid: [],
    })
  }

  if ((input.document.attachments || []).length > 0) {
    order += 1
    sections.push({
      sectionKey: 'attachments',
      label: 'Attachments Checklist',
      order,
      sectionType: 'checklist',
      required: true,
      wordBudget: null,
      characterLimit: null,
      purpose: 'Track the supporting attachments required with the proposal.',
      reviewerIntent: null,
      dependencies: [],
      sourceTemplatePointer: 'attachments',
      mustCover: input.document.attachments.map((item) => item.label),
      mustAvoid: [],
    })
  }

  if (sections.length === 0) {
    sections.push({
      sectionKey: 'proposal_narrative',
      label: 'Proposal Narrative',
      order: 1,
      sectionType: 'narrative',
      required: true,
      wordBudget: null,
      characterLimit: null,
      purpose: 'Draft the core proposal narrative.',
      reviewerIntent: null,
      dependencies: [],
      sourceTemplatePointer: 'proposal_narrative',
      mustCover: [],
      mustAvoid: [],
    })
  }

  return {
    version: 'compiled_grant_template_v1',
    fundingCallId: input.fundingCallId,
    templateRevisionId: input.templateRevisionId,
    guidelineRevisionId: input.guidelineRevisionId,
    sections,
  }
}

async function resolveApprovedTemplateForSession(input: {
  fundingCallId: string
  templateRevisionId: string | null
  guidelineRevisionId: string | null
}) {
  if (input.templateRevisionId) {
    const revision = await prisma.fundingCallTemplateRevision.findUnique({
      where: { id: input.templateRevisionId },
      select: {
        id: true,
        compiledGrantTemplateJson: true,
        grant_template_json: true,
      },
    })
    if (revision) {
      const compiled = isCompiledGrantTemplate(revision.compiledGrantTemplateJson)
        ? revision.compiledGrantTemplateJson
        : compileGrantTemplateDocument({
            fundingCallId: input.fundingCallId,
            templateRevisionId: revision.id,
            guidelineRevisionId: input.guidelineRevisionId,
            document: normalizeGrantTemplate(revision.grant_template_json),
          })

      return {
        templateRevisionId: revision.id,
        compiledTemplate: {
          ...compiled,
          sections: compiled.sections.map(normalizeCompiledSection),
          fundingCallId: input.fundingCallId,
          templateRevisionId: revision.id,
          guidelineRevisionId: input.guidelineRevisionId,
        } satisfies CompiledGrantTemplate,
      }
    }
  }

  const template = await prisma.fundingCallTemplate.findUnique({
    where: { fundingCallId: input.fundingCallId },
    select: {
      id: true,
      status: true,
      current_revision_no: true,
      compiledGrantTemplateJson: true,
      grant_template_json: true,
    },
  })

  if (!template || template.status !== 'approved') {
    throw new Error('An approved template is required before launching the local grant workspace.')
  }

  const templateRevisionId = `${template.id}:current:${template.current_revision_no}`
  const compiled = isCompiledGrantTemplate(template.compiledGrantTemplateJson)
    ? template.compiledGrantTemplateJson
    : compileGrantTemplateDocument({
        fundingCallId: input.fundingCallId,
        templateRevisionId,
        guidelineRevisionId: input.guidelineRevisionId,
        document: normalizeGrantTemplate(template.grant_template_json),
      })

  return {
    templateRevisionId,
    compiledTemplate: {
      ...compiled,
      sections: compiled.sections.map(normalizeCompiledSection),
      fundingCallId: input.fundingCallId,
      templateRevisionId,
      guidelineRevisionId: input.guidelineRevisionId,
    } satisfies CompiledGrantTemplate,
  }
}

function buildSeededContext(
  section: CompiledGrantTemplateSection,
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
) {
  const completedCaptures = Object.values(payload.stageStates)
    .filter((stage) => stage.enabled)
    .flatMap((stage) =>
      stage.points
        .filter((point) => point.status === 'covered' && point.capture)
        .map((point) => ({
          stageTitle: stage.title,
          pointLabel: point.label,
          keywords: point.capture?.keywords || [],
        }))
    )

  const bulletLines = [
    payload.project.title ? `Project: ${payload.project.title}` : null,
    payload.project.description ? `Project description: ${payload.project.description}` : null,
    payload.fundingCall.title ? `Funding call: ${payload.fundingCall.title}` : null,
    payload.fundingCall.agencyName ? `Agency: ${payload.fundingCall.agencyName}` : null,
    payload.fundingCall.deadline ? `Deadline: ${payload.fundingCall.deadline}` : null,
    payload.fundingCall.funding ? `Funding: ${payload.fundingCall.funding}` : null,
    payload.fundingCall.projectDuration ? `Project duration: ${payload.fundingCall.projectDuration}` : null,
    payload.fundingCall.eligibility ? `Eligibility: ${payload.fundingCall.eligibility}` : null,
    payload.fundingCall.deliverables ? `Deliverables: ${payload.fundingCall.deliverables}` : null,
    payload.fundingCall.focusAreas.length > 0 ? `Focus areas: ${payload.fundingCall.focusAreas.join(', ')}` : null,
    payload.globalKeywords.length > 0 ? `Global keywords: ${payload.globalKeywords.join(', ')}` : null,
    section.mustCover.length > 0 ? `This section must cover: ${section.mustCover.join('; ')}` : null,
    ...completedCaptures.slice(0, 8).map(
      (capture) => `${capture.stageTitle} - ${capture.pointLabel}: ${capture.keywords.join(', ')}`
    ),
  ]

  return bulletLines.filter(Boolean).join('\n')
}

export function buildBlueprintPlanFromCompiledTemplate(
  compiledTemplate: CompiledGrantTemplate,
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
) {
  return [...compiledTemplate.sections]
    .sort((left, right) => left.order - right.order)
    .map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      order: section.order,
      sectionType: section.sectionType,
      required: section.required,
      wordBudget: section.wordBudget ?? null,
      characterLimit: section.characterLimit ?? null,
      purpose: section.purpose,
      reviewerIntent: section.reviewerIntent ?? null,
      dependencies: section.dependencies || [],
      sourceTemplatePointer: section.sourceTemplatePointer ?? null,
      mustCover: section.mustCover || [],
      mustAvoid: section.mustAvoid || [],
      seededContext: buildSeededContext(section, payload),
    })) satisfies GrantBlueprintPlanSection[]
}

function buildStructuredScaffold(
  section: GrantBlueprintPlanSection,
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
) {
  if (section.sectionType === 'checklist') {
    return {
      items: (section.mustCover.length > 0 ? section.mustCover : ['Required item']).map((label, index) => ({
        id: `${section.sectionKey}_${index + 1}`,
        label,
        completed: false,
        notes: '',
      })),
    }
  }

  if (section.sectionType === 'table') {
    return {
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'details', label: 'Details' },
      ],
      rows: [],
    }
  }

  return {
    currency: payload.fundingCall.funding.match(/[A-Z]{3}/)?.[0] || null,
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount' },
      { key: 'justification', label: 'Justification' },
    ],
    rows: [],
  }
}

function isDraftableGrantSection(
  sectionType: CompiledGrantTemplateSectionType | string
): boolean {
  return sectionType === 'narrative' || sectionType === 'short_answer'
}

function buildGrantPaperTypeCode(templateRevisionId: string | null | undefined) {
  const value = String(templateRevisionId || '').trim()
  return value ? `GRANT_TEMPLATE::${value}` : null
}

function sanitizeFoundation(input?: Partial<GrantProposalFoundation> | null) {
  return {
    thesisStatement: String(input?.thesisStatement || '').trim(),
    centralObjective: String(input?.centralObjective || '').trim(),
    keyContributions: asStringArray(input?.keyContributions || []),
  }
}

function buildShadowResearchTopic(input: {
  projectName: string
  fundingCallTitle: string | null
  sectionPlan: GrantBlueprintPlanSection[]
  globalKeywords: string[]
}) {
  const title = input.projectName.trim() || input.fundingCallTitle?.trim() || 'Grant proposal'
  const firstNarrative = input.sectionPlan.find((section) => isDraftableGrantSection(section.sectionType))

  return {
    title,
    topicDescription: input.fundingCallTitle
      ? `Grant proposal aligned to ${input.fundingCallTitle}.`
      : 'Grant proposal workspace.',
    researchQuestion: firstNarrative?.purpose?.trim()
      ? `How should the proposal satisfy ${firstNarrative.label} while addressing the funding call priorities?`
      : `How should this proposal satisfy the funding call requirements?`,
    methodology: 'OTHER' as const,
    contributionType: 'APPLIED' as const,
    keywords: input.globalKeywords,
    subQuestions: [] as string[],
    techniques: [] as string[],
    tools: [] as string[],
  }
}

function buildPaperSectionPlanFromGrantSections(
  sectionPlan: GrantBlueprintPlanSection[],
  existingSectionPlan: unknown
) {
  const existingItems = Array.isArray(existingSectionPlan) ? existingSectionPlan : []
  const existingByKey = new Map(
    existingItems
      .map((item) => asObject(item))
      .map((item) => [String(item.sectionKey || '').trim(), item] as const)
      .filter(([sectionKey]) => Boolean(sectionKey))
  )

  return [...sectionPlan]
    .filter((section) => isDraftableGrantSection(section.sectionType))
    .sort((left, right) => left.order - right.order)
    .map((section) => {
      const existing = existingByKey.get(section.sectionKey) || {}
      const existingThematic = asObject(existing.thematicBlueprint)
      const mustCoverTyping =
        Object.keys(asObject(existing.mustCoverTyping)).length > 0
          ? asObject(existing.mustCoverTyping)
          : asObject(existingThematic.mustCoverTyping)
      const suggestedCitationCountRaw =
        existing.suggestedCitationCount ?? existingThematic.suggestedCitationCount
      const suggestedCitationCount = Number.isFinite(Number(suggestedCitationCountRaw))
        ? Number(suggestedCitationCountRaw)
        : undefined

      const thematicBlueprint = {
        mustCover: [...section.mustCover],
        mustAvoid: [...section.mustAvoid],
        ...(Object.keys(mustCoverTyping).length > 0 ? { mustCoverTyping } : {}),
        ...(typeof suggestedCitationCount === 'number'
          ? { suggestedCitationCount }
          : {}),
      }

      return {
        sectionKey: section.sectionKey,
        purpose: section.purpose,
        mustCover: [...section.mustCover],
        mustAvoid: [...section.mustAvoid],
        ...(typeof section.wordBudget === 'number'
          ? { wordBudget: section.wordBudget }
          : {}),
        dependencies: [...section.dependencies],
        outputsPromised: asStringArray(existing.outputsPromised),
        ...(Object.keys(mustCoverTyping).length > 0 ? { mustCoverTyping } : {}),
        ...(typeof suggestedCitationCount === 'number'
          ? { suggestedCitationCount }
          : {}),
        thematicBlueprint,
        ...(existing.rhetoricalBlueprint ? { rhetoricalBlueprint: existing.rhetoricalBlueprint } : {}),
      }
    })
}

async function ensureGrantShadowWorkspaceTx(
  tx: Prisma.TransactionClient,
  input: {
    grantSessionId: string
    draftingSessionId: string | null
    tenantId: string
    projectId: string
    projectName: string
    fundingCallTitle: string | null
    templateRevisionId: string | null
    userId: string
    sectionPlan: GrantBlueprintPlanSection[]
    globalKeywords: string[]
    blueprintStatus: 'DRAFT' | 'FROZEN'
    foundation?: Partial<GrantProposalFoundation> | null
    resetStatus?: boolean
  }
) {
  let draftingSession = input.draftingSessionId
    ? await tx.draftingSession.findUnique({
        where: { id: input.draftingSessionId },
        include: {
          paperBlueprint: true,
          researchTopic: true,
        },
      })
    : null

  if (!draftingSession) {
    const shadowPatentTitle = `[Grant Shadow ${input.grantSessionId}] ${input.projectName || input.fundingCallTitle || 'Grant proposal'}`
    const existingPatent = await tx.patent.findFirst({
      where: {
        projectId: input.projectId,
        title: shadowPatentTitle,
      },
      select: { id: true },
    })

    const patentId =
      existingPatent?.id ||
      (
        await tx.patent.create({
          data: {
            projectId: input.projectId,
            createdBy: input.userId,
            title: shadowPatentTitle,
          },
          select: { id: true },
        })
      ).id

    draftingSession = await tx.draftingSession.create({
      data: {
        patentId,
        userId: input.userId,
        tenantId: input.tenantId,
        status: 'IDEA_ENTRY',
        literatureReviewStatus: 'NOT_STARTED',
      },
      include: {
        paperBlueprint: true,
        researchTopic: true,
      },
    })

    await tx.grantSession.update({
      where: { id: input.grantSessionId },
      data: {
        draftingSessionId: draftingSession.id,
      },
    })
  }

  if (!draftingSession.researchTopic) {
    await tx.researchTopic.create({
      data: {
        sessionId: draftingSession.id,
        ...buildShadowResearchTopic({
          projectName: input.projectName,
          fundingCallTitle: input.fundingCallTitle,
          sectionPlan: input.sectionPlan,
          globalKeywords: input.globalKeywords,
        }),
      },
    })
  }

  const currentBlueprint = draftingSession.paperBlueprint
  const foundation = sanitizeFoundation(
    input.foundation || {
      thesisStatement: currentBlueprint?.thesisStatement || '',
      centralObjective: currentBlueprint?.centralObjective || '',
      keyContributions: currentBlueprint?.keyContributions || [],
    }
  )
  const paperTypeCode = buildGrantPaperTypeCode(input.templateRevisionId)
  const nextSectionPlan = buildPaperSectionPlanFromGrantSections(
    input.sectionPlan,
    currentBlueprint?.sectionPlan
  )

  if (!currentBlueprint) {
    await tx.paperBlueprint.create({
      data: {
        sessionId: draftingSession.id,
        thesisStatement: foundation.thesisStatement,
        centralObjective: foundation.centralObjective,
        keyContributions: foundation.keyContributions,
        sectionPlan: asJson(nextSectionPlan),
        paperTypeCode,
        methodologyType: 'OTHER',
        status: input.blueprintStatus === 'FROZEN' ? 'FROZEN' : 'DRAFT',
        frozenAt: input.blueprintStatus === 'FROZEN' ? new Date() : null,
      },
    })

    return {
      draftingSessionId: draftingSession.id,
    }
  }

  const nextStatus = input.resetStatus
    ? 'DRAFT'
    : currentBlueprint.status
  const nextFrozenAt = input.resetStatus
    ? null
    : currentBlueprint.status === 'FROZEN'
      ? currentBlueprint.frozenAt || new Date()
      : null

  const paperBlueprintUpdate = {
    thesisStatement: foundation.thesisStatement,
    centralObjective: foundation.centralObjective,
    keyContributions: foundation.keyContributions,
    sectionPlan: nextSectionPlan,
    paperTypeCode,
    methodologyType: 'OTHER',
    status: nextStatus,
    frozenAt: nextFrozenAt,
  }

  const currentSnapshot = {
    thesisStatement: currentBlueprint.thesisStatement,
    centralObjective: currentBlueprint.centralObjective,
    keyContributions: currentBlueprint.keyContributions,
    sectionPlan: currentBlueprint.sectionPlan,
    paperTypeCode: currentBlueprint.paperTypeCode,
    methodologyType: currentBlueprint.methodologyType,
    status: currentBlueprint.status,
    frozenAt: currentBlueprint.frozenAt ? currentBlueprint.frozenAt.toISOString() : null,
  }

  const nextSnapshot = {
    ...paperBlueprintUpdate,
    frozenAt: paperBlueprintUpdate.frozenAt
      ? paperBlueprintUpdate.frozenAt.toISOString()
      : null,
  }

  if (JSON.stringify(currentSnapshot) !== JSON.stringify(nextSnapshot)) {
    await tx.paperBlueprint.update({
      where: { sessionId: draftingSession.id },
      data: {
        thesisStatement: foundation.thesisStatement,
        centralObjective: foundation.centralObjective,
        keyContributions: foundation.keyContributions,
        sectionPlan: asJson(nextSectionPlan),
        paperTypeCode,
        methodologyType: 'OTHER',
        status: nextStatus,
        frozenAt: nextFrozenAt,
        version: { increment: 1 },
      },
    })
  }

  return {
    draftingSessionId: draftingSession.id,
  }
}

async function ensureGrantShadowWorkspace(input: {
  grantSessionId: string
  tenantId: string
  userId?: string
}) {
  const grantSession = await prisma.grantSession.findFirst({
    where: {
      id: input.grantSessionId,
      tenantId: input.tenantId,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      fundingCall: {
        select: {
          scheme_title: true,
        },
      },
      blueprint: true,
    },
  })

  if (!grantSession?.blueprint) {
    return null
  }
  const blueprint = grantSession.blueprint

  const sectionPlan = Array.isArray(blueprint.sectionPlanJson)
    ? (blueprint.sectionPlanJson as unknown as GrantBlueprintPlanSection[])
    : []

  return prisma.$transaction((tx) =>
    ensureGrantShadowWorkspaceTx(tx, {
      grantSessionId: grantSession.id,
      draftingSessionId: grantSession.draftingSessionId,
      tenantId: grantSession.tenantId,
      projectId: grantSession.projectId,
      projectName: grantSession.project.name || '',
      fundingCallTitle: grantSession.fundingCall?.scheme_title || null,
      templateRevisionId: blueprint.sourceTemplateRevisionId || null,
      userId: input.userId || grantSession.updatedByUserId,
      sectionPlan,
      globalKeywords: asStringArray(blueprint.globalKeywordsJson),
      blueprintStatus: blueprint.status,
    })
  )
}

async function loadGrantWorkspaceRecord(input: {
  grantSessionId: string
  tenantId: string
}) {
  return prisma.grantSession.findFirst({
    where: {
      id: input.grantSessionId,
      tenantId: input.tenantId,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          tenantId: true,
        },
      },
      fundingCall: {
        select: {
          id: true,
          scheme_title: true,
          agency_name: true,
          close_date: true,
          amount_min: true,
          amount_max: true,
          currency: true,
        },
      },
      prepSession: {
        include: {
          project: {
            select: {
              id: true,
              name: true,
              tenantId: true,
            },
          },
        },
      },
      draftingSession: {
        include: {
          paperBlueprint: true,
        },
      },
      blueprint: {
        include: {
          sectionDrafts: {
            include: {
              structuredResponses: true,
            },
            orderBy: {
              sectionOrder: 'asc',
            },
          },
        },
      },
    },
  })
}

async function ensureGrantSessionAnchor(tx: Prisma.TransactionClient, input: {
  prepSession: NonNullable<Awaited<ReturnType<typeof loadGrantPrepSession>>>
  fundingCallId: string
  tenantId: string
  userId: string
}) {
  if (input.prepSession.grant_session_id) {
    const existing = await tx.grantSession.findUnique({
      where: { id: input.prepSession.grant_session_id },
    })
    if (existing) {
      return tx.grantSession.update({
        where: { id: existing.id },
        data: {
          fundingCallId: input.fundingCallId,
          status: 'BLUEPRINT',
          updatedByUserId: input.userId,
        },
      })
    }
  }

  const existing = await tx.grantSession.findFirst({
    where: {
      projectId: input.prepSession.project_id,
      tenantId: input.tenantId,
      fundingCallId: input.fundingCallId,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  })

  if (existing) {
    return tx.grantSession.update({
      where: { id: existing.id },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.userId,
      },
    })
  }

  return tx.grantSession.create({
    data: {
      projectId: input.prepSession.project_id,
      tenantId: input.tenantId,
      fundingCallId: input.fundingCallId,
      status: 'BLUEPRINT',
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    },
  })
}

async function buildLaunchState(sessionId: string, actor: GrantPrepActor) {
  const prepSession = await loadGrantPrepSession({
    sessionId,
    tenantId: actor.tenantId,
  })

  if (!prepSession) {
    throw new Error('Grant Prep session not found')
  }

  const serverContext = await resolveGrantPrepContext(prepSession.project_id, actor)
  if (!serverContext.fundingCallId) {
    throw new Error('A linked funding call is required before launching the local grant workspace.')
  }

  const prepContext = inflateGrantPrepSessionContext(prepSession, {
    warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
  })

  const freeze = buildGrantPrepFreezePayload({
    project: {
      id: prepSession.project.id,
      title: prepSession.project.name || '',
      description: null,
    },
    fundingContext: serverContext.fundingContext,
    session: prepContext,
    guidelineRevisionId: prepSession.guideline_revision_id,
    templateRevisionId: prepSession.template_revision_id,
  })

  const templateState = await resolveApprovedTemplateForSession({
    fundingCallId: serverContext.fundingCallId,
    templateRevisionId: prepSession.template_revision_id || serverContext.templateRevisionId,
    guidelineRevisionId: prepSession.guideline_revision_id || serverContext.guidelineRevisionId,
  })

  const sectionPlan = buildBlueprintPlanFromCompiledTemplate(templateState.compiledTemplate, freeze.payload)
  const grantSessionId = prepSession.grant_session_id || null

  return {
    prepSession,
    serverContext,
    prepContext,
    freeze,
    templateState,
    sectionPlan,
    grantSessionId,
  }
}

export async function buildGrantPrepLocalLaunchPreview(sessionId: string, actor: GrantPrepActor): Promise<LocalGrantLaunchPreview> {
  const state = await buildLaunchState(sessionId, actor)
  const launchUrl = state.grantSessionId
    ? `/projects/${state.prepSession.project_id}/grants/${state.grantSessionId}/blueprint`
    : null

  return {
    blockers: state.freeze.blockers,
    payload: state.freeze.payload,
    payloadHash: state.freeze.payloadHash,
    sectionPreview: state.sectionPlan.map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      sectionType: section.sectionType,
      required: section.required,
    })),
    canLaunch: state.freeze.blockers.length === 0,
    grantSessionId: state.grantSessionId,
    launchUrl,
  }
}

export async function launchGrantPrepToLocalWorkspace(input: {
  sessionId: string
  actor: GrantPrepActor
  overrideReason?: string | null
}) {
  const state = await buildLaunchState(input.sessionId, input.actor)
  if (state.freeze.blockers.length > 0 && !input.overrideReason?.trim()) {
    throw new Error('Grant Prep still has blockers. Provide an override reason to continue.')
  }

  const frozenPayload = {
    ...state.freeze.payload,
    overrideReason: input.overrideReason?.trim() || null,
  }

  return prisma.$transaction(async (tx) => {
    const grantSession = await ensureGrantSessionAnchor(tx, {
      prepSession: state.prepSession,
      fundingCallId: state.serverContext.fundingCallId!,
      tenantId: input.actor.tenantId,
      userId: input.actor.id,
    })

    const existingBlueprint = await tx.grantBlueprint.findUnique({
      where: { grantSessionId: grantSession.id },
    })

    const blueprint = existingBlueprint
      ? await tx.grantBlueprint.update({
          where: { id: existingBlueprint.id },
          data: {
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            fundingCallId: state.serverContext.fundingCallId!,
            sourcePrepSessionId: state.prepSession.id,
            sourceTemplateRevisionId: state.templateState.templateRevisionId,
            sourceGuidelineRevisionId: state.prepSession.guideline_revision_id,
            status: 'DRAFT',
            version: { increment: 1 },
            compiledTemplateJson: asJson(state.templateState.compiledTemplate),
            sectionPlanJson: asJson(state.sectionPlan),
            freezePayloadJson: asJson(frozenPayload),
            globalKeywordsJson: asJson(state.freeze.payload.globalKeywords),
            updatedByUserId: input.actor.id,
            frozenAt: null,
          },
        })
      : await tx.grantBlueprint.create({
          data: {
            grantSessionId: grantSession.id,
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            fundingCallId: state.serverContext.fundingCallId!,
            sourcePrepSessionId: state.prepSession.id,
            sourceTemplateRevisionId: state.templateState.templateRevisionId,
            sourceGuidelineRevisionId: state.prepSession.guideline_revision_id,
            status: 'DRAFT',
            compiledTemplateJson: asJson(state.templateState.compiledTemplate),
            sectionPlanJson: asJson(state.sectionPlan),
            freezePayloadJson: asJson(frozenPayload),
            globalKeywordsJson: asJson(state.freeze.payload.globalKeywords),
            createdByUserId: input.actor.id,
            updatedByUserId: input.actor.id,
          },
        })

    const existingDrafts = await tx.grantSectionDraft.findMany({
      where: { grantSessionId: grantSession.id },
    })
    const draftByKey = new Map(existingDrafts.map((draft) => [draft.sectionKey, draft]))

    for (const section of state.sectionPlan) {
      const existingDraft = draftByKey.get(section.sectionKey)
      if (existingDraft) {
        await tx.grantSectionDraft.update({
          where: { id: existingDraft.id },
          data: {
            blueprintId: blueprint.id,
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            label: section.label,
            sectionType: section.sectionType,
            sectionOrder: section.order,
            required: section.required,
            wordBudget: section.wordBudget,
            characterLimit: section.characterLimit,
            purpose: section.purpose,
            reviewerIntent: section.reviewerIntent,
            dependenciesJson: asJson(section.dependencies),
            mustCoverJson: asJson(section.mustCover),
            mustAvoidJson: asJson(section.mustAvoid),
            sourceTemplatePointer: section.sourceTemplatePointer,
            updatedByUserId: input.actor.id,
          },
        })
      } else {
        const createdDraft = await tx.grantSectionDraft.create({
          data: {
            grantSessionId: grantSession.id,
            blueprintId: blueprint.id,
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            sectionKey: section.sectionKey,
            label: section.label,
            sectionType: section.sectionType,
            sectionOrder: section.order,
            required: section.required,
            wordBudget: section.wordBudget,
            characterLimit: section.characterLimit,
            purpose: section.purpose,
            reviewerIntent: section.reviewerIntent,
            dependenciesJson: asJson(section.dependencies),
            mustCoverJson: asJson(section.mustCover),
            mustAvoidJson: asJson(section.mustAvoid),
            sourceTemplatePointer: section.sourceTemplatePointer,
            createdByUserId: input.actor.id,
            updatedByUserId: input.actor.id,
          },
        })

        if (section.sectionType === 'checklist' || section.sectionType === 'table' || section.sectionType === 'budget_rows') {
          await tx.grantStructuredFieldResponse.create({
            data: {
              grantSessionId: grantSession.id,
              sectionDraftId: createdDraft.id,
              tenantId: input.actor.tenantId,
              projectId: state.prepSession.project_id,
              sectionKey: section.sectionKey,
              fieldKey: 'structuredData',
              responseJson: asJson(buildStructuredScaffold(section, state.freeze.payload)),
              updatedByUserId: input.actor.id,
            },
          })
        }
      }
    }

    await ensureGrantShadowWorkspaceTx(tx, {
      grantSessionId: grantSession.id,
      draftingSessionId: grantSession.draftingSessionId,
      tenantId: input.actor.tenantId,
      projectId: state.prepSession.project_id,
      projectName: state.prepSession.project.name || '',
      fundingCallTitle: state.serverContext.fundingContext.title || null,
      templateRevisionId: state.templateState.templateRevisionId,
      userId: input.actor.id,
      sectionPlan: state.sectionPlan,
      globalKeywords: state.freeze.payload.globalKeywords,
      blueprintStatus: 'DRAFT',
    })

    const launchUrl = `/projects/${state.prepSession.project_id}/grants/${grantSession.id}/blueprint`
    await tx.grantPrepSession.update({
      where: { id: state.prepSession.id },
      data: {
        grant_session_id: grantSession.id,
        frozen_payload_json: asJson(frozenPayload),
        frozen_payload_version: state.freeze.payload.version,
        frozen_payload_hash: state.freeze.payloadHash,
        frozen_at: new Date(state.freeze.payload.frozenAt),
        papsi_session_id: null,
        papsi_launch_url: launchUrl,
        status: 'launched',
        last_handoff_error: null,
      },
    })

    await tx.grantSession.update({
      where: { id: grantSession.id },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.actor.id,
      },
    })

    return {
      grantSessionId: grantSession.id,
      blueprintId: blueprint.id,
      launchUrl,
    }
  })
}

export async function getGrantWorkspace(input: {
  grantSessionId: string
  tenantId: string
}) {
  let grantSession = await loadGrantWorkspaceRecord(input)

  if (!grantSession) {
    return null
  }

  if (grantSession.blueprint) {
    await ensureGrantShadowWorkspace({
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      userId: grantSession.updatedByUserId,
    })
    grantSession = await loadGrantWorkspaceRecord(input)
    if (!grantSession) {
      return null
    }
  }

  const sectionPlan = Array.isArray(grantSession.blueprint?.sectionPlanJson)
    ? (grantSession.blueprint?.sectionPlanJson as unknown as GrantBlueprintPlanSection[])
    : []
  const activeSectionKeys = new Set(sectionPlan.map((section) => section.sectionKey))
  const sectionDrafts = (grantSession.blueprint?.sectionDrafts || []).filter((draft) =>
    activeSectionKeys.size === 0 ? true : activeSectionKeys.has(draft.sectionKey)
  )
  const proposalFoundation = grantSession.draftingSession?.paperBlueprint
    ? {
        thesisStatement: grantSession.draftingSession.paperBlueprint.thesisStatement,
        centralObjective: grantSession.draftingSession.paperBlueprint.centralObjective,
        keyContributions: grantSession.draftingSession.paperBlueprint.keyContributions,
        status: grantSession.draftingSession.paperBlueprint.status,
        version: grantSession.draftingSession.paperBlueprint.version,
      }
    : {
        thesisStatement: '',
        centralObjective: '',
        keyContributions: [],
        status: null,
        version: null,
      }
  const freezeReadiness: BlueprintFreezeReadiness = grantSession.draftingSession?.id
    ? await blueprintService.getFreezeReadiness(grantSession.draftingSession.id)
    : {
        ok: false,
        issues: ['Proposal foundation is not ready yet'],
      }

  return {
    grantSession,
    blueprint: grantSession.blueprint
      ? {
          ...grantSession.blueprint,
          sectionPlan,
          sectionDrafts,
        }
      : null,
    proposalFoundation,
    freezeReadiness,
  }
}

export async function updateBlueprintPlan(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  sections?: GrantBlueprintPlanSection[]
  foundation?: Partial<GrantProposalFoundation> | null
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })
  if (!workspace?.blueprint) {
    throw new Error('Grant blueprint not found')
  }
  const blueprint = workspace.blueprint
  if (blueprint.status === 'FROZEN') {
    throw new Error('Cannot update a frozen grant blueprint. Unfreeze it first.')
  }

  const nextSections = input.sections || workspace.blueprint.sectionPlan
  if (!input.sections && !input.foundation) {
    throw new Error('No blueprint changes were provided')
  }

  const existingPlan = workspace.blueprint.sectionPlan
  const lockedSectionMeta = new Map(
    existingPlan.map((section) => [
      section.sectionKey,
      {
        sectionType: section.sectionType,
        required: section.required,
        dependencies: [...section.dependencies].sort().join('|'),
      },
    ])
  )

  for (const section of nextSections) {
    const locked = lockedSectionMeta.get(section.sectionKey)
    if (!locked) {
      throw new Error(`Unknown blueprint section: ${section.sectionKey}`)
    }
    if (
      locked.sectionType !== section.sectionType ||
      locked.required !== section.required ||
      locked.dependencies !== [...section.dependencies].sort().join('|')
    ) {
      throw new Error(`Section ${section.sectionKey} changed outside template-safe constraints`)
    }
  }

  const orderedSections = [...nextSections]
    .sort((left, right) => left.order - right.order)
    .map((section, index) => ({ ...section, order: index + 1 }))

  await prisma.$transaction(async (tx) => {
    await ensureGrantShadowWorkspaceTx(tx, {
      grantSessionId: input.grantSessionId,
      draftingSessionId: workspace.grantSession.draftingSessionId,
      tenantId: input.tenantId,
      projectId: workspace.grantSession.projectId,
      projectName: workspace.grantSession.project.name || '',
      fundingCallTitle: workspace.grantSession.fundingCall?.scheme_title || null,
      templateRevisionId: blueprint.sourceTemplateRevisionId || null,
      userId: input.userId,
      sectionPlan: orderedSections,
      globalKeywords: asStringArray(blueprint.globalKeywordsJson),
      blueprintStatus: 'DRAFT',
      foundation: input.foundation,
      resetStatus: true,
    })

    await tx.grantBlueprint.update({
      where: { id: blueprint.id },
      data: {
        sectionPlanJson: asJson(orderedSections),
        status: 'DRAFT',
        version: { increment: 1 },
        updatedByUserId: input.userId,
        frozenAt: null,
      },
    })

    await tx.grantSession.update({
      where: { id: input.grantSessionId },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.userId,
      },
    })

    if (input.sections) {
      for (const section of orderedSections) {
        await tx.grantSectionDraft.updateMany({
          where: {
            grantSessionId: input.grantSessionId,
            sectionKey: section.sectionKey,
          },
          data: {
            label: section.label,
            sectionOrder: section.order,
            wordBudget: section.wordBudget,
            characterLimit: section.characterLimit,
            purpose: section.purpose,
            reviewerIntent: section.reviewerIntent,
            mustCoverJson: asJson(section.mustCover),
            mustAvoidJson: asJson(section.mustAvoid),
            updatedByUserId: input.userId,
          },
        })
      }
    }
  })
}

export async function setGrantBlueprintStatus(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  status: 'DRAFT' | 'FROZEN'
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })
  if (!workspace?.blueprint) {
    throw new Error('Grant blueprint not found')
  }
  const blueprint = workspace.blueprint

  if (input.status === 'FROZEN') {
    const shadowWorkspace = await ensureGrantShadowWorkspace({
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      userId: input.userId,
    })

    if (!shadowWorkspace?.draftingSessionId) {
      throw new Error('Proposal foundation workspace could not be initialized')
    }

    const readiness = await blueprintService.getFreezeReadiness(shadowWorkspace.draftingSessionId)
    if (!readiness.ok) {
      throw new Error(readiness.issues.join('\n'))
    }

    await prisma.$transaction(async (tx) => {
      await tx.paperBlueprint.update({
        where: { sessionId: shadowWorkspace.draftingSessionId },
        data: {
          status: 'FROZEN',
          frozenAt: new Date(),
        },
      })

      await tx.grantBlueprint.update({
        where: { id: blueprint.id },
        data: {
          status: 'FROZEN',
          frozenAt: new Date(),
          updatedByUserId: input.userId,
        },
      })

      await tx.grantSession.update({
        where: { id: input.grantSessionId },
        data: {
          status: 'DRAFTING',
          updatedByUserId: input.userId,
        },
      })
    })

    return
  }

  await prisma.$transaction(async (tx) => {
    if (workspace.grantSession.draftingSessionId) {
      await tx.paperSection.updateMany({
        where: { sessionId: workspace.grantSession.draftingSessionId },
        data: { isStale: true },
      })

      await tx.paperBlueprint.updateMany({
        where: { sessionId: workspace.grantSession.draftingSessionId },
        data: {
          status: 'REVISION_PENDING',
          frozenAt: null,
          version: { increment: 1 },
        },
      })
    }

    await tx.grantBlueprint.update({
      where: { id: blueprint.id },
      data: {
        status: 'DRAFT',
        frozenAt: null,
        updatedByUserId: input.userId,
      },
    })

    await tx.grantSession.update({
      where: { id: input.grantSessionId },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.userId,
      },
    })
  })
}
