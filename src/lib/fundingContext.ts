import type { Prisma } from '@prisma/client'

import prisma from './prisma'

type JsonRecord = Record<string, any>

export type FundingCallContext = {
  id: string | null
  source: 'linked_funding_call' | 'legacy_call_analysis' | 'none'
  isLinkedCall: boolean
  isLegacyFallback: boolean
  isPrivateDraft: boolean
  verificationStatus: string | null
  title: string
  agencyName: string
  description: string
  deadline: string
  funding: string
  budgetLimits: string
  projectDuration: string
  eligibility: string
  deliverables: string
  focusAreas: string[]
  disciplines: string[]
  fundingKinds: string[]
  officialUrls: string[]
  sourceUrl: string | null
  guidelineStatus: string | null
  templateStatus: string | null
  approvedGuidelineRevision: null
  approvedTemplate: {
    id: string
    currentRevisionNo: number
    grantTemplateJson: unknown
    compatibilityJson: unknown
  } | null
  warning: string | null
  legacyCallAnalysis: unknown | null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
}

function formatFunding(call: { amount_min?: number | null; amount_max?: number | null; currency?: string | null }) {
  const currency = call.currency ? `${call.currency} ` : ''
  if (call.amount_min != null && call.amount_max != null) {
    return `${currency}${call.amount_min} - ${currency}${call.amount_max}`.trim()
  }
  if (call.amount_min != null) return `${currency}${call.amount_min}`.trim()
  if (call.amount_max != null) return `${currency}${call.amount_max}`.trim()
  return ''
}

function formatDuration(call: {
  project_duration_text?: string | null
  project_duration_min_months?: number | null
  project_duration_max_months?: number | null
}) {
  if (call.project_duration_text) return call.project_duration_text
  if (call.project_duration_min_months != null && call.project_duration_max_months != null) {
    return `${call.project_duration_min_months} - ${call.project_duration_max_months} months`
  }
  if (call.project_duration_min_months != null) return `${call.project_duration_min_months} months`
  if (call.project_duration_max_months != null) return `${call.project_duration_max_months} months`
  return ''
}

export function getFundingCallOwnerUserId(metadata: Prisma.JsonValue | null | undefined) {
  const record = asRecord(metadata)
  return (
    record.owner_user_id ||
    record.imported_by_user_id ||
    record.user_import?.owner_user_id ||
    record.user_import?.user_id ||
    null
  ) as string | null
}

export function getFundingCallVerificationStatus(metadata: Prisma.JsonValue | null | undefined) {
  const record = asRecord(metadata)
  return (
    record.verification_status ||
    record.user_import?.verification_status ||
    record.admin_verification_status ||
    null
  ) as string | null
}

export async function canUserUseFundingCall(
  fundingCallId: string,
  user: { id: string; email?: string | null }
) {
  const call = await prisma.fundingCall.findUnique({
    where: { id: fundingCallId },
    select: {
      id: true,
      catalog_status: true,
      is_active: true,
      uploaded_by: true,
      metadata: true,
    },
  })

  if (!call) {
    return { ok: false as const, reason: 'Funding call not found' }
  }

  if (call.catalog_status === 'PUBLISHED' && call.is_active !== false) {
    return { ok: true as const, call }
  }

  const ownerUserId = getFundingCallOwnerUserId(call.metadata)
  const uploadedByCurrentUser = Boolean(
    user.email && call.uploaded_by && call.uploaded_by.toLowerCase() === user.email.toLowerCase()
  )

  if (call.catalog_status === 'DRAFT' && (ownerUserId === user.id || uploadedByCurrentUser)) {
    return { ok: true as const, call }
  }

  return { ok: false as const, reason: 'Funding call is not available for drafting' }
}

export function buildCallAnalysisCompatibleContext(context: FundingCallContext) {
  return {
    focus_areas: context.focusAreas,
    eligibility_conditions: context.eligibility ? [context.eligibility] : [],
    call_metadata: {
      title: context.title,
      deadline: context.deadline,
      funding: context.funding,
      eligibility: context.eligibility,
      deliverables: context.deliverables,
      agency_name: context.agencyName,
      description: context.description,
    },
    budget_limits: context.budgetLimits,
    project_duration_limits: context.projectDuration,
    deliverables: context.deliverables ? [context.deliverables] : [],
    call_title: context.title,
    thrust_areas: context.focusAreas,
    legacy: context.legacyCallAnalysis,
  }
}

export async function resolveProjectFundingContext(
  projectId: string,
  user: { id: string; email?: string | null; tenantId?: string | null }
): Promise<FundingCallContext> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...(user.tenantId ? { tenantId: user.tenantId } : {}),
    },
    select: {
      id: true,
      grantSessions: {
        where: {},
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: {
          fundingCall: {
            select: {
              id: true,
              catalog_status: true,
              is_active: true,
              agency_name: true,
              scheme_title: true,
              description: true,
              close_date: true,
              amount_min: true,
              amount_max: true,
              currency: true,
              project_duration_min_months: true,
              project_duration_max_months: true,
              project_duration_text: true,
              eligibility_text: true,
              expected_deliverables_text: true,
              official_urls: true,
              source_url: true,
              disciplines: true,
              funding_kinds: true,
              guideline_status: true,
              template_status: true,
              metadata: true,
              uploaded_by: true,
              active_template_id: true,
            },
          },
        },
      },
    },
  })

  if (!project) {
    throw new Error('Project not found')
  }

  const call = project.grantSessions[0]?.fundingCall
  if (!call) {
    return {
      id: null,
      source: 'none',
      isLinkedCall: false,
      isLegacyFallback: false,
      isPrivateDraft: false,
      verificationStatus: null,
      title: '',
      agencyName: '',
      description: '',
      deadline: '',
      funding: '',
      budgetLimits: '',
      projectDuration: '',
      eligibility: '',
      deliverables: '',
      focusAreas: [],
      disciplines: [],
      fundingKinds: [],
      officialUrls: [],
      sourceUrl: null,
      guidelineStatus: null,
      templateStatus: null,
      approvedGuidelineRevision: null,
      approvedTemplate: null,
      warning: 'No linked funding call is attached to this project yet.',
      legacyCallAnalysis: null,
    }
  }

  const visibility = await canUserUseFundingCall(call.id, user)
  if (!visibility.ok) {
    throw new Error(visibility.reason)
  }

  const [guidelineRecord, templateRecord] = await Promise.all([
    prisma.fundingCallGuideline.findUnique({
      where: { fundingCallId: call.id },
      select: {
        id: true,
      },
    }),
    prisma.fundingCallTemplate.findUnique({
      where: { fundingCallId: call.id },
      select: {
        id: true,
        status: true,
        current_revision_no: true,
        grant_template_json: true,
        compatibility_json: true,
      },
    }),
  ])

  const [approvedGuidelineRevision, approvedTemplateRevision] = await Promise.all([
    guidelineRecord
      ? prisma.fundingCallGuidelineRevision.findFirst({
          where: {
            OR: [
              { guidelineId: guidelineRecord.id, status: 'APPROVED' },
              { guidelineId: guidelineRecord.id, approved_state: 'approved' },
              { guideline_id: guidelineRecord.id, status: 'APPROVED' },
              { guideline_id: guidelineRecord.id, approved_state: 'approved' },
            ],
          },
          orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
          select: { id: true },
        })
      : Promise.resolve(null),
    templateRecord && templateRecord.status !== 'approved'
      ? prisma.fundingCallTemplateRevision.findFirst({
          where: {
            OR: [
              { templateId: templateRecord.id, status: 'APPROVED' },
              { templateId: templateRecord.id, approved_state: 'approved' },
              { template_id: templateRecord.id, status: 'APPROVED' },
              { template_id: templateRecord.id, approved_state: 'approved' },
            ],
          },
          orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
          select: {
            version: true,
            revision_no: true,
            grant_template_json: true,
            extractedPayload: true,
            compatibility_json: true,
            summaryJson: true,
          },
        })
      : Promise.resolve(null),
  ])

  const activeTemplate =
    templateRecord?.status === 'approved'
      ? templateRecord
      : templateRecord && approvedTemplateRevision
        ? {
            id: templateRecord.id,
            current_revision_no:
              approvedTemplateRevision.version ||
              approvedTemplateRevision.revision_no ||
              templateRecord.current_revision_no,
            grant_template_json:
              approvedTemplateRevision.grant_template_json ?? approvedTemplateRevision.extractedPayload,
            compatibility_json:
              approvedTemplateRevision.compatibility_json ?? approvedTemplateRevision.summaryJson ?? null,
          }
        : null

  const isPrivateDraft = call.catalog_status === 'DRAFT' || call.is_active === false
  const verificationStatus = getFundingCallVerificationStatus(call.metadata)

  return {
    id: call.id,
    source: 'linked_funding_call',
    isLinkedCall: true,
    isLegacyFallback: false,
    isPrivateDraft,
    verificationStatus,
    title: call.scheme_title || 'Unnamed Grant Call',
    agencyName: call.agency_name || '',
    description: call.description || '',
    deadline: formatDate(call.close_date),
    funding: formatFunding(call),
    budgetLimits: formatFunding(call),
    projectDuration: formatDuration(call),
    eligibility: call.eligibility_text || '',
    deliverables: call.expected_deliverables_text || '',
    focusAreas: [...(call.disciplines || []), ...(call.funding_kinds || [])].filter(
      (value, index, array) => value && array.indexOf(value) === index
    ),
    disciplines: call.disciplines || [],
    fundingKinds: call.funding_kinds || [],
    officialUrls: call.official_urls || [],
    sourceUrl: call.source_url || null,
    guidelineStatus: approvedGuidelineRevision ? 'approved' : call.guideline_status || null,
    templateStatus: activeTemplate ? 'approved' : call.template_status || null,
    approvedGuidelineRevision: null,
    approvedTemplate: activeTemplate
      ? {
          id: activeTemplate.id,
          currentRevisionNo: activeTemplate.current_revision_no,
          grantTemplateJson: activeTemplate.grant_template_json,
          compatibilityJson: activeTemplate.compatibility_json,
        }
      : null,
    warning: isPrivateDraft || verificationStatus === 'pending_admin_verification'
      ? 'This imported funding call is pending admin verification.'
      : null,
    legacyCallAnalysis: null,
  }
}
