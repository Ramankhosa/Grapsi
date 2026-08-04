import crypto from 'crypto'

import { Prisma } from '@/lib/prisma-generated'
import prisma from '@/lib/prisma'
import { budgetStructuredDataHasMeaningfulRows } from '@/lib/grants/budgetTemplate'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import { isGrantBibliographySection, isGrantSectionAiGenerated } from '@/lib/grants/workflowMode'
import { hasMeaningfulSectionContent } from '@/lib/reviewer/content'
import {
  BUCKET_LABELS,
  bucketFromIntent,
  bucketFromText,
  dedupeRuleText as dedupe,
  normalizeBucketKey,
  resolveBucketKey,
} from '@/lib/reviewer/buckets'
import { normalizeManualRubric, type ReviewerManualRubric } from '@/lib/reviewer/manualRubric'
import {
  buildReviewerContextFromStoredCall,
  type ReviewerCallContext,
  type ReviewerTemplateSectionRule,
} from '@/lib/reviewer/callContext'
import type { GrantBlueprintPlanSection } from '@/types/grant'

type JsonRecord = Record<string, unknown>

export type ReviewerModeValue = 'standalone' | 'grant_integrated'

export { normalizeManualRubric }
export type { ReviewerManualRubric, ReviewerTemplateSectionRule }

/** @deprecated Use `ReviewerCallContext`, which also covers URL-sourced calls. */
export type ReviewerTemplateContext = ReviewerCallContext

export interface ReviewerSectionMapping {
  bucketKey: string
  bucketLabel: string
  aggregateContent: string
  sourceHash: string
  linkedSections: Array<{
    grantSectionDraftId: string | null
    sectionKey: string
    label: string
    order: number
    sourceContentHash: string
    bucketKey: string
    workflowMode?: string | null
    reviewerIntent?: string | null
    mustCover?: string[]
    mustAvoid?: string[]
    grantSemantic?: string | null
    templateIntent?: string | null
    grantRuleProfile?: unknown
    grantTemplateGuidance?: unknown
    grantSectionComplianceContract?: unknown
  }>
}

export interface IntegratedReviewerState {
  call: any | null
  sections: any[]
  mappings: ReviewerSectionMapping[]
  diagnostics: {
    draftedSectionCount: number
    mappedSectionCount: number
    staleSectionCount: number
    rulesSource: 'template_manual'
  }
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Backwards-compatible wrapper over the shared stored-call context builder.
 * Kept flat (context fields spread alongside `templateSnapshot`) because the
 * grant-integrated reviewer route and its tests consume it that way.
 */
export async function buildReviewerContextFromFundingCall(input: {
  fundingCallId: string
  manualRubric?: unknown
}): Promise<ReviewerCallContext & { templateSnapshot: JsonRecord }> {
  const { context, templateSnapshot } = await buildReviewerContextFromStoredCall(input)
  return { ...context, templateSnapshot }
}

function serializeGrantDraft(section: any, sectionType?: string): string {
  const content = asString(section?.content)
  if (hasMeaningfulSectionContent(content)) return content

  const responses = Array.isArray(section?.structuredResponses) ? section.structuredResponses : []
  const serialized = responses
    .map((response: any) => response?.responseJson)
    .filter((payload: unknown) => {
      if (!payload) return false
      if (sectionType === 'budget_rows') {
        return budgetStructuredDataHasMeaningfulRows(payload)
      }
      return true
    })
    .map((payload: unknown) => {
      try {
        return JSON.stringify(payload, null, 2)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')

  return hasMeaningfulSectionContent(serialized) ? serialized.trim() : ''
}

function resolvePlanSection(section: any, sectionPlanByKey: Map<string, GrantBlueprintPlanSection>) {
  return sectionPlanByKey.get(String(section?.sectionKey || '')) || null
}

function isReviewerMappableGrantSection(input: {
  sectionKey?: string | null
  sectionType: string
  workflowMode: unknown
}): boolean {
  return !isGrantBibliographySection(input.sectionKey) && isGrantSectionAiGenerated(input)
}

export function buildReviewerSectionMappings(input: {
  sectionDrafts: any[]
  sectionPlan: GrantBlueprintPlanSection[]
  manualRubric?: unknown
}): ReviewerSectionMapping[] {
  const manualRubric = normalizeManualRubric(input.manualRubric)
  const sectionPlanByKey = new Map(input.sectionPlan.map((section) => [section.sectionKey, section]))
  const groups = new Map<string, ReviewerSectionMapping>()

  const orderedDrafts = [...input.sectionDrafts].sort((left, right) =>
    Number(left?.sectionOrder ?? left?.order ?? 0) - Number(right?.sectionOrder ?? right?.order ?? 0)
  )

  for (const draft of orderedDrafts) {
    const sectionKey = asString(draft?.sectionKey)
    if (!sectionKey) continue

    const planSection = resolvePlanSection(draft, sectionPlanByKey)
    const sectionType = asString(planSection?.sectionType) || asString(draft?.sectionType)
    const workflowMode = asString(planSection?.workflowMode) || asString(draft?.workflowMode)
    if (!isReviewerMappableGrantSection({
      sectionKey,
      sectionType,
      workflowMode,
    })) continue

    const content = serializeGrantDraft(draft, sectionType)
    if (!hasMeaningfulSectionContent(content)) continue

    const overrideBucket = manualRubric.mappingOverrides[sectionKey]
    const bucketKey = overrideBucket || bucketFromIntent(
      planSection?.grantSemantic || planSection?.templateIntent || draft?.grantSemantic || draft?.templateIntent,
      `${draft?.label || ''} ${planSection?.label || ''} ${draft?.sectionType || ''}`
    )
    const bucketLabel = BUCKET_LABELS[bucketKey] || BUCKET_LABELS.other
    const order = Number(draft?.sectionOrder ?? planSection?.order ?? 0)
    const sourceContentHash = sha256({ sectionKey, content })

    let group = groups.get(bucketKey)
    if (!group) {
      group = {
        bucketKey,
        bucketLabel,
        aggregateContent: '',
        sourceHash: '',
        linkedSections: [],
      }
      groups.set(bucketKey, group)
    }

    group.linkedSections.push({
      grantSectionDraftId: asString(draft?.id) || null,
      sectionKey,
      label: asString(draft?.label) || asString(planSection?.label) || sectionKey,
      order,
      sourceContentHash,
      bucketKey,
      workflowMode,
      reviewerIntent: planSection?.reviewerIntent || null,
      mustCover: Array.isArray(planSection?.mustCover) ? planSection.mustCover : [],
      mustAvoid: Array.isArray(planSection?.mustAvoid) ? planSection.mustAvoid : [],
      grantSemantic: planSection?.grantSemantic || null,
      templateIntent: planSection?.templateIntent || null,
      grantRuleProfile: planSection?.grantRuleProfile || null,
      grantTemplateGuidance: planSection?.grantTemplateGuidance || null,
      grantSectionComplianceContract: planSection?.grantSectionComplianceContract || null,
    })
  }

  for (const group of groups.values()) {
    group.linkedSections.sort((left, right) => left.order - right.order)
    group.aggregateContent = group.linkedSections
      .map((link) => {
        const draft = orderedDrafts.find((item) => asString(item?.sectionKey) === link.sectionKey)
        const planSection = draft ? resolvePlanSection(draft, sectionPlanByKey) : null
        const sectionType = asString(planSection?.sectionType) || asString(draft?.sectionType)
        const content = serializeGrantDraft(draft, sectionType)
        return `## ${link.label} [${link.sectionKey}]\n${content}`
      })
      .join('\n\n')
    group.sourceHash = sha256({
      bucketKey: group.bucketKey,
      links: group.linkedSections.map((link) => ({
        sectionKey: link.sectionKey,
        hash: link.sourceContentHash,
      })),
    })
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftOrder = left.linkedSections[0]?.order ?? 9999
    const rightOrder = right.linkedSections[0]?.order ?? 9999
    return leftOrder - rightOrder
  })
}

function reviewerCallInputData(
  context: ReviewerCallContext,
  mode: ReviewerModeValue,
  extra?: JsonRecord
): string {
  return JSON.stringify({
    source: context.rules_source === 'url_extracted' ? 'url_extracted_reviewer' : 'template_backed_reviewer',
    mode,
    rulesSource: context.rules_source,
    fundingCallId: context.funding_call_id,
    templateId: context.template_id,
    sourceTemplateRevisionId: context.source_template_revision_id,
    sourceUrls: context.source_urls,
    sourceHash: context.extraction?.sourceHash || null,
    ...extra,
  })
}

function asInputJson(value: unknown) {
  return value as Prisma.InputJsonValue
}

const CALL_INPUT_TYPE_BY_RULES_SOURCE: Record<ReviewerCallContext['rules_source'], 'template' | 'url'> = {
  template_manual: 'template',
  guideline_manual: 'template',
  call_fields: 'template',
  url_extracted: 'url',
}

/**
 * Create a standalone reviewer workspace from an already-built context.
 *
 * Source-agnostic: the context may come from an approved template, a stored
 * call's guideline pack or bare fields, or an LLM extraction of the call URL.
 * Seeded sections always follow the context's own bucket structure, so the
 * reviewer workspace mirrors what the call actually asks for.
 */
export async function createReviewerCallFromContext(input: {
  userId: string
  tenantId?: string | null
  context: ReviewerCallContext
  templateSnapshot?: JsonRecord | null
  projectTitle: string
  seedSections?: boolean
  rawTextBackup?: string | null
}) {
  const { context } = input

  return prisma.$transaction(async (tx) => {
    const call = await tx.reviewerCall.create({
      data: {
        user_id: input.userId,
        tenantId: input.tenantId || null,
        fundingCallId: context.funding_call_id,
        reviewerMode: 'standalone',
        templateSnapshotJson: asInputJson(input.templateSnapshot ?? {}),
        manualRubricJson: asInputJson(context.manual_rubric),
        rulesSource: context.rules_source,
        sourceTemplateRevisionId: context.source_template_revision_id,
        project_title: input.projectTitle,
        agency_name: context.agency_name,
        call_input_type: CALL_INPUT_TYPE_BY_RULES_SOURCE[context.rules_source] || 'template',
        call_input_data: reviewerCallInputData(context, 'standalone'),
        parsed_json: asInputJson(context),
        raw_text_backup: input.rawTextBackup || null,
        review_status: 'parsed',
        LLM_model_used: context.extraction?.model || 'template',
      } as any,
    })

    if (input.seedSections) {
      const buckets = new Map<string, ReviewerTemplateSectionRule[]>()
      for (const rule of context.template_sections) {
        // Attachment/submission buckets are reminders, not scored narrative, so
        // they are never seeded as sections the user has to paste text into.
        if (rule.bucketKey === 'attachments_submission') continue
        const existing = buckets.get(rule.bucketKey) || []
        existing.push(rule)
        buckets.set(rule.bucketKey, existing)
      }

      for (const [bucketKey, rules] of buckets.entries()) {
        await tx.reviewerSection.create({
          data: {
            call_id: call.id,
            section_title: BUCKET_LABELS[bucketKey] || BUCKET_LABELS.other,
            user_input: '',
            ai_review_json: {},
            status: 'draft',
            reviewerBucketKey: bucketKey,
            mappingJson: asInputJson({
              source: context.rules_source === 'url_extracted' ? 'url_seed' : 'template_seed',
              bucketKey,
              templateRules: rules.map((rule) => rule.key),
            }),
          } as any,
        })
      }
    }

    return call
  })
}

export async function createStandaloneReviewerCall(input: {
  userId: string
  tenantId?: string | null
  fundingCallId: string
  projectTitle: string
  manualRubric?: unknown
  seedSections?: boolean
}) {
  const { context, templateSnapshot } = await buildReviewerContextFromStoredCall({
    fundingCallId: input.fundingCallId,
    manualRubric: input.manualRubric,
  })

  return createReviewerCallFromContext({
    userId: input.userId,
    tenantId: input.tenantId,
    context,
    templateSnapshot,
    projectTitle: input.projectTitle,
    seedSections: input.seedSections,
  })
}

async function replaceGrantLinks(tx: any, input: {
  reviewerCallId: string
  reviewerSectionId: string
  grantSessionId: string
  mapping: ReviewerSectionMapping
}) {
  for (const link of input.mapping.linkedSections) {
    await tx.reviewerSectionGrantLink.updateMany({
      where: {
        grantSessionId: input.grantSessionId,
        grantSectionKey: link.sectionKey,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    })
  }

  for (const link of input.mapping.linkedSections) {
    await tx.reviewerSectionGrantLink.create({
      data: {
        reviewerCallId: input.reviewerCallId,
        reviewerSectionId: input.reviewerSectionId,
        grantSessionId: input.grantSessionId,
        grantSectionDraftId: link.grantSectionDraftId,
        grantSectionKey: link.sectionKey,
        grantSectionLabel: link.label,
        sourceContentHash: link.sourceContentHash,
        order: link.order,
        isActive: true,
      },
    })
  }
}

export async function refreshIntegratedReviewerCall(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  manualRubric?: unknown
  createRevisions?: boolean
}): Promise<IntegratedReviewerState> {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })

  if (!workspace?.grantSession || !workspace.blueprint) {
    throw new Error('Grant workspace not found')
  }
  if (workspace.blueprint.status !== 'FROZEN') {
    throw new Error('Freeze the grant blueprint before preparing reviewer mappings.')
  }

  const existingCall = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: input.grantSessionId,
      reviewerMode: 'grant_integrated',
    } as any,
    orderBy: { updated_at: 'desc' },
  })

  const existingRubric = input.manualRubric ?? existingCall?.manualRubricJson ?? {}
  const context = await buildReviewerContextFromFundingCall({
    fundingCallId: workspace.grantSession.fundingCallId,
    manualRubric: existingRubric,
  })
  const mappings = buildReviewerSectionMappings({
    sectionDrafts: workspace.blueprint.sectionDrafts,
    sectionPlan: workspace.blueprint.sectionPlan,
    manualRubric: context.manual_rubric,
  })

  const draftedSectionCount = mappings.reduce((count, mapping) => count + mapping.linkedSections.length, 0)
  if (draftedSectionCount === 0) {
    throw new Error('Draft at least one mapped grant section before preparing reviewer mappings.')
  }

  const call = await prisma.$transaction(async (tx) => {
    const reviewerCall = existingCall
      ? await tx.reviewerCall.update({
          where: { id: existingCall.id },
          data: {
            project_title: workspace.grantSession.project?.name || existingCall.project_title,
            agency_name: context.agency_name,
            fundingCallId: workspace.grantSession.fundingCallId,
            templateSnapshotJson: asInputJson(context.templateSnapshot),
            manualRubricJson: asInputJson(context.manual_rubric),
            rulesSource: 'template_manual',
            sourceTemplateRevisionId: context.source_template_revision_id,
            call_input_type: 'template',
            call_input_data: reviewerCallInputData(context, 'grant_integrated'),
            parsed_json: asInputJson(context),
            review_status: 'parsed',
          } as any,
        })
      : await tx.reviewerCall.create({
          data: {
            user_id: input.userId,
            tenantId: input.tenantId,
            projectId: workspace.grantSession.projectId,
            grantSessionId: input.grantSessionId,
            fundingCallId: workspace.grantSession.fundingCallId,
            reviewerMode: 'grant_integrated',
            templateSnapshotJson: asInputJson(context.templateSnapshot),
            manualRubricJson: asInputJson(context.manual_rubric),
            rulesSource: 'template_manual',
            sourceTemplateRevisionId: context.source_template_revision_id,
            project_title: workspace.grantSession.project?.name || 'Grant proposal',
            agency_name: context.agency_name,
            call_input_type: 'template',
            call_input_data: reviewerCallInputData(context, 'grant_integrated'),
            parsed_json: asInputJson(context),
            review_status: 'parsed',
            LLM_model_used: 'template',
          } as any,
        })

    const existingSections = await tx.reviewerSection.findMany({
      where: { call_id: reviewerCall.id },
      orderBy: [{ version: 'desc' }, { last_reviewed_at: 'desc' }],
    })
    // Several sections can legitimately share a bucket (Introduction and
    // Literature Review are both `problem_need`), so keep them all and let the
    // lookup below prefer the one actually named after this mapping. Binding to
    // whichever row happened to sort first silently rewrote the wrong section.
    const sectionsByBucket = new Map<string, any[]>()
    for (const section of existingSections) {
      const bucketKey = resolveBucketKey(section)
      const bucket = sectionsByBucket.get(bucketKey)
      if (bucket) bucket.push(section)
      else sectionsByBucket.set(bucketKey, [section])
    }

    const pickExistingSection = (bucketKey: string, label: string) => {
      const candidates = sectionsByBucket.get(bucketKey)
      if (!candidates || candidates.length === 0) return undefined
      const wanted = String(label || '').trim().toLowerCase()
      return (
        candidates.find((section) => String(section.section_title || '').trim().toLowerCase() === wanted)
        || candidates[0]
      )
    }

    for (const mapping of mappings) {
      const existingSection = pickExistingSection(mapping.bucketKey, mapping.bucketLabel)
      const mappingJson = {
        source: 'grant_section_mapping',
        bucketKey: mapping.bucketKey,
      linkedSections: mapping.linkedSections,
      workflowMode: 'app_draft',
      generatedAt: new Date().toISOString(),
    }

      let targetSection = existingSection
      const hashChanged = existingSection?.sourceHash && existingSection.sourceHash !== mapping.sourceHash

      if (!existingSection) {
        targetSection = await tx.reviewerSection.create({
          data: {
            call_id: reviewerCall.id,
            section_title: mapping.bucketLabel,
            user_input: mapping.aggregateContent,
            ai_review_json: {},
            status: 'draft',
            reviewerBucketKey: mapping.bucketKey,
            sourceHash: mapping.sourceHash,
            sourceStale: false,
            mappingJson: asInputJson(mappingJson),
          } as any,
        })
      } else if (existingSection.status === 'reviewed' && hashChanged) {
        await tx.reviewerSection.update({
          where: { id: existingSection.id },
          data: {
            sourceStale: true,
            mappingJson: asInputJson({
              ...mappingJson,
              staleReason: 'mapped_source_changed',
              nextSourceHash: mapping.sourceHash,
            }),
          } as any,
        })

        if (input.createRevisions) {
          targetSection = await tx.reviewerSection.create({
            data: {
              call_id: reviewerCall.id,
              section_title: existingSection.section_title,
              user_input: mapping.aggregateContent,
              ai_review_json: {},
              status: 'draft',
              is_revision: true,
              previous_section_id: existingSection.id,
              version: Number(existingSection.version || 1) + 1,
              reviewerBucketKey: mapping.bucketKey,
              sourceHash: mapping.sourceHash,
              sourceStale: false,
              mappingJson: asInputJson(mappingJson),
            } as any,
          })
        }
      } else if (existingSection.status !== 'reviewed' || !hashChanged) {
        targetSection = await tx.reviewerSection.update({
          where: { id: existingSection.id },
          data: {
            section_title: mapping.bucketLabel,
            user_input: existingSection.status === 'reviewed' ? existingSection.user_input : mapping.aggregateContent,
            reviewerBucketKey: mapping.bucketKey,
            sourceHash: mapping.sourceHash,
            sourceStale: false,
            mappingJson: asInputJson(mappingJson),
          } as any,
        })
      }

      await replaceGrantLinks(tx, {
        reviewerCallId: reviewerCall.id,
        reviewerSectionId: targetSection.id,
        grantSessionId: input.grantSessionId,
        mapping,
      })
    }

    return reviewerCall
  })

  return getIntegratedReviewerState({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  }).then((state) => ({
    ...state,
    call: state.call || call,
    mappings,
    diagnostics: {
      ...state.diagnostics,
      draftedSectionCount,
      mappedSectionCount: mappings.length,
    },
  }))
}

export async function getIntegratedReviewerState(input: {
  grantSessionId: string
  tenantId: string
}): Promise<IntegratedReviewerState> {
  const call = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      reviewerMode: 'grant_integrated',
    } as any,
    orderBy: { updated_at: 'desc' },
  })

  if (!call) {
    return {
      call: null,
      sections: [],
      mappings: [],
      diagnostics: {
        draftedSectionCount: 0,
        mappedSectionCount: 0,
        staleSectionCount: 0,
        rulesSource: 'template_manual',
      },
    }
  }

  const sections = await prisma.reviewerSection.findMany({
    where: { call_id: call.id },
    include: {
      grant_section_links: {
        where: { isActive: true },
        orderBy: { order: 'asc' },
      },
    } as any,
    orderBy: [{ reviewerBucketKey: 'asc' }, { version: 'desc' }],
  } as any)

  const mappings = sections
    .filter((section: any) => Array.isArray(section.grant_section_links) && section.grant_section_links.length > 0)
    .map((section: any) => ({
      bucketKey: section.reviewerBucketKey || bucketFromText(section.section_title),
      bucketLabel: section.section_title,
      aggregateContent: section.user_input || '',
      sourceHash: section.sourceHash || '',
      linkedSections: section.grant_section_links.map((link: any) => ({
        grantSectionDraftId: link.grantSectionDraftId || null,
        sectionKey: link.grantSectionKey,
        label: link.grantSectionLabel,
        order: link.order,
        sourceContentHash: link.sourceContentHash,
        bucketKey: section.reviewerBucketKey || bucketFromText(section.section_title),
      })),
    }))

  return {
    call,
    sections,
    mappings,
    diagnostics: {
      draftedSectionCount: mappings.reduce((count, mapping) => count + mapping.linkedSections.length, 0),
      mappedSectionCount: mappings.length,
      staleSectionCount: sections.filter((section: any) => section.sourceStale).length,
      rulesSource: 'template_manual',
    },
  }
}

export async function applyManualGrantReviewerMapping(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  assignments: Array<{ grantSectionKey: string; reviewerBucketKey: string }>
}) {
  const current = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      reviewerMode: 'grant_integrated',
    } as any,
    orderBy: { updated_at: 'desc' },
  })

  const manualRubric = normalizeManualRubric(current?.manualRubricJson || {})
  for (const assignment of input.assignments) {
    const sectionKey = asString(assignment.grantSectionKey)
    const bucketKey = normalizeBucketKey(asString(assignment.reviewerBucketKey))
    if (sectionKey && bucketKey) {
      manualRubric.mappingOverrides[sectionKey] = bucketKey
    }
  }

  if (current) {
    await prisma.reviewerCall.update({
      where: { id: current.id },
      data: { manualRubricJson: asInputJson(manualRubric) } as any,
    })
  }

  return refreshIntegratedReviewerCall({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    manualRubric,
    createRevisions: true,
  })
}

export { BUCKET_LABELS as REVIEWER_BUCKET_LABELS }
