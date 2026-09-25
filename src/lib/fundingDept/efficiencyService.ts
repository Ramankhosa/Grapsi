/**
 * How quickly the department works, as opposed to how much is outstanding.
 *
 * Every other number in this module is a level: how many calls are pending, how
 * many allocations are silent. Levels cannot separate the two cases a head most
 * needs to tell apart — an officer with a clean queue because they are fast, and
 * an officer with a clean queue because their schools receive four calls a year.
 * Nor can they see the officer who clears a backlog by declaring everything
 * irrelevant, which on every existing screen looks exactly like doing the job.
 *
 * So this measures rates and durations:
 *
 *   time to first touch   call arrives -> anyone in the school looks at it
 *   time to allocate      call arrives -> somebody is actually put on it
 *   dismissal rate        share of decisions that were "none of our business"
 *   conversion            allocations made -> applications that went in
 *   decline rate          a proxy for aiming calls at the wrong people
 *
 * Medians, not means, throughout. One call that sat for eleven months while an
 * officer was on secondment would drag a mean far enough to make an otherwise
 * reasonable record look negligent, and the officer would be right to say so.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import type { ActivityWindow } from './accountabilityService'
import { computeFlags, type AccountabilityFlag } from './accountabilityFlags'
import { callEnteredAtSql, subtreeUnitIds, textArray, visibleCallSql } from './callSql'
import { listMembers } from './membershipService'
import { applicationSubmittedSql } from './reportDefinitions'
import { getDeptSettings, type DeptSettings } from './settings'
import { isMemberAway, memberReachSchoolIds, serializeMember } from './shared'

export interface EfficiencySchoolRow {
  schoolId: string
  schoolName: string
  /** Calls that arrived in this school during the window. The denominator. */
  callsArrived: number
  /** Median days from arrival to the first triage decision or note. */
  medianFirstTouchDays: number | null
  /** Of those that arrived, how many nobody has looked at yet. */
  neverTouched: number
  /** Median days from arrival to the first allocation in the school. */
  medianAllocateDays: number | null
  /** Triage decisions recorded in the window. */
  decided: number
  /** Of those, how many said the call was not this school's business. */
  dismissed: number
  /** Dismissals recorded without a word of explanation. */
  dismissedWithoutNote: number
  /** Allocations created in the window. */
  allocated: number
  /** Of those, how many have since been submitted. */
  submitted: number
  /** Of those, how many were declined. */
  declined: number
  /** Of those, how many are still unanswered past the tenant patience. */
  unanswered: number
  /** Allocations closed out as never applied for, in the window. */
  lapsed: number
  /** Untouched backlog at each of the last weeks, oldest first. From the snapshots. */
  trend: number[]
}

export interface EfficiencyMemberRow {
  memberId: string
  userId: string
  name: string | null
  email: string | null
  isHead: boolean
  isAway: boolean
  schools: EfficiencySchoolRow[]
  totals: {
    callsArrived: number
    neverTouched: number
    medianFirstTouchDays: number | null
    medianAllocateDays: number | null
    decided: number
    dismissed: number
    dismissedWithoutNote: number
    allocated: number
    submitted: number
    declined: number
    unanswered: number
    lapsed: number
    /** Submitted over allocated, as a percentage. Null when nothing was allocated. */
    conversionPct: number | null
    /** Dismissed over decided, as a percentage. Null when nothing was decided. */
    dismissalPct: number | null
  }
  /**
   * The same weighted flags the accountability grid shows, computed from these
   * numbers rather than from the queue. This is where SLOW_FIRST_TOUCH and
   * HIGH_DISMISSAL can fire at all: the grid has no idea how fast anyone reacts.
   */
  flags: AccountabilityFlag[]
  trend: number[]
}

export interface OfficerEfficiency {
  window: ActivityWindow
  firstTouchTargetDays: number
  dismissalRateWarnPct: number
  /** Week-start dates the trend arrays line up with, oldest first. */
  trendWeeks: string[]
  members: EfficiencyMemberRow[]
}

interface TimingRow {
  school_id: string
  calls_arrived: number
  never_touched: number
  median_first_touch: number | null
  median_allocate: number | null
}

interface DecisionRow {
  school_id: string
  decided: number
  dismissed: number
  dismissed_without_note: number
}

interface WorkRow {
  school_id: string
  allocated: number
  submitted: number
  declined: number
  unanswered: number
  lapsed: number
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10
}

function safeDays(days: number) {
  return Prisma.raw(`INTERVAL '${Math.min(Math.max(Math.round(Number(days) || 0), 0), 3650)} days'`)
}

/**
 * Arrival-to-reaction timings per school.
 *
 * Restricted to calls that ARRIVED inside the window, not calls acted on inside
 * it. Measuring the latter would quietly flatter a backlog clear-out: an officer
 * who spent March finally looking at last year calls would post a terrible
 * figure for doing exactly the right thing, while one who ignored everything
 * older than a week would post a good one.
 *
 * `relevantCallWhereSql` is deliberately NOT applied. Taxonomy mappings change,
 * and a school discipline profile today is not the one the call arrived under, so
 * filtering here would silently redate history. The school's own subtree and the
 * triage row are evidence enough that the call was in front of them.
 */
async function timingsForSchools(
  tenantId: string,
  schoolIds: string[],
  window: ActivityWindow
): Promise<TimingRow[]> {
  if (schoolIds.length === 0) return []
  const roots = textArray(schoolIds)

  return prisma.$queryRaw<TimingRow[]>(Prisma.sql`
    WITH arrivals AS (
      SELECT s.id AS school_id,
             fc.id AS call_id,
             ${callEnteredAtSql('fc')} AS entered_at
        FROM funding_calls fc
        CROSS JOIN tenant_org_units s
       WHERE s.tenant_id = ${tenantId}
         AND s.id = ANY(${roots})
         AND ${visibleCallSql(tenantId, 'fc')}
         AND ${callEnteredAtSql('fc')} BETWEEN ${window.start} AND ${window.end}
         -- Only calls this school actually engaged with or was escalated about.
         -- Without this every school is credited with every call in the catalog,
         -- and the medians describe the catalog rather than the officer.
         AND (
           EXISTS (
             SELECT 1 FROM call_school_triage t
              WHERE t.funding_call_id = fc.id AND t.org_unit_id = s.id
           )
           OR EXISTS (
             SELECT 1 FROM assignment_follow_ups f
              WHERE f.funding_call_id = fc.id
                AND f.org_unit_id IN (
                  SELECT cu.id FROM tenant_org_units cu
                   WHERE cu.tenant_id = ${tenantId} AND cu.path && ARRAY[s.id]::text[]
                )
           )
           OR EXISTS (
             SELECT 1 FROM call_assignments ca
              WHERE ca.funding_call_id = fc.id
                AND ca.tenant_id = ${tenantId}
                AND ca.assignee_org_unit_id IN (
                  SELECT cu.id FROM tenant_org_units cu
                   WHERE cu.tenant_id = ${tenantId} AND cu.path && ARRAY[s.id]::text[]
                )
           )
         )
    ),
    touched AS (
      SELECT a.school_id,
             a.call_id,
             a.entered_at,
             LEAST(
               (SELECT MIN(t.decided_at) FROM call_school_triage t
                 WHERE t.funding_call_id = a.call_id AND t.org_unit_id = a.school_id),
               (SELECT MIN(f.happened_at) FROM assignment_follow_ups f
                 WHERE f.funding_call_id = a.call_id
                   AND f.org_unit_id IN (
                     SELECT cu.id FROM tenant_org_units cu
                      WHERE cu.tenant_id = ${tenantId} AND cu.path && ARRAY[a.school_id]::text[]
                   ))
             ) AS first_touch_at,
             (SELECT MIN(ca.created_at) FROM call_assignments ca
               WHERE ca.funding_call_id = a.call_id
                 AND ca.tenant_id = ${tenantId}
                 AND ca.assignee_org_unit_id IN (
                   SELECT cu.id FROM tenant_org_units cu
                    WHERE cu.tenant_id = ${tenantId} AND cu.path && ARRAY[a.school_id]::text[]
                 )) AS first_allocated_at
        FROM arrivals a
    )
    SELECT school_id,
           COUNT(*)::int AS calls_arrived,
           COUNT(*) FILTER (WHERE first_touch_at IS NULL)::int AS never_touched,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (first_touch_at - entered_at)) / 86400
           ) FILTER (WHERE first_touch_at IS NOT NULL) AS median_first_touch,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (first_allocated_at - entered_at)) / 86400
           ) FILTER (WHERE first_allocated_at IS NOT NULL) AS median_allocate
      FROM touched
     GROUP BY school_id
  `)
}

/** Triage decisions and how many of them cleared the call rather than used it. */
async function decisionsForSchools(
  tenantId: string,
  schoolIds: string[],
  window: ActivityWindow
): Promise<DecisionRow[]> {
  if (schoolIds.length === 0) return []
  return prisma.$queryRaw<DecisionRow[]>(Prisma.sql`
    SELECT t.org_unit_id AS school_id,
           COUNT(*)::int AS decided,
           COUNT(*) FILTER (WHERE t.status = 'NOT_RELEVANT')::int AS dismissed,
           COUNT(*) FILTER (
             WHERE t.status = 'NOT_RELEVANT' AND COALESCE(TRIM(t.note), '') = ''
           )::int AS dismissed_without_note
      FROM call_school_triage t
     WHERE t.tenant_id = ${tenantId}
       AND t.org_unit_id = ANY(${textArray(schoolIds)})
       AND t.decided_at BETWEEN ${window.start} AND ${window.end}
     GROUP BY t.org_unit_id
  `)
}

/**
 * What became of the allocations made in the window.
 *
 * Keyed on the school the assignee sits under, not on who delegated it, for the
 * same reason the matrix keys submissions that way: officers circulate into each
 * other schools constantly, and keying on the assigner made real results vanish
 * from the officer whose numbers they belong to.
 */
const SUBMITTED = applicationSubmittedSql({
  submittedAt: 'COALESCE(gp.submitted_at, ca.submitted_at)', assignmentStatus: 'ca.status::text', proposalStatus: 'gp.status', outcome: 'ca.outcome::text',
})

async function workForSchools(
  tenantId: string,
  schoolIds: string[],
  window: ActivityWindow,
  unansweredDays: number
): Promise<WorkRow[]> {
  if (schoolIds.length === 0) return []
  const roots = textArray(schoolIds)
  return prisma.$queryRaw<WorkRow[]>(Prisma.sql`
    SELECT root.school_id,
           COUNT(*)::int AS allocated,
           -- The shared submission rule (reportDefinitions), so this conversion
           -- rate and the management report count the same submissions.
           COUNT(*) FILTER (WHERE ${SUBMITTED})::int AS submitted,
           COUNT(*) FILTER (WHERE ca.status = 'DECLINED')::int AS declined,
           COUNT(*) FILTER (
             WHERE ca.status = 'ASSIGNED'
               AND ca.responded_at IS NULL
               AND ca.created_at < now() - ${safeDays(unansweredDays)}
           )::int AS unanswered,
           COUNT(*) FILTER (WHERE ca.status = 'LAPSED')::int AS lapsed
      FROM call_assignments ca
      LEFT JOIN grant_proposals gp ON gp.assignment_id = ca.id AND gp.tenant_id = ca.tenant_id
      JOIN LATERAL (
        SELECT unnest(u.path) AS school_id FROM tenant_org_units u WHERE u.id = ca.assignee_org_unit_id
      ) root ON root.school_id = ANY(${roots})
     WHERE ca.tenant_id = ${tenantId}
       AND ca.created_at BETWEEN ${window.start} AND ${window.end}
     GROUP BY root.school_id
  `)
}

/** The last `weeks` untouched-backlog snapshots per school, oldest first. */
async function trendForSchools(
  tenantId: string,
  schoolIds: string[],
  weeks: number
): Promise<{ weekStarts: string[]; bySchool: Map<string, number[]> }> {
  const bySchool = new Map<string, number[]>()
  if (schoolIds.length === 0 || weeks <= 0) return { weekStarts: [], bySchool }

  const rows = await prisma.fundingDeptWeeklySnapshot.findMany({
    where: { tenant_id: tenantId, org_unit_id: { in: schoolIds } },
    select: { week_start: true, org_unit_id: true, untouched_pending: true },
    orderBy: { week_start: 'desc' },
    // Generous: a tenant with thirty schools needs thirty rows per week, and
    // trimming to the newest weeks happens below once we know which they are.
    take: weeks * Math.max(schoolIds.length, 1),
  })

  const weekStarts = Array.from(
    new Set(rows.map((row) => row.week_start.toISOString().slice(0, 10)))
  )
    .sort()
    .slice(-weeks)
  const index = new Map(weekStarts.map((week, position) => [week, position]))

  for (const schoolId of schoolIds) bySchool.set(schoolId, weekStarts.map(() => 0))
  for (const row of rows) {
    const position = index.get(row.week_start.toISOString().slice(0, 10))
    if (position === undefined) continue
    const series = bySchool.get(row.org_unit_id)
    if (series) series[position] = row.untouched_pending
  }
  return { weekStarts, bySchool }
}

/** Sum two trend series position by position, for a member rollup. */
function addSeries(into: number[], from: number[]): number[] {
  if (into.length === 0) return [...from]
  return into.map((value, position) => value + (from[position] ?? 0))
}

export async function getOfficerEfficiency(
  tenantId: string,
  options: {
    window: ActivityWindow
    memberIds?: string[]
    schoolIds?: string[]
    /** How many weeks of history to return. Zero skips the snapshot read entirely. */
    weeks?: number
    now?: Date
    settings?: DeptSettings
  }
): Promise<OfficerEfficiency> {
  const now = options.now ?? new Date()
  const settings = options.settings ?? (await getDeptSettings(tenantId))
  const weeks = options.weeks ?? 8

  const allMembers = await listMembers(tenantId)
  const members = options.memberIds
    ? allMembers.filter((member) => options.memberIds!.includes(member.id))
    : allMembers

  const reachBySchool = new Map<string, string[]>()
  for (const member of members) {
    const serialized = serializeMember(member)
    for (const schoolId of memberReachSchoolIds(serialized)) {
      if (options.schoolIds && !options.schoolIds.includes(schoolId)) continue
      const existing = reachBySchool.get(schoolId)
      if (existing) existing.push(member.id)
      else reachBySchool.set(schoolId, [member.id])
    }
  }
  const schoolIds = Array.from(reachBySchool.keys())

  const schools = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: tenantId, id: { in: schoolIds.length > 0 ? schoolIds : ['__none__'] } },
    select: { id: true, name: true },
  })
  const nameOf = new Map(schools.map((school) => [school.id, school.name]))

  // Every school once, then fanned out to the members who answer for it. Never
  // per member x per school — the query explosion the sibling services avoid.
  const [timings, decisions, work, trend] = await Promise.all([
    timingsForSchools(tenantId, schoolIds, options.window),
    decisionsForSchools(tenantId, schoolIds, options.window),
    workForSchools(tenantId, schoolIds, options.window, settings.unansweredDays),
    trendForSchools(tenantId, schoolIds, weeks),
  ])
  const timingOf = new Map(timings.map((row) => [row.school_id, row]))
  const decisionOf = new Map(decisions.map((row) => [row.school_id, row]))
  const workOf = new Map(work.map((row) => [row.school_id, row]))

  const schoolRowFor = (schoolId: string): EfficiencySchoolRow => {
    const timing = timingOf.get(schoolId)
    const decision = decisionOf.get(schoolId)
    const done = workOf.get(schoolId)
    return {
      schoolId,
      schoolName: nameOf.get(schoolId) ?? schoolId,
      callsArrived: timing?.calls_arrived ?? 0,
      medianFirstTouchDays: round1(timing?.median_first_touch ?? null),
      neverTouched: timing?.never_touched ?? 0,
      medianAllocateDays: round1(timing?.median_allocate ?? null),
      decided: decision?.decided ?? 0,
      dismissed: decision?.dismissed ?? 0,
      dismissedWithoutNote: decision?.dismissed_without_note ?? 0,
      allocated: done?.allocated ?? 0,
      submitted: done?.submitted ?? 0,
      declined: done?.declined ?? 0,
      unanswered: done?.unanswered ?? 0,
      lapsed: done?.lapsed ?? 0,
      trend: trend.bySchool.get(schoolId) ?? [],
    }
  }

  const memberRows: EfficiencyMemberRow[] = members.map((member) => {
    const serialized = serializeMember(member)
    const mine = memberReachSchoolIds(serialized).filter(
      (schoolId) => !options.schoolIds || options.schoolIds.includes(schoolId)
    )
    const rows = mine.map(schoolRowFor)

    const sum = (read: (row: EfficiencySchoolRow) => number) =>
      rows.reduce((total, row) => total + read(row), 0)

    // A median of medians is not a median, so the member figure is the median of
    // the school figures that exist — stated as such rather than presented as a
    // recomputation over the underlying calls.
    const medianOf = (read: (row: EfficiencySchoolRow) => number | null) => {
      const values = rows.map(read).filter((value): value is number => value !== null).sort((a, b) => a - b)
      if (values.length === 0) return null
      const middle = Math.floor(values.length / 2)
      return round1(
        values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2
      )
    }

    const allocated = sum((row) => row.allocated)
    const decided = sum((row) => row.decided)
    const dismissed = sum((row) => row.dismissed)
    const submitted = sum((row) => row.submitted)

    return {
      memberId: member.id,
      userId: member.user_id,
      name: member.user?.name ?? null,
      email: member.user?.email ?? null,
      isHead: member.is_head,
      isAway: isMemberAway(member, now),
      schools: rows.sort(
        (left, right) =>
          (right.medianFirstTouchDays ?? -1) - (left.medianFirstTouchDays ?? -1) ||
          left.schoolName.localeCompare(right.schoolName)
      ),
      totals: {
        callsArrived: sum((row) => row.callsArrived),
        neverTouched: sum((row) => row.neverTouched),
        medianFirstTouchDays: medianOf((row) => row.medianFirstTouchDays),
        medianAllocateDays: medianOf((row) => row.medianAllocateDays),
        decided,
        dismissed,
        dismissedWithoutNote: sum((row) => row.dismissedWithoutNote),
        allocated,
        submitted,
        declined: sum((row) => row.declined),
        unanswered: sum((row) => row.unanswered),
        lapsed: sum((row) => row.lapsed),
        conversionPct: allocated > 0 ? Math.round((submitted / allocated) * 100) : null,
        dismissalPct: decided > 0 ? Math.round((dismissed / decided) * 100) : null,
      },
      flags: computeFlags(
        {
          // The level flags belong to the grid, which counts them against the
          // live queue. Zeroed here so this row says only what this report can
          // actually measure, rather than repeating a figure it never read.
          untouchedPending: 0,
          overdueUnchased: 0,
          goneQuiet: 0,
          dueNudges: 0,
          live: allocated,
          actionsInWindow: decided + allocated,
          medianFirstTouchDays: medianOf((row) => row.medianFirstTouchDays),
          decidedInWindow: decided,
          dismissedInWindow: dismissed,
          submittedInWindow: submitted,
          isAway: isMemberAway(member, now),
        },
        {
          untouchedDays: settings.untouchedDays,
          silentDays: settings.silentDays,
          firstTouchTargetDays: settings.firstTouchTargetDays,
          dismissalRateWarnPct: settings.dismissalRateWarnPct,
        }
      ).flags,
      trend: rows.reduce<number[]>((into, row) => addSeries(into, row.trend), []),
    }
  })

  // Slowest to react first, then most never looked at. An away member sorts last
  // whatever their numbers: their figures are shown, but they are not the person
  // to go and ask about them this week.
  memberRows.sort((left, right) => {
    if (left.isAway !== right.isAway) return left.isAway ? 1 : -1
    return (
      (right.totals.medianFirstTouchDays ?? -1) - (left.totals.medianFirstTouchDays ?? -1) ||
      right.totals.neverTouched - left.totals.neverTouched
    )
  })

  return {
    window: options.window,
    firstTouchTargetDays: settings.firstTouchTargetDays,
    dismissalRateWarnPct: settings.dismissalRateWarnPct,
    trendWeeks: trend.weekStarts,
    members: memberRows,
  }
}

const CSV_COLUMNS: Array<[string, (row: EfficiencyMemberRow, school: EfficiencySchoolRow) => unknown]> =
  [
    ['Officer', (row) => row.name || row.email || ''],
    ['On leave', (row) => (row.isAway ? 'yes' : 'no')],
    ['School', (_row, school) => school.schoolName],
    ['Calls arrived', (_row, school) => school.callsArrived],
    ['Never looked at', (_row, school) => school.neverTouched],
    ['Median days to first look', (_row, school) => school.medianFirstTouchDays ?? ''],
    ['Median days to allocate', (_row, school) => school.medianAllocateDays ?? ''],
    ['Decisions', (_row, school) => school.decided],
    ['Dismissed', (_row, school) => school.dismissed],
    ['Dismissed with no note', (_row, school) => school.dismissedWithoutNote],
    ['Allocated', (_row, school) => school.allocated],
    ['Submitted', (_row, school) => school.submitted],
    ['Declined', (_row, school) => school.declined],
    ['Still unanswered', (_row, school) => school.unanswered],
    ['Closed as not applied for', (_row, school) => school.lapsed],
  ]

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One row per (officer, school), which is the grain the numbers are computed at. */
export function efficiencyToCsv(members: EfficiencyMemberRow[]) {
  const lines = [CSV_COLUMNS.map(([heading]) => csvCell(heading)).join(',')]
  for (const member of members) {
    for (const school of member.schools) {
      lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(member, school))).join(','))
    }
  }
  return `${lines.join('\n')}\n`
}
