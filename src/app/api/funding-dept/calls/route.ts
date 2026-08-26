import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { canReviewDept } from '@/lib/fundingDept/shared'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic = 'force-dynamic'

/**
 * The per-call funnel: EVERY call the department can act on, each with its
 * matched / assigned / accepted / submitted / awarded counts.
 *
 * This is the view the assignment-based reports cannot give — those roll up
 * FROM call_assignments, so a call nobody has touched is invisible in exactly
 * the report that should expose it. Here the call list is the spine and the
 * alert/assignment counts hang off it, so "published three weeks ago, matched
 * twelve people, assigned nobody" finally reads as the red flag it is.
 *
 * Audience: tenant admins and the funding-department head — the same pair the
 * membership review endpoints trust (`canReviewDept`).
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!canReviewDept(context, context.scope)) {
    return NextResponse.json(
      { error: 'The call funnel is available to administrators and the department head.' },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()
  const state = (searchParams.get('state') || 'all').trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  const now = new Date()
  // Drafts are part of the desk's work-in-progress, so the funnel shows them
  // (this endpoint is admin/head-only; the faculty-facing lists still hide them).
  const visible = visibleFundingCallWhere(context.tenantId, { includeTenantDrafts: true })

  const draftPredicate: Prisma.FundingCallWhereInput = {
    visibility: 'TENANT_PRIVATE',
    tenantId: context.tenantId,
    NOT: { OR: [{ status: 'PUBLISHED' }, { catalog_status: 'PUBLISHED' }] },
  }
  const notClosed: Prisma.FundingCallWhereInput = {
    OR: [{ close_date: null }, { close_date: { gte: now } }],
  }

  const filters: Prisma.FundingCallWhereInput[] = [visible]
  if (q) {
    filters.push({
      OR: [
        { scheme_title: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { agency_name: { contains: q, mode: 'insensitive' } },
        { agencyName: { contains: q, mode: 'insensitive' } },
      ],
    })
  }
  if (state === 'draft') {
    filters.push(draftPredicate)
  } else if (state === 'open') {
    filters.push({ NOT: draftPredicate }, notClosed)
  } else if (state === 'unassigned') {
    filters.push({ NOT: draftPredicate }, notClosed, { assignments: { none: {} } })
  } else if (state === 'closed') {
    filters.push({ close_date: { lt: now } })
  }

  const where: Prisma.FundingCallWhereInput = { AND: filters }

  const [rows, total, allCount, draftCount, unassignedOpenCount] = await Promise.all([
    prisma.fundingCall.findMany({
      where,
      select: {
        id: true,
        title: true,
        scheme_title: true,
        agencyName: true,
        agency_name: true,
        close_date: true,
        visibility: true,
        status: true,
        catalog_status: true,
        updatedAt: true,
      },
      // Nearest deadline first keeps the funnel actionable; undated calls sink.
      orderBy: [{ close_date: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.fundingCall.count({ where }),
    prisma.fundingCall.count({ where: visible }),
    prisma.fundingCall.count({ where: { AND: [visible, draftPredicate] } }),
    prisma.fundingCall.count({
      where: { AND: [visible, { NOT: draftPredicate }, notClosed, { assignments: { none: {} } }] },
    }),
  ])

  const callIds = rows.map((row) => row.id)
  const idArray =
    callIds.length > 0
      ? Prisma.sql`ARRAY[${Prisma.join(callIds.map((id) => Prisma.sql`${id}`))}]::text[]`
      : null

  const [alertRows, assignmentRows] = idArray
    ? await Promise.all([
        prisma.$queryRaw<
          Array<{
            funding_call_id: string
            matched: number
            emails_sent: number
            emails_queued: number
            emails_failed: number
            last_alert_at: Date | null
          }>
        >(Prisma.sql`
          SELECT
            funding_call_id,
            COUNT(*)::int AS matched,
            COUNT(*) FILTER (WHERE email_status = 'sent')::int AS emails_sent,
            COUNT(*) FILTER (WHERE email_status = 'queued')::int AS emails_queued,
            COUNT(*) FILTER (WHERE email_status = 'failed')::int AS emails_failed,
            MAX(created_at) AS last_alert_at
          FROM funding_call_alerts
          WHERE funding_call_id = ANY(${idArray})
          GROUP BY funding_call_id
        `),
        prisma.$queryRaw<
          Array<{
            funding_call_id: string
            total: number
            active: number
            accepted: number
            declined: number
            submitted: number
            awarded: number
            award_amount: number
            schools: number
          }>
        >(Prisma.sql`
          SELECT
            funding_call_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'))::int AS active,
            COUNT(*) FILTER (WHERE status IN ('ACCEPTED', 'IN_PROGRESS', 'COMPLETED'))::int AS accepted,
            COUNT(*) FILTER (WHERE status = 'DECLINED')::int AS declined,
            COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int AS submitted,
            COUNT(*) FILTER (WHERE outcome = 'AWARDED')::int AS awarded,
            COALESCE(SUM(award_amount) FILTER (WHERE outcome = 'AWARDED'), 0)::float AS award_amount,
            COUNT(DISTINCT assignee_org_unit_id) FILTER (WHERE assignee_org_unit_id IS NOT NULL)::int AS schools
          FROM call_assignments
          WHERE tenant_id = ${context.tenantId} AND funding_call_id = ANY(${idArray})
          GROUP BY funding_call_id
        `),
      ])
    : [[], []]

  const alertsByCall = new Map(alertRows.map((row) => [row.funding_call_id, row]))
  const assignmentsByCall = new Map(assignmentRows.map((row) => [row.funding_call_id, row]))

  const calls = rows.map((row) => {
    const alerts = alertsByCall.get(row.id)
    const assignments = assignmentsByCall.get(row.id)
    const isDraft =
      row.visibility === 'TENANT_PRIVATE' &&
      row.status !== 'PUBLISHED' &&
      row.catalog_status !== 'PUBLISHED'
    return {
      id: row.id,
      title: row.scheme_title || row.title,
      agency: row.agency_name || row.agencyName || null,
      closeDate: row.close_date,
      visibility: row.visibility,
      isDraft,
      isClosed: Boolean(row.close_date && row.close_date < now),
      updatedAt: row.updatedAt,
      matched: {
        count: alerts?.matched ?? 0,
        emailsSent: alerts?.emails_sent ?? 0,
        emailsQueued: alerts?.emails_queued ?? 0,
        emailsFailed: alerts?.emails_failed ?? 0,
        lastAlertAt: alerts?.last_alert_at ?? null,
      },
      assignments: {
        total: assignments?.total ?? 0,
        active: assignments?.active ?? 0,
        accepted: assignments?.accepted ?? 0,
        declined: assignments?.declined ?? 0,
        submitted: assignments?.submitted ?? 0,
        awarded: assignments?.awarded ?? 0,
        awardAmount: assignments?.award_amount ?? 0,
        schools: assignments?.schools ?? 0,
      },
    }
  })

  return NextResponse.json({
    calls,
    total,
    limit,
    offset,
    counts: {
      all: allCount,
      drafts: draftCount,
      unassignedOpen: unassignedOpenCount,
    },
  })
}
