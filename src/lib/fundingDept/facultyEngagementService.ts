/**
 * Who in these schools has been sent nothing.
 *
 * `getFacultyResponsiveness` answers the other question — of the people who were
 * asked, who answers — and it cannot answer this one, because it is a GROUP BY
 * over `call_assignments`. Somebody who has never been sent a single call
 * produces no assignment row, therefore no group, therefore no line anywhere in
 * the system. The people the department has entirely failed to reach were the one
 * population none of its reports could see.
 *
 * So this query runs the other way round: from the roster, with allocations left
 * joined on. Every faculty member appears whether or not anything was ever
 * delegated to them, which is the whole point.
 *
 * The fairness rule is UNREACHABLE, and it matters as much as the count. A person
 * with no research areas and no alert subscriptions cannot be matched to a call
 * by anything in this system; a person who never set a password cannot accept one
 * if it arrived. Neither is an officer failing to chase. Both are an
 * administrator's data gap, and reporting them as neglect would send officers to
 * chase people who cannot be helped while the actual fix — map the areas, finish
 * the activation — sat with somebody else entirely. The same reasoning the
 * UNMAPPED_SCHOOL flag already uses for schools.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import type { ActivityWindow } from './accountabilityService'
import { subtreeUnitIds, textArray } from './callSql'
import { getCoverageForUnits } from './membershipService'
import { getDeptSettings, type DeptSettings } from './settings'

/** Where one faculty member stands with the department. Exactly one applies. */
export const ENGAGEMENT_CODES = ['ENGAGED', 'DORMANT', 'NEVER_ASSIGNED', 'UNREACHABLE'] as const
export type EngagementCode = (typeof ENGAGEMENT_CODES)[number]

export const ENGAGEMENT_LABELS: Record<EngagementCode, string> = {
  ENGAGED: 'Sent something this period',
  DORMANT: 'Nothing this period',
  NEVER_ASSIGNED: 'Never sent anything',
  UNREACHABLE: 'Cannot be matched yet',
}

/** Why somebody cannot be reached. Both can be true; both belong to an admin. */
export interface UnreachableReasons {
  /** No research areas on the profile and no alert subscriptions. */
  noAreas: boolean
  /** Never set a password, so the account has never been used. */
  neverActivated: boolean
}

export interface FacultyEngagementRow {
  userId: string
  name: string
  email: string | null
  employeeId: string | null
  unitId: string | null
  unitName: string | null
  schoolId: string | null
  schoolName: string | null
  designation: string | null
  /** The officer answerable for this person school, for the reader who wants to ask. */
  officerName: string | null
  code: EngagementCode
  unreachable: UnreachableReasons
  /** Allocations ever, whatever their state. Zero is the headline case. */
  everAssigned: number
  assignedInWindow: number
  live: number
  submittedInWindow: number
  declinedEver: number
  lastAssignedAt: Date | null
  /** Whole days since the last allocation. Null when there has never been one. */
  daysSinceAssigned: number | null
}

export interface FacultyEngagement {
  window: ActivityWindow
  dormantDays: number
  rows: FacultyEngagementRow[]
  totals: {
    faculty: number
    engaged: number
    dormant: number
    neverAssigned: number
    unreachable: number
    /** Never assigned AND reachable: the number an officer actually owns. */
    actionable: number
  }
  /** Per school, for the rollup strip above the table. */
  bySchool: Array<{
    schoolId: string
    schoolName: string
    officerName: string | null
    faculty: number
    neverAssigned: number
    dormant: number
    unreachable: number
    actionable: number
  }>
}

interface EngagementSqlRow {
  user_id: string
  name: string
  email: string | null
  employee_id: string | null
  unit_id: string | null
  unit_name: string | null
  designation: string | null
  has_areas: boolean
  activated: boolean
  ever_assigned: number
  assigned_in_window: number
  live: number
  submitted_in_window: number
  declined_ever: number
  last_assigned_at: Date | null
}

/**
 * Classify one person.
 *
 * Order matters and is not arbitrary. UNREACHABLE outranks everything, including
 * NEVER_ASSIGNED, because a person who cannot be matched has not been neglected
 * and must not be counted as though they had — a report that listed them among
 * the officer failures would be asking for work that cannot be done. Anyone who
 * has ever held an allocation is past that gate by definition: the system plainly
 * did reach them once.
 */
export function classifyEngagement(input: {
  everAssigned: number
  assignedInWindow: number
  live: number
  hasAreas: boolean
  activated: boolean
}): { code: EngagementCode; unreachable: UnreachableReasons } {
  const unreachable: UnreachableReasons = {
    noAreas: !input.hasAreas,
    neverActivated: !input.activated,
  }
  if (input.everAssigned === 0 && (unreachable.noAreas || unreachable.neverActivated)) {
    return { code: 'UNREACHABLE', unreachable }
  }
  if (input.everAssigned === 0) return { code: 'NEVER_ASSIGNED', unreachable }
  // Live work counts as engagement even when it was delegated before the window:
  // somebody carrying an application right now is not dormant, whatever the date
  // filter says.
  if (input.assignedInWindow > 0 || input.live > 0) return { code: 'ENGAGED', unreachable }
  return { code: 'DORMANT', unreachable }
}

/**
 * The roster of these schools, with what each person has been sent.
 *
 * One query for the whole scope rather than per school: the roster is a single
 * indexed scan over `researcher_profiles`, and the per-school discipline profiles
 * that force the funnel to loop are not needed here.
 */
export async function getFacultyEngagement(
  tenantId: string,
  options: {
    window: ActivityWindow
    /** Schools to report on. Callers clamp this to the viewer reach before calling. */
    schoolIds: string[]
    now?: Date
    settings?: DeptSettings
  }
): Promise<FacultyEngagement> {
  const now = options.now ?? new Date()
  const settings = options.settings ?? (await getDeptSettings(tenantId))

  const schools = await prisma.tenantOrgUnit.findMany({
    where: {
      tenant_id: tenantId,
      is_active: true,
      ...(options.schoolIds.length > 0 ? { id: { in: options.schoolIds } } : { depth: 0 }),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  if (schools.length === 0) {
    return {
      window: options.window,
      dormantDays: settings.facultyDormantDays,
      rows: [],
      totals: { faculty: 0, engaged: 0, dormant: 0, neverAssigned: 0, unreachable: 0, actionable: 0 },
      bySchool: [],
    }
  }

  const schoolIds = schools.map((school) => school.id)
  // Faculty sit on departments, so a school itself holds almost nobody.
  const scopeIds = await subtreeUnitIds(tenantId, schoolIds)
  const scopeArray = textArray(scopeIds)
  const rootArray = textArray(schoolIds)

  const rows = await prisma.$queryRaw<EngagementSqlRow[]>(Prisma.sql`
    SELECT u.id                                        AS user_id,
           COALESCE(rp.display_name, u.name, u.email, '—') AS name,
           u.email                                     AS email,
           rp.employee_id                              AS employee_id,
           rp.org_unit_id                              AS unit_id,
           ou.name                                     AS unit_name,
           rp.designation                              AS designation,
           -- Reachable by matching: either areas on the profile, or a saved area
           -- subscribed to alerts. Same two sources the alert dispatcher reads.
           (
             COALESCE(array_length(rp.research_areas, 1), 0) > 0
             OR EXISTS (
               SELECT 1 FROM researcher_saved_research_areas sa
                WHERE sa.user_id = u.id AND sa.use_for_alerts = true
             )
           )                                           AS has_areas,
           (u."passwordHash" IS NOT NULL)              AS activated,
           COALESCE(a.ever_assigned, 0)::int           AS ever_assigned,
           COALESCE(a.assigned_in_window, 0)::int      AS assigned_in_window,
           COALESCE(a.live, 0)::int                    AS live,
           COALESCE(a.submitted_in_window, 0)::int     AS submitted_in_window,
           COALESCE(a.declined_ever, 0)::int           AS declined_ever,
           a.last_assigned_at                          AS last_assigned_at
      FROM researcher_profiles rp
      JOIN users u ON u.id = rp.user_id
      LEFT JOIN tenant_org_units ou ON ou.id = rp.org_unit_id
      -- LEFT JOIN, which is the entire reason this service exists: an inner join
      -- is what made people with no allocations invisible.
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS ever_assigned,
               COUNT(*) FILTER (
                 WHERE ca.created_at BETWEEN ${options.window.start} AND ${options.window.end}
               )::int AS assigned_in_window,
               COUNT(*) FILTER (WHERE ca.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS'))::int AS live,
               COUNT(*) FILTER (
                 WHERE ca.submitted_at BETWEEN ${options.window.start} AND ${options.window.end}
               )::int AS submitted_in_window,
               COUNT(*) FILTER (WHERE ca.status = 'DECLINED')::int AS declined_ever,
               MAX(ca.created_at) AS last_assigned_at
          FROM call_assignments ca
         WHERE ca.assignee_user_id = u.id AND ca.tenant_id = ${tenantId}
      ) a ON TRUE
     WHERE u."tenantId" = ${tenantId}
       AND rp.org_unit_id = ANY(${scopeArray})
       -- Platform staff are not faculty and would read as permanently neglected.
       AND NOT (u.roles && ARRAY['SUPER_ADMIN','SUPER_ADMIN_VIEWER']::"UserRole"[])
     ORDER BY name ASC
  `)

  // Which school root each unit belongs to, resolved once from the materialised
  // path rather than per row.
  const pathRows = await prisma.$queryRaw<Array<{ id: string; root: string | null }>>(Prisma.sql`
    SELECT u.id,
           (SELECT unnest(u.path) INTERSECT SELECT unnest(${rootArray}) LIMIT 1) AS root
      FROM tenant_org_units u
     WHERE u.tenant_id = ${tenantId} AND u.id = ANY(${scopeArray})
  `)
  const rootOfUnit = new Map(pathRows.map((row) => [row.id, row.root]))
  const schoolName = new Map(schools.map((school) => [school.id, school.name]))

  // Keyed by the unit asked about, not by school root: a Head of Department is
  // granted a department, and looking that up among the roots would report
  // "nobody" for a school that is in fact covered.
  const coverageByUnit = await getCoverageForUnits(tenantId, schoolIds)
  const officerOfSchool = new Map(
    Array.from(coverageByUnit.entries()).map(([unitId, row]) => [unitId, row.memberName])
  )

  const built: FacultyEngagementRow[] = rows.map((row) => {
    const { code, unreachable } = classifyEngagement({
      everAssigned: row.ever_assigned,
      assignedInWindow: row.assigned_in_window,
      live: row.live,
      hasAreas: row.has_areas,
      activated: row.activated,
    })
    const schoolId = row.unit_id ? (rootOfUnit.get(row.unit_id) ?? null) : null
    return {
      userId: row.user_id,
      name: row.name,
      email: row.email,
      employeeId: row.employee_id,
      unitId: row.unit_id,
      unitName: row.unit_name,
      schoolId,
      schoolName: schoolId ? (schoolName.get(schoolId) ?? null) : null,
      designation: row.designation,
      officerName: schoolId ? (officerOfSchool.get(schoolId) ?? null) : null,
      code,
      unreachable,
      everAssigned: row.ever_assigned,
      assignedInWindow: row.assigned_in_window,
      live: row.live,
      submittedInWindow: row.submitted_in_window,
      declinedEver: row.declined_ever,
      lastAssignedAt: row.last_assigned_at,
      daysSinceAssigned: row.last_assigned_at
        ? Math.max(
            0,
            Math.floor((now.getTime() - new Date(row.last_assigned_at).getTime()) / 86400000)
          )
        : null,
    }
  })

  // Worst first, and "worst" is deliberately not "longest silent": somebody who
  // has never been approached at all outranks somebody the department merely has
  // not been back to.
  const RANK: Record<EngagementCode, number> = {
    NEVER_ASSIGNED: 0,
    DORMANT: 1,
    UNREACHABLE: 2,
    ENGAGED: 3,
  }
  built.sort(
    (left, right) =>
      RANK[left.code] - RANK[right.code] ||
      (right.daysSinceAssigned ?? 0) - (left.daysSinceAssigned ?? 0) ||
      left.name.localeCompare(right.name)
  )

  const isActionable = (row: FacultyEngagementRow) => row.code === 'NEVER_ASSIGNED'

  const bySchool = schools
    .map((school) => {
      const mine = built.filter((row) => row.schoolId === school.id)
      return {
        schoolId: school.id,
        schoolName: school.name,
        officerName: officerOfSchool.get(school.id) ?? null,
        faculty: mine.length,
        neverAssigned: mine.filter((row) => row.code === 'NEVER_ASSIGNED').length,
        dormant: mine.filter((row) => row.code === 'DORMANT').length,
        unreachable: mine.filter((row) => row.code === 'UNREACHABLE').length,
        actionable: mine.filter(isActionable).length,
      }
    })
    .filter((row) => row.faculty > 0)
    .sort((left, right) => right.actionable - left.actionable || right.dormant - left.dormant)

  return {
    window: options.window,
    dormantDays: settings.facultyDormantDays,
    rows: built,
    totals: {
      faculty: built.length,
      engaged: built.filter((row) => row.code === 'ENGAGED').length,
      dormant: built.filter((row) => row.code === 'DORMANT').length,
      neverAssigned: built.filter((row) => row.code === 'NEVER_ASSIGNED').length,
      unreachable: built.filter((row) => row.code === 'UNREACHABLE').length,
      actionable: built.filter(isActionable).length,
    },
    bySchool,
  }
}

const CSV_COLUMNS: Array<[string, (row: FacultyEngagementRow) => unknown]> = [
  ['Name', (row) => row.name],
  ['Email', (row) => row.email || ''],
  ['Employee ID', (row) => row.employeeId || ''],
  ['School', (row) => row.schoolName || ''],
  ['Unit', (row) => row.unitName || ''],
  ['Designation', (row) => row.designation || ''],
  ['Covering officer', (row) => row.officerName || 'nobody'],
  ['Standing', (row) => ENGAGEMENT_LABELS[row.code]],
  [
    'Why unreachable',
    (row) =>
      [row.unreachable.noAreas ? 'no research areas' : '', row.unreachable.neverActivated ? 'never activated' : '']
        .filter(Boolean)
        .join('; '),
  ],
  ['Allocations ever', (row) => row.everAssigned],
  ['This period', (row) => row.assignedInWindow],
  ['Live now', (row) => row.live],
  ['Submitted this period', (row) => row.submittedInWindow],
  ['Declined ever', (row) => row.declinedEver],
  [
    'Last sent',
    (row) => (row.lastAssignedAt ? new Date(row.lastAssignedAt).toISOString().slice(0, 10) : 'never'),
  ],
  ['Days since', (row) => row.daysSinceAssigned ?? ''],
]

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function engagementToCsv(rows: FacultyEngagementRow[]) {
  const lines = [CSV_COLUMNS.map(([heading]) => csvCell(heading)).join(',')]
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(row))).join(','))
  }
  return `${lines.join('\n')}\n`
}
