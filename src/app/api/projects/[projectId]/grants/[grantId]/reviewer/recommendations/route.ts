import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireProjectGrantActor } from '@/lib/grants/access'
import { getGrantWorkspace } from '@/lib/grants/workspace'
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

function normalizeRecommendation(item: any, validKeys: Set<string>, fallbackSectionKey?: string | null) {
  const sectionKey = String(item?.sectionKey || fallbackSectionKey || '').trim()
  if (!sectionKey || !validKeys.has(normalizeKey(sectionKey))) return null

  const recommendation = String(item?.recommendation || item?.suggestedRemark || item?.feedback || item?.issue || '').trim()
  if (!recommendation) return null

  return {
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
}

function extractSectionRecommendations(section: any, appDraftKeys: Set<string>) {
  const review = section.ai_review_json && typeof section.ai_review_json === 'object'
    ? section.ai_review_json as any
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
    }, validKeys, fallbackKey))
    .filter(Boolean)

  return uniqueByText(recommendations as any[])
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read')
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
      .filter((section) => section.workflowMode === 'app_draft')
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
    recommendationsBySection,
    supplementaryMaterials,
  })
}
