import { NextRequest, NextResponse } from 'next/server'
import {
  isAccessError,
  requireTenantUser,
} from '@/lib/auth/tenantAccess'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Cross-project review & report data for quality auditors.
 *
 * Filters: type, projectId, userId, dateFrom, dateTo, status
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!context.isQualityAuditor) {
    return NextResponse.json(
      { error: 'You do not have permission to access the quality audit dashboard.' },
      { status: 403 },
    )
  }

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') // grant_ai_review | reviewer_report | novelty_search | all
  const projectId = searchParams.get('projectId')
  const userId = searchParams.get('userId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const status = searchParams.get('status')
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const skip = (page - 1) * limit

  const tenantId = context.tenantId
  const effectiveType = type || 'all'

  try {
    const [items, summary, facets] = await Promise.all([
      fetchReviewItems({
        tenantId,
        type: effectiveType,
        projectId,
        userId,
        dateFrom,
        dateTo,
        status,
        skip,
        limit,
      }),
      fetchSummary(tenantId),
      fetchFacets(tenantId),
    ])

    return NextResponse.json({ items, summary, facets, page, limit })
  } catch (error) {
    console.error('Quality audit query failed:', error)
    return NextResponse.json({ error: 'Could not load audit data.' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchParams {
  tenantId: string
  type: string
  projectId: string | null
  userId: string | null
  dateFrom: string | null
  dateTo: string | null
  status: string | null
  skip: number
  limit: number
}

async function fetchReviewItems(p: FetchParams) {
  const results: any[] = []

  const dateFilter = (field: string) => {
    const clauses: any = {}
    if (p.dateFrom) clauses.gte = new Date(p.dateFrom)
    if (p.dateTo) clauses.lte = new Date(p.dateTo)
    return Object.keys(clauses).length ? { [field]: clauses } : {}
  }

  // --- Grant AI reviews (GrantStructuredFieldResponse where fieldKey = 'aiReviewReport') ---
  if (p.type === 'all' || p.type === 'grant_ai_review') {
    const where: any = {
      tenantId: p.tenantId,
      fieldKey: 'aiReviewReport',
      ...(p.projectId && { projectId: p.projectId }),
      ...(p.userId && { updatedByUserId: p.userId }),
      ...dateFilter('createdAt'),
    }

    const rows: any[] = await (prisma.grantStructuredFieldResponse as any).findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        grantSession: {
          select: {
            id: true,
            status: true,
            fundingCall: { select: { id: true, title: true, agencyName: true } },
            createdByUserId: true,
          },
        },
        sectionDraft: { select: { id: true, sectionKey: true, label: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: p.limit,
      skip: p.skip,
    })

    for (const r of rows) {
      const resp = r.responseJson as any
      results.push({
        id: r.id,
        type: 'grant_ai_review',
        projectId: r.projectId,
        projectTitle: r.project?.name ?? null,
        userId: r.updatedByUserId,
        sessionId: r.grantSessionId,
        sessionStatus: r.grantSession?.status ?? null,
        fundingCallTitle: r.grantSession?.fundingCall?.title ?? null,
        agencyName: r.grantSession?.fundingCall?.agencyName ?? null,
        sectionKey: r.sectionDraft?.sectionKey ?? r.sectionKey,
        sectionLabel: r.sectionDraft?.label ?? r.sectionKey,
        score: resp?.overallScore ?? resp?.score ?? null,
        issueCount: resp?.totalIssues ?? resp?.issues?.length ?? 0,
        errors: resp?.errors ?? 0,
        warnings: resp?.warnings ?? 0,
        suggestions: resp?.suggestions ?? 0,
        recommendation: resp?.recommendation ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })
    }
  }

  // --- Reviewer reports (ReviewerCall) ---
  if (p.type === 'all' || p.type === 'reviewer_report') {
    const where: any = {
      tenantId: p.tenantId,
      ...(p.projectId && { projectId: p.projectId }),
      ...(p.userId && { user_id: p.userId }),
      ...dateFilter('created_at'),
      ...(p.status && { review_status: p.status }),
    }

    const rows: any[] = await (prisma.reviewerCall as any).findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true } },
        reviewer_sections: {
          select: { id: true, section_title: true, status: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: p.limit,
      skip: p.skip,
    })

    for (const r of rows) {
      const overall = r.overall_review_json as any
      const sectionCount = r.reviewer_sections?.length ?? 0
      const reviewedCount = (r.reviewer_sections ?? []).filter(
        (s: any) => s.status === 'reviewed' || s.status === 'revised',
      ).length

      results.push({
        id: r.id,
        type: 'reviewer_report',
        projectId: r.projectId,
        projectTitle: r.project_title,
        userId: r.user_id,
        userName: r.user?.name ?? r.user?.email ?? null,
        agencyName: r.agency_name,
        reviewStatus: r.review_status,
        finalReviewStatus: r.final_review_status,
        sectionCount,
        reviewedCount,
        overallScore: overall?.overallScore ?? overall?.score ?? null,
        overallRecommendation: overall?.recommendation ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })
    }
  }

  // --- Novelty searches (NoveltySearchRun via Project) ---
  if (p.type === 'all' || p.type === 'novelty_search') {
    const projectFilter: any = { tenantId: p.tenantId }
    if (p.projectId) projectFilter.id = p.projectId

    const where: any = {
      project: projectFilter,
      ...(p.userId && { userId: p.userId }),
      ...dateFilter('createdAt'),
      ...(p.status && { status: p.status }),
    }

    const rows: any[] = await (prisma.noveltySearchRun as any).findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: p.limit,
      skip: p.skip,
    })

    for (const r of rows) {
      results.push({
        id: r.id,
        type: 'novelty_search',
        projectId: r.project?.id ?? r.projectId ?? null,
        projectTitle: r.project?.name ?? r.title,
        userId: r.userId,
        userName: r.user?.name ?? r.user?.email ?? null,
        title: r.title,
        status: r.status,
        currentStage: r.currentStage,
        jurisdiction: r.jurisdiction,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })
    }
  }

  // Sort combined results by date descending
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return results.slice(0, p.limit)
}

async function fetchSummary(tenantId: string) {
  const [aiReviewCount, reviewerCount, noveltyCount] = await Promise.all([
    prisma.grantStructuredFieldResponse.count({
      where: { tenantId, fieldKey: 'aiReviewReport' },
    }),
    prisma.reviewerCall.count({ where: { tenantId } }),
    (prisma.noveltySearchRun as any).count({
      where: { project: { tenantId } },
    }),
  ])

  return {
    totalReviews: aiReviewCount + reviewerCount + noveltyCount,
    aiReviews: aiReviewCount,
    reviewerReports: reviewerCount,
    noveltySearches: noveltyCount,
  }
}

async function fetchFacets(tenantId: string) {
  const [projects, users] = await Promise.all([
    prisma.project.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return {
    projects: projects.map((p) => ({ id: p.id, title: p.name })),
    users,
  }
}
