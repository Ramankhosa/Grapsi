import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

import { prisma } from '@/lib/prisma'
import { requireProjectGrantActor } from '@/lib/grants/access'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import { hasMeaningfulSectionContent, normalizeStringArray } from '@/lib/reviewer/content'

export const runtime = 'nodejs'

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function uniqueByText<T extends { sectionKey?: string; issue?: string; recommendation?: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const next: T[] = []
  for (const item of items) {
    const key = [
      normalizeKey(item.sectionKey),
      String(item.issue || '').trim().toLowerCase(),
      String(item.recommendation || '').trim().toLowerCase(),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

function normalizePriority(value: unknown): 'high' | 'medium' | 'low' {
  const priority = String(value || '').trim().toLowerCase()
  return priority === 'high' || priority === 'low' ? priority : 'medium'
}

function normalizeStatus(value: unknown): 'pending' | 'resolved' | 'ignored' {
  const status = String(value || '').trim().toLowerCase()
  return status === 'resolved' || status === 'ignored' ? status : 'pending'
}

function recommendationId(item: {
  reviewerSectionId?: string
  sectionKey?: string
  issue?: string
  recommendation?: string
  suggestedRemark?: string
}) {
  return crypto
    .createHash('sha1')
    .update([
      item.reviewerSectionId || '',
      normalizeKey(item.sectionKey),
      String(item.issue || '').trim().toLowerCase(),
      String(item.recommendation || '').trim().toLowerCase(),
      String(item.suggestedRemark || '').trim().toLowerCase(),
    ].join('|'))
    .digest('hex')
    .slice(0, 16)
}

function normalizeRecommendation(
  item: any,
  validKeys: Set<string>,
  fallbackSectionKey?: string | null,
  statusEntries?: Record<string, any>
) {
  const sectionKey = String(item?.sectionKey || fallbackSectionKey || '').trim()
  if (!sectionKey || !validKeys.has(normalizeKey(sectionKey))) return null

  const recommendation = String(item?.recommendation || item?.suggestedRemark || item?.feedback || item?.issue || '').trim()
  if (!recommendation) return null

  const normalized = {
    sectionKey,
    priority: normalizePriority(item?.priority),
    issue: String(item?.issue || item?.feedback || recommendation).trim(),
    recommendation,
    suggestedRemark: String(item?.suggestedRemark || recommendation).trim(),
    autoFixable: item?.autoFixable !== false,
    linkedRuleKeys: Array.isArray(item?.linkedRuleKeys) ? item.linkedRuleKeys.map(String).filter(Boolean) : [],
    reviewerSectionId: String(item?.reviewerSectionId || ''),
    reviewerSectionTitle: String(item?.reviewerSectionTitle || ''),
  }
  const id = recommendationId(normalized)
  const statusEntry = statusEntries?.[id] || {}

  return {
    id,
    ...normalized,
    actionable: normalized.autoFixable !== false && Boolean(normalized.suggestedRemark || normalized.recommendation),
    status: normalizeStatus(statusEntry.status),
    statusUpdatedAt: typeof statusEntry.updatedAt === 'string' ? statusEntry.updatedAt : null,
  }
}

function extractSectionRecommendations(section: any, appDraftKeys: Set<string>) {
  const review = section.ai_review_json && typeof section.ai_review_json === 'object'
    ? section.ai_review_json as any
    : {}
  const statusEntries = review.recommendation_statuses && typeof review.recommendation_statuses === 'object'
    ? review.recommendation_statuses as Record<string, any>
    : {}
  const links = Array.isArray(section.grant_section_links) ? section.grant_section_links : []
  const validSectionKeys: string[] = links
    .map((link: any) => String(link.grantSectionKey || '').trim())
    .filter((key: string) => appDraftKeys.has(normalizeKey(key)))
  const validKeys: Set<string> = new Set(validSectionKeys.map((key) => normalizeKey(key)))
  const fallbackKey = validSectionKeys.length === 1 ? validSectionKeys[0] : null

  const structured = Array.isArray(review.section_recommendations) ? review.section_recommendations : []
  const linkedFeedback = Array.isArray(review.linked_section_feedback) ? review.linked_section_feedback : []
  const suggestionFallback = fallbackKey
    ? normalizeStringArray(review.suggestions || review.recommendations).map((suggestion) => ({
        sectionKey: fallbackKey,
        priority: 'medium',
        issue: suggestion,
        recommendation: suggestion,
        suggestedRemark: suggestion,
        autoFixable: true,
        linkedRuleKeys: [],
      }))
    : []

  const recommendations = [
    ...structured,
    ...linkedFeedback,
    ...suggestionFallback,
  ]
    .map((item: any) => normalizeRecommendation({
      ...item,
      reviewerSectionId: section.id,
      reviewerSectionTitle: section.section_title,
    }, validKeys, fallbackKey, statusEntries))
    .filter(Boolean)

  return uniqueByText(recommendations as any[])
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  const workspace = await getGrantWorkspace({
    grantSessionId: grantId,
    tenantId: actor.tenantId,
  })

  if (!workspace || workspace.grantSession.projectId !== projectId || !workspace.blueprint) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  const appDraftKeys = new Set(
    (workspace.blueprint.sectionPlan || [])
      .filter((section) => isGrantSectionAutoDraftable(section))
      .map((section) => normalizeKey(section.sectionKey))
  )

  const call = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: grantId,
      reviewerMode: 'grant_integrated',
    } as any,
    include: {
      reviewer_sections: {
        where: { status: 'reviewed' },
        include: {
          grant_section_links: {
            where: { isActive: true },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: [{ last_reviewed_at: 'desc' }],
      },
    },
    orderBy: { updated_at: 'desc' },
  })

  if (!call) {
    return NextResponse.json({
      callId: null,
      recommendations: [],
      recommendationsBySection: {},
      supplementaryMaterials: [],
    })
  }

  const reviewedSections = (call.reviewer_sections || []).filter((section: any) =>
    hasMeaningfulSectionContent(section.user_input)
  )

  const recommendations = uniqueByText(reviewedSections.flatMap((section: any) =>
    extractSectionRecommendations(section, appDraftKeys)
  ))

  const recommendationsBySection = recommendations.reduce<Record<string, typeof recommendations>>((acc, item) => {
    const key = item.sectionKey
    acc[key] = acc[key] || []
    acc[key].push(item)
    return acc
  }, {})

  const supplementaryMaterials = Array.from(new Set(reviewedSections.flatMap((section: any) => {
    const review = section.ai_review_json && typeof section.ai_review_json === 'object'
      ? section.ai_review_json as any
      : {}
    return [
      ...normalizeStringArray(review.supplementary_materials),
      ...normalizeStringArray(review.non_scoring_reminders),
    ]
  }).map((item: string) => item.trim()).filter(Boolean)))

  return NextResponse.json({
    callId: call.id,
    recommendations,
    actionableRecommendations: recommendations.filter((item: any) => item.actionable),
    recommendationsBySection,
    supplementaryMaterials,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  const body = await request.json().catch(() => ({})) as {
    updates?: Array<{ id?: string; reviewerSectionId?: string; status?: string }>
  }
  const updates = Array.isArray(body.updates) ? body.updates : []
  if (updates.length === 0) {
    return NextResponse.json({ message: 'No recommendation status updates provided' }, { status: 400 })
  }

  const workspace = await getGrantWorkspace({
    grantSessionId: grantId,
    tenantId: actor.tenantId,
  })

  if (!workspace || workspace.grantSession.projectId !== projectId || !workspace.blueprint) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  const appDraftKeys = new Set(
    (workspace.blueprint.sectionPlan || [])
      .filter((section) => isGrantSectionAutoDraftable(section))
      .map((section) => normalizeKey(section.sectionKey))
  )

  const call = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: grantId,
      reviewerMode: 'grant_integrated',
    } as any,
    include: {
      reviewer_sections: {
        where: { status: 'reviewed' },
        include: {
          grant_section_links: {
            where: { isActive: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
    orderBy: { updated_at: 'desc' },
  })

  if (!call) {
    return NextResponse.json({ message: 'No reviewer call found' }, { status: 404 })
  }

  const sectionsById = new Map((call.reviewer_sections || []).map((section: any) => [section.id, section]))
  const validRecommendations = new Map<string, any>()
  for (const section of call.reviewer_sections || []) {
    for (const recommendation of extractSectionRecommendations(section, appDraftKeys)) {
      validRecommendations.set(recommendation.id, recommendation)
    }
  }

  const now = new Date().toISOString()
  const updatesBySection = new Map<string, Array<{ id: string; status: 'pending' | 'resolved' | 'ignored' }>>()

  for (const update of updates) {
    const id = String(update.id || '').trim()
    const status = normalizeStatus(update.status)
    const recommendation = validRecommendations.get(id)
    if (!id || !recommendation || !recommendation.actionable) continue
    if (update.reviewerSectionId && String(update.reviewerSectionId) !== recommendation.reviewerSectionId) continue

    const sectionUpdates = updatesBySection.get(recommendation.reviewerSectionId) || []
    sectionUpdates.push({ id, status })
    updatesBySection.set(recommendation.reviewerSectionId, sectionUpdates)
  }

  if (updatesBySection.size === 0) {
    return NextResponse.json({ message: 'No valid recommendation status updates found' }, { status: 400 })
  }

  for (const [sectionId, sectionUpdates] of updatesBySection.entries()) {
    const section = sectionsById.get(sectionId) as any
    if (!section) continue

    const review = section.ai_review_json && typeof section.ai_review_json === 'object'
      ? { ...(section.ai_review_json as any) }
      : {}
    const statuses = review.recommendation_statuses && typeof review.recommendation_statuses === 'object'
      ? { ...(review.recommendation_statuses as Record<string, any>) }
      : {}

    for (const update of sectionUpdates) {
      statuses[update.id] = {
        status: update.status,
        updatedAt: now,
      }
    }

    review.recommendation_statuses = statuses

    await prisma.reviewerSection.update({
      where: { id: sectionId },
      data: { ai_review_json: review } as any,
    })
  }

  return NextResponse.json({
    message: 'Recommendation statuses updated',
    updated: Array.from(updatesBySection.values()).flat().length,
  })
}
