import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadUnitAreaProfile } from '@/lib/funding/callUnitRelevance'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { canReviewDept } from '@/lib/fundingDept/shared'
import { listSubtreeUnitIds } from '@/lib/orgUnits/tree'
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
  // Field filters. Agency / discipline / funding kind come from the facet
  // lists below, so every offered value matches at least one call.
  const agency = (searchParams.get('agency') || '').trim()
  const discipline = (searchParams.get('discipline') || '').trim()
  // Controlled discipline, from the research-area catalog. `discipline` above is
  // the legacy free-text tag; both are honoured so existing saved filters and
  // links keep working, but the facet list now offers catalog areas.
  const researchAreaId = (searchParams.get('researchAreaId') || '').trim()
  const fundingKind = (searchParams.get('fundingKind') || '').trim()
  // A school: every call that is this school's business — the ones someone in
  // it has been put on, PLUS the ones matching its disciplines that nobody has
  // touched. The second half is the point: a call with no assignments used to
  // be invisible in exactly the view that should expose it.
  const orgUnitId = (searchParams.get('orgUnitId') || '').trim()
  // Deadline window in days from now — the "closing soon" triage filter.
  const closingInDays = Number(searchParams.get('closingInDays')) || 0
  const sort = (searchParams.get('sort') || 'deadline').trim()

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

  if (agency) {
    // Both columns carry the agency depending on the intake path, so a value
    // picked from the facet list has to be checked against either.
    filters.push({
      OR: [
        { agency_name: { equals: agency, mode: 'insensitive' } },
        { agencyName: { equals: agency, mode: 'insensitive' } },
      ],
    })
  }
  if (discipline) {
    filters.push({ disciplines: { has: discipline } })
  }
  if (researchAreaId) {
    filters.push({
      research_area_taxonomies: { some: { taxonomy_area_id: researchAreaId } },
    })
  }
  if (fundingKind) {
    filters.push({ funding_kinds: { has: fundingKind } })
  }
  if (orgUnitId) {
    const [subtreeIds, profile] = await Promise.all([
      listSubtreeUnitIds(context.tenantId, [orgUnitId]),
      loadUnitAreaProfile(context.tenantId, [orgUnitId]),
    ])

    const assignedHere: Prisma.FundingCallWhereInput =
      subtreeIds.length === 0
        ? { id: '__none__' }
        : {
            assignments: {
              some: {
                tenant_id: context.tenantId,
                assignee_org_unit_id: { in: subtreeIds },
              },
            },
          }

    if (profile.isUnmapped) {
      // Nothing mapped for this school, so discipline relevance cannot say
      // anything. Fall back to the assignment-derived answer this filter has
      // always given rather than widening to the whole catalog.
      filters.push(assignedHere)
    } else {
      const relevantHere: Prisma.FundingCallWhereInput[] = []
      if (profile.areaIds.length > 0) {
        relevantHere.push({
          research_area_taxonomies: { some: { taxonomy_area_id: { in: profile.areaIds } } },
        })
      }
      if (profile.level1Codes.length > 0) {
        relevantHere.push({
          research_area_taxonomies: {
            some: { taxonomy_level1_code: { in: profile.level1Codes } },
          },
        })
      }
      if (profile.keywords.length > 0) {
        relevantHere.push({ disciplines: { hasSome: profile.keywords } })
      }
      filters.push({ OR: [assignedHere, ...relevantHere] })
    }
  }
  if (closingInDays > 0) {
    const until = new Date(now.getTime() + closingInDays * 24 * 60 * 60 * 1000)
    // Undated calls are excluded on purpose: "closing within 30 days" is a
    // question about dated calls, and a null date would otherwise read as urgent.
    filters.push({ close_date: { gte: now, lte: until } })
  }

  const where: Prisma.FundingCallWhereInput = { AND: filters }

  // The agencies / disciplines / kinds actually present in this tenant's
  // visible calls, so the dropdowns can never offer a dead filter.
  if (searchParams.get('action') === 'facets') {
    const facetRows = await prisma.fundingCall.findMany({
      where: visible,
      select: {
        id: true,
        agency_name: true,
        agencyName: true,
        disciplines: true,
        funding_kinds: true,
      },
    })

    const sortedUnique = (values: Array<string | null | undefined>) =>
      Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right)
      )

    // Catalog areas actually present on this tenant's visible calls. Offered
    // alongside the raw tags rather than instead of them: a call classified
    // into an area is filterable by a name every school shares, while the raw
    // tag list still covers whatever has not been classified yet.
    const areaRows = await prisma.$queryRaw<
      Array<{ taxonomy_area_id: string; label: string; call_count: number }>
    >(Prisma.sql`
      SELECT m.taxonomy_area_id,
             CASE WHEN COALESCE(m.taxonomy_level2_name, '') <> ''
                  THEN m.taxonomy_level1_name || ' → ' || m.taxonomy_level2_name
                  ELSE m.taxonomy_level1_name END AS label,
             COUNT(DISTINCT m.funding_call_id)::int AS call_count
        FROM funding_call_research_area_taxonomies m
       WHERE m.funding_call_id = ANY(${
         facetRows.length > 0
           ? Prisma.sql`ARRAY[${Prisma.join(
               facetRows.map((row) => Prisma.sql`${row.id}`)
             )}]::text[]`
           : Prisma.sql`ARRAY[]::text[]`
       })
       GROUP BY m.taxonomy_area_id, label
       ORDER BY label ASC
    `)

    return NextResponse.json({
      agencies: sortedUnique(facetRows.map((row) => row.agency_name || row.agencyName)),
      disciplines: sortedUnique(facetRows.flatMap((row) => row.disciplines)),
      fundingKinds: sortedUnique(facetRows.flatMap((row) => row.funding_kinds)),
      researchAreas: areaRows.map((row) => ({
        id: row.taxonomy_area_id,
        label: row.label,
        callCount: row.call_count,
      })),
    })
  }

  // Nearest deadline first keeps the funnel actionable; undated calls sink.
  const orderBy: Prisma.FundingCallOrderByWithRelationInput[] =
    sort === 'recent'
      ? [{ updatedAt: 'desc' }]
      : sort === 'assigned'
        ? [{ assignments: { _count: 'desc' } }, { close_date: { sort: 'asc', nulls: 'last' } }]
        : sort === 'title'
          ? [{ scheme_title: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }]
          : [{ close_date: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }]

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
      orderBy,
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
