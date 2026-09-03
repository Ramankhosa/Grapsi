import { loadUnitAreaProfile, relevantCallWhereSql } from '@/lib/funding/callUnitRelevance'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { queueStateSql } from './queueState'

/**
 * Each school as a funnel: how much is relevant, how much is untouched, how
 * much is in flight, and when anyone last did anything about it.
 *
 * The department's existing rollup counts assignments — so a school with a
 * hundred relevant calls and nobody on any of them looks identical to a school
 * with nothing to do. `pending` is the number that tells them apart, and it is
 * computed with the same ladder the officer's own queue tabs use, so the head's
 * figure and the officer's can never disagree.
 */

export interface SchoolFunnelRow {
  schoolId: string
  name: string
  code: string | null
  mappedAreas: number
  isUnmapped: boolean
  relevantOpen: number
  pending: number
  shortlisted: number
  assignedCalls: number
  dismissed: number
  live: number
  submitted: number
  awarded: number
  awardAmount: number
  overdue: number
  faculty: number
  lastContactAt: Date | null
}

/** Assignments in these states mean nobody is actually on the call. */
const NOT_TAKEN_UP = Prisma.sql`ca.status NOT IN ('CANCELLED', 'DECLINED')`
const OPEN_STATUSES = Prisma.sql`('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS')`

function visibleSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`(
    (fc."tenantId" = ${tenantId} AND (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED'))
    OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED')
  )`
}

function textArray(values: string[]): Prisma.Sql {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}`))}]::text[]`
}

/**
 * One school's funnel.
 *
 * Deliberately one query per school rather than a single grouped monster: a
 * tenant has five to thirty schools, each needs its own discipline profile
 * resolved anyway, and this way the numbers are produced by exactly the
 * predicates the queue uses. The overview already takes the same trade for its
 * per-member figures, and for the same reason.
 */
async function funnelForSchool(
  tenantId: string,
  school: { id: string; name: string; code: string | null }
): Promise<SchoolFunnelRow> {
  const subtree = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM tenant_org_units
     WHERE tenant_id = ${tenantId} AND is_active = true AND path && ${textArray([school.id])}
  `)
  const scopeIds = subtree.length > 0 ? subtree.map((row) => row.id) : [school.id]
  const scopeArray = textArray(scopeIds)

  const profile = await loadUnitAreaProfile(tenantId, [school.id])
  const relevant = relevantCallWhereSql(profile, 'fc')

  const liveAssignments = Prisma.sql`(
    SELECT COUNT(*)::int FROM call_assignments ca
     WHERE ca.funding_call_id = fc.id
       AND ca.tenant_id = ${tenantId}
       AND ${NOT_TAKEN_UP}
       AND ca.assignee_org_unit_id = ANY(${scopeArray})
  )`
  const state = queueStateSql(liveAssignments, 'tri')

  const [callRows, workRows, facultyRows, contactRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{ relevant_open: number; pending: number; shortlisted: number; assigned: number; dismissed: number }>
    >(Prisma.sql`
      SELECT COUNT(*)::int                                     AS relevant_open,
             COUNT(*) FILTER (WHERE ${state.pending})::int     AS pending,
             COUNT(*) FILTER (WHERE ${state.shortlisted})::int AS shortlisted,
             COUNT(*) FILTER (WHERE ${state.assigned})::int    AS assigned,
             COUNT(*) FILTER (WHERE ${state.dismissed})::int   AS dismissed
        FROM funding_calls fc
        LEFT JOIN call_school_triage tri
               ON tri.funding_call_id = fc.id AND tri.org_unit_id = ${school.id}
       WHERE ${visibleSql(tenantId)}
         AND (COALESCE(fc.close_date, fc."deadlineAt") IS NULL
              OR COALESCE(fc.close_date, fc."deadlineAt") >= now())
         AND ${relevant}
    `),
    prisma.$queryRaw<
      Array<{ live: number; submitted: number; awarded: number; award_amount: number; overdue: number }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE ca.status IN ${OPEN_STATUSES})::int AS live,
        COUNT(*) FILTER (WHERE ca.status = 'COMPLETED')::int       AS submitted,
        COUNT(*) FILTER (WHERE ca.outcome = 'AWARDED')::int        AS awarded,
        COALESCE(SUM(ca.award_amount) FILTER (WHERE ca.outcome = 'AWARDED'), 0)::float AS award_amount,
        COUNT(*) FILTER (
          WHERE ca.status IN ${OPEN_STATUSES}
            AND ca.deadline_at IS NOT NULL
            AND ca.deadline_at < now()
        )::int AS overdue
      FROM call_assignments ca
      WHERE ca.tenant_id = ${tenantId}
        AND ca.assignee_org_unit_id = ANY(${scopeArray})
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM researcher_profiles rp
       WHERE rp.org_unit_id = ANY(${scopeArray})
    `),
    // The last time anyone in the department did anything about this school:
    // a note on one of its assignments, or a call-level note against the school
    // itself. The second kind is exactly the early chasing that used to be
    // impossible to record.
    prisma.$queryRaw<Array<{ last_contact: Date | null }>>(Prisma.sql`
      SELECT MAX(f.happened_at) AS last_contact
        FROM assignment_follow_ups f
        LEFT JOIN call_assignments ca ON ca.id = f.assignment_id
       WHERE f.tenant_id = ${tenantId}
         AND (
           ca.assignee_org_unit_id = ANY(${scopeArray})
           OR f.org_unit_id = ANY(${scopeArray})
         )
    `),
  ])

  const calls = callRows[0]
  const work = workRows[0]

  return {
    schoolId: school.id,
    name: school.name,
    code: school.code,
    mappedAreas: profile.areaIds.length,
    isUnmapped: profile.isUnmapped,
    relevantOpen: calls?.relevant_open ?? 0,
    pending: calls?.pending ?? 0,
    shortlisted: calls?.shortlisted ?? 0,
    assignedCalls: calls?.assigned ?? 0,
    dismissed: calls?.dismissed ?? 0,
    live: work?.live ?? 0,
    submitted: work?.submitted ?? 0,
    awarded: work?.awarded ?? 0,
    awardAmount: work?.award_amount ?? 0,
    overdue: work?.overdue ?? 0,
    faculty: facultyRows[0]?.count ?? 0,
    lastContactAt: contactRows[0]?.last_contact ?? null,
  }
}

export async function getSchoolFunnel(
  tenantId: string,
  schoolIds?: string[]
): Promise<SchoolFunnelRow[]> {
  const schools = await prisma.tenantOrgUnit.findMany({
    where: {
      tenant_id: tenantId,
      depth: 0,
      is_active: true,
      ...(schoolIds && schoolIds.length > 0 ? { id: { in: schoolIds } } : {}),
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })

  const rows: SchoolFunnelRow[] = []
  for (const school of schools) {
    rows.push(await funnelForSchool(tenantId, school))
  }
  // The school most behind first: that is the row a head opens the page to find.
  return rows.sort((left, right) => right.pending - left.pending || left.name.localeCompare(right.name))
}

/** Tenant-wide headline figures, for the strip above the lenses. */
export async function getDepartmentTotals(tenantId: string, rows: SchoolFunnelRow[]) {
  const [openCalls, unclassified] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM funding_calls fc
       WHERE ${visibleSql(tenantId)}
         AND (COALESCE(fc.close_date, fc."deadlineAt") IS NULL
              OR COALESCE(fc.close_date, fc."deadlineAt") >= now())
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM funding_calls fc
       WHERE ${visibleSql(tenantId)}
         AND (COALESCE(fc.close_date, fc."deadlineAt") IS NULL
              OR COALESCE(fc.close_date, fc."deadlineAt") >= now())
         AND NOT EXISTS (
           SELECT 1 FROM funding_call_research_area_taxonomies m WHERE m.funding_call_id = fc.id
         )
    `),
  ])

  return {
    openCalls: openCalls[0]?.count ?? 0,
    unclassifiedCalls: unclassified[0]?.count ?? 0,
    unmappedSchools: rows.filter((row) => row.isUnmapped).length,
    pending: rows.reduce((sum, row) => sum + row.pending, 0),
    overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
    live: rows.reduce((sum, row) => sum + row.live, 0),
    submitted: rows.reduce((sum, row) => sum + row.submitted, 0),
    awarded: rows.reduce((sum, row) => sum + row.awarded, 0),
    awardAmount: rows.reduce((sum, row) => sum + row.awardAmount, 0),
  }
}
