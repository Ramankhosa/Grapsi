import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import {
  loadUnitAreaProfile,
  relevanceForCalls,
  relevantCallWhereSql,
} from '@/lib/funding/callUnitRelevance'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { queueStateSql, type QueueState as LadderState } from '@/lib/fundingDept/queueState'
import { listSubtreeUnitIds } from '@/lib/orgUnits/tree'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic = 'force-dynamic'

/**
 * One school's call queue, as the officer covering it works it.
 *
 * This is the view the department did not have. `/api/funding-dept/calls` is
 * the head's oversight funnel and is gated to admins and the head; an ordinary
 * member could see their own assignments and nothing else, so "what should I be
 * putting my school's people on" had no answer anywhere in the product.
 *
 * Deliberately ONE school at a time. Triage and the "is anyone on this" count
 * are both per-school facts, and a union view would have to answer "dismissed
 * in which school?" — a question with no good answer. Officers chase school by
 * school; the endpoint follows.
 */

const STATES = ['pending', 'shortlisted', 'assigned', 'dismissed', 'all'] as const
type QueueState = (typeof STATES)[number]

/** Assignments in these states mean nobody is actually on the call. */
const NOT_TAKEN_UP = Prisma.sql`ca.status NOT IN ('CANCELLED', 'DECLINED')`

/**
 * Visibility, matching `getUnassignedUpcomingCalls` exactly — a tenant's own
 * published calls plus the global catalog. Drafts are excluded: the queue is
 * about work that can actually be delegated.
 */
function visibleSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`(
    (fc."tenantId" = ${tenantId} AND (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED'))
    OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED')
  )`
}

export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const membership = await getMembership(context.tenantId, context.user.id)
  const isActiveMember = Boolean(membership?.is_active)
  // Note this is NOT `canReviewDept` — that is what locks ordinary members out
  // of the oversight funnel, and this queue exists precisely for them.
  if (!isActiveMember && !context.isAdmin) {
    return NextResponse.json(
      { error: 'You are not a member of the funding department.' },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(request.url)
  const requestedUnitId = (searchParams.get('orgUnitId') || '').trim()
  const state = (STATES as readonly string[]).includes(searchParams.get('state') || '')
    ? ((searchParams.get('state') || 'pending') as QueueState)
    : 'pending'
  const relevanceMode = searchParams.get('relevance') === 'all' ? 'all' : 'relevant'
  const q = (searchParams.get('q') || '').trim()
  const closingInDays = Number(searchParams.get('closingInDays')) || 0
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  // The schools this person may work. A member covers their rota; an admin
  // without coverage may pick any root unit, since they answer for all of them.
  const coveredIds = (membership?.school_assignments ?? []).map((row) => row.org_unit_id)
  const selectableUnits = await prisma.tenantOrgUnit.findMany({
    where: {
      tenant_id: context.tenantId,
      is_active: true,
      ...(coveredIds.length > 0
        ? { id: { in: coveredIds } }
        : context.isAdmin
          ? { depth: 0 }
          : { id: '__none__' }),
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })

  if (selectableUnits.length === 0) {
    return NextResponse.json({
      schools: [],
      school: null,
      calls: [],
      total: 0,
      counts: { pending: 0, shortlisted: 0, assigned: 0, dismissed: 0 },
      isUnmapped: false,
      message: 'No schools are assigned to you yet. Ask your department head to allocate one.',
    })
  }

  const school =
    selectableUnits.find((unit) => unit.id === requestedUnitId) || selectableUnits[0]

  const subtreeIds = await listSubtreeUnitIds(context.tenantId, [school.id])
  const scopeIds = subtreeIds.length > 0 ? subtreeIds : [school.id]
  const scopeArray = Prisma.sql`ARRAY[${Prisma.join(
    scopeIds.map((id) => Prisma.sql`${id}`)
  )}]::text[]`

  const profile = await loadUnitAreaProfile(context.tenantId, [school.id])
  const relevantSql =
    relevanceMode === 'all' ? Prisma.sql`TRUE` : relevantCallWhereSql(profile, 'fc')

  const now = new Date()
  const filters: Prisma.Sql[] = [
    visibleSql(context.tenantId),
    // Closed calls are not work; they are history. The `all` state still hides
    // them, because a queue is a list of things that can still be done.
    Prisma.sql`(COALESCE(fc.close_date, fc."deadlineAt") IS NULL OR COALESCE(fc.close_date, fc."deadlineAt") >= ${now})`,
    relevantSql,
  ]

  if (q) {
    filters.push(Prisma.sql`(
      fc.title ILIKE ${`%${q}%`} OR fc.scheme_title ILIKE ${`%${q}%`}
      OR fc.agency_name ILIKE ${`%${q}%`} OR fc."agencyName" ILIKE ${`%${q}%`}
    )`)
  }
  if (closingInDays > 0) {
    const until = new Date(now.getTime() + closingInDays * 86400000)
    filters.push(
      Prisma.sql`COALESCE(fc.close_date, fc."deadlineAt") BETWEEN ${now} AND ${until}`
    )
  }

  // Live assignments anywhere in this school's subtree, and this school's
  // triage decision. Both are per-school, which is why the queue is per-school.
  const liveAssignments = Prisma.sql`(
    SELECT COUNT(*)::int FROM call_assignments ca
     WHERE ca.funding_call_id = fc.id
       AND ca.tenant_id = ${context.tenantId}
       AND ${NOT_TAKEN_UP}
       AND ca.assignee_org_unit_id = ANY(${scopeArray})
  )`
  const triageJoin = Prisma.sql`
    LEFT JOIN call_school_triage tri
           ON tri.funding_call_id = fc.id
          AND tri.org_unit_id = ${school.id}
  `

  // The four states as a precedence ladder (see queueState.ts): a call lands in
  // exactly one, so the tab counts partition the open total.
  const stateSql: Record<LadderState, Prisma.Sql> = queueStateSql(liveAssignments, 'tri')

  const baseWhere = Prisma.join(filters, ' AND ')
  const where =
    state === 'all'
      ? baseWhere
      : Prisma.sql`${baseWhere} AND ${stateSql[state as Exclude<QueueState, 'all'>]}`

  const [rows, totalRows, countRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string
        title: string | null
        agency: string | null
        close_date: Date | null
        triage_status: string | null
        triage_note: string | null
        live_assignments: number
      }>
    >(Prisma.sql`
      SELECT fc.id,
             COALESCE(fc.scheme_title, fc.title)       AS title,
             COALESCE(fc.agency_name, fc."agencyName") AS agency,
             COALESCE(fc.close_date, fc."deadlineAt")  AS close_date,
             tri.status                                AS triage_status,
             tri.note                                  AS triage_note,
             ${liveAssignments}                        AS live_assignments
        FROM funding_calls fc
        ${triageJoin}
       WHERE ${where}
       ORDER BY COALESCE(fc.close_date, fc."deadlineAt") ASC NULLS LAST, fc."updatedAt" DESC
       LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM funding_calls fc ${triageJoin} WHERE ${where}
    `),
    prisma.$queryRaw<
      Array<{ pending: number; shortlisted: number; assigned: number; dismissed: number }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE ${stateSql.pending})::int     AS pending,
        COUNT(*) FILTER (WHERE ${stateSql.shortlisted})::int AS shortlisted,
        COUNT(*) FILTER (WHERE ${stateSql.assigned})::int    AS assigned,
        COUNT(*) FILTER (WHERE ${stateSql.dismissed})::int   AS dismissed
      FROM funding_calls fc ${triageJoin} WHERE ${baseWhere}
    `),
  ])

  const relevance = await relevanceForCalls(
    profile,
    rows.map((row) => row.id)
  )

  return NextResponse.json({
    schools: selectableUnits.map((unit) => ({ id: unit.id, name: unit.name, code: unit.code })),
    school: { id: school.id, name: school.name, code: school.code },
    // The banner condition: nothing mapped, so the filter cannot narrow and the
    // officer is looking at the whole catalog. Says so rather than pretending.
    isUnmapped: profile.isUnmapped,
    relevance: relevanceMode,
    state,
    counts: countRows[0] || { pending: 0, shortlisted: 0, assigned: 0, dismissed: 0 },
    total: totalRows[0]?.count ?? 0,
    limit,
    offset,
    calls: rows.map((row) => {
      const match = relevance.get(row.id)
      return {
        id: row.id,
        title: row.title,
        agency: row.agency,
        closeDate: row.close_date,
        triageStatus: row.triage_status || 'NEW',
        triageNote: row.triage_note,
        liveAssignments: row.live_assignments,
        relevanceTier: match?.tier ?? 'none',
        relevanceReason: match?.reason ?? null,
      }
    }),
  })
}
