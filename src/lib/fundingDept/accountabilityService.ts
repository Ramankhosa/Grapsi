/**
 * The department read sideways: member -> school -> call -> allocation.
 *
 * Every number the department already produces is a total. A head can see that
 * eleven things are overdue and that Priya has four schools, but not which of
 * Priya's schools the overdue work is in, nor whether the calls nobody took up
 * were ever looked at. That gap is where accountability lives, so this module
 * exists to answer three questions in the words a head actually uses:
 *
 *   1. For the schools each member covers: how many relevant calls, how many
 *      allocated and to whom, how many still pending?
 *   2. For each allocation: where has it got to, and when did anyone last
 *      touch it?
 *   3. Who is not doing the job — with the countable fact next to the name.
 *
 * Composition rules, learned from the overview endpoint: the funnel is computed
 * once per school and the activity once per member, then fanned out in memory.
 * Never per member x per school — that is the query explosion the existing
 * services carefully avoid.
 */

import { getSummary } from '@/lib/assignments/dashboardService'
import { loadUnitAreaProfile, relevantCallWhereSql } from '@/lib/funding/callUnitRelevance'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { getReportingPeriod } from '@/lib/tenant/reportingPeriod'

import {
  UNANSWERED_DAYS,
  addToBuckets,
  deriveAssignmentProgress,
  emptyBuckets,
  type AssignmentProgress,
  type ProgressBuckets,
} from './accountabilityProgress'
import {
  DEFAULT_THRESHOLDS,
  computeFlags,
  sumFlagInputs,
  type AccountabilityFlag,
  type FlagInput,
} from './accountabilityFlags'
import { listMembers } from './membershipService'
import { queueStateFor, type QueueState } from './queueState'
import { getSchoolFunnel, type SchoolFunnelRow } from './schoolFunnelService'
import { isMemberAway, serializeMember } from './shared'

/* -------------------------------------------------------------------------- */
/* The activity window                                                        */
/* -------------------------------------------------------------------------- */

export interface ActivityWindow {
  start: Date
  end: Date
  label: string
  key: 'reporting' | '30d' | '90d'
}

/**
 * Which window activity is counted over.
 *
 * Pendency and allocation counts are deliberately NOT windowed — "how many
 * calls are sitting untouched right now" is a snapshot, and making it swing
 * with a date filter would turn a fact into an artefact of the filter. Only
 * things people DID (notes logged, calls circulated, submissions recorded) are
 * counted inside the window.
 */
export async function resolveActivityWindow(
  tenantId: string,
  key: string | null | undefined,
  now: Date = new Date()
): Promise<ActivityWindow> {
  if (key === '30d' || key === '90d') {
    const days = key === '30d' ? 30 : 90
    return {
      start: new Date(now.getTime() - days * 86400000),
      end: now,
      label: `Last ${days} days`,
      key,
    }
  }
  const period = await getReportingPeriod(tenantId)
  return { start: period.start, end: period.end, label: period.label, key: 'reporting' }
}

/* -------------------------------------------------------------------------- */
/* Member x school matrix                                                     */
/* -------------------------------------------------------------------------- */

export interface MatrixSchoolRow {
  schoolId: string
  name: string
  code: string | null
  /** Whether this member holds the school on the rota, or covers as deputy. */
  role: 'primary' | 'deputy'
  isUnmapped: boolean
  /* Point-in-time funnel — never windowed. */
  relevantOpen: number
  pending: number
  untouchedPending: number
  shortlisted: number
  assignedCalls: number
  /* Allocations in this school, by where they have got to. */
  buckets: ProgressBuckets
  live: number
  awardAmount: number
  /* Windowed activity, attributed to THIS member. */
  followUpsInWindow: number
  callsCirculatedInWindow: number
  triageDecisionsInWindow: number
  /** Applications that went in from this school inside the window. */
  submittedInWindow: number
  dueNudges: number
  lastActionAt: Date | null
  lastActorName: string | null
  flags: AccountabilityFlag[]
  score: number
}

export interface MatrixMemberRow {
  id: string
  userId: string
  name: string | null
  email: string | null
  isHead: boolean
  isAway: boolean
  title: string | null
  awayUntil: Date | string | null
  schoolCount: number
  deputyCount: number
  totals: {
    relevantOpen: number
    pending: number
    untouchedPending: number
    allocated: number
    live: number
    buckets: ProgressBuckets
    followUpsInWindow: number
    callsCirculatedInWindow: number
    submittedInWindow: number
    dueNudges: number
    awardAmount: number
  }
  lastActionAt: Date | null
  flags: AccountabilityFlag[]
  score: number
  schools: MatrixSchoolRow[]
}

export interface MemberSchoolMatrix {
  window: ActivityWindow
  thresholds: typeof DEFAULT_THRESHOLDS
  members: MatrixMemberRow[]
  /** Schools nobody covers — they belong to no member, so they need their own row. */
  uncovered: Array<{
    schoolId: string
    name: string
    code: string | null
    relevantOpen: number
    pending: number
    untouchedPending: number
    live: number
    isUnmapped: boolean
    lastContactAt: Date | null
    flags: AccountabilityFlag[]
  }>
  totals: {
    members: number
    schools: number
    uncovered: number
    pending: number
    untouchedPending: number
    live: number
    goneQuiet: number
    overdueUnchased: number
    submittedInWindow: number
    flaggedMembers: number
  }
}

interface AllocationRow {
  assignment_id: string
  school_id: string
  assignee_user_id: string
  assigned_by_user_id: string
  status: string
  outcome: string
  deadline_at: Date | null
  responded_at: Date | null
  submitted_at: Date | null
  created_at: Date
  award_amount: number | null
  last_follow_up_at: Date | null
  last_stage: string | null
  has_workspace: boolean
  proposal_status: string | null
  proposal_activity_at: Date | null
}

// Interval literals cannot be parameterised, and a bound integer arrives as
// bigint which make_interval() rejects. A constant from our own source, so raw.
const UNANSWERED_INTERVAL = Prisma.raw(`INTERVAL '${UNANSWERED_DAYS} days'`)

function textArray(values: string[]): Prisma.Sql {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}`))}]::text[]`
}

/**
 * Every allocation landing in the given schools, with the two facts the
 * assignment row cannot carry: when the department last logged anything about
 * it, and whether the assignee has actually opened a proposal workspace.
 *
 * One query for the whole department. Bucketing to schools happens on the
 * assignee's unit path, so a call assigned to a department rolls up to its
 * school exactly the way the funnel counts it.
 */
async function loadAllocations(tenantId: string, schoolIds: string[]): Promise<AllocationRow[]> {
  if (schoolIds.length === 0) return []
  const schools = textArray(schoolIds)

  return prisma.$queryRaw<AllocationRow[]>(Prisma.sql`
    SELECT
      ca.id                       AS assignment_id,
      root.school_id              AS school_id,
      ca.assignee_user_id,
      ca.assigned_by_user_id,
      ca.status::text             AS status,
      ca.outcome::text            AS outcome,
      ca.deadline_at,
      ca.responded_at,
      ca.submitted_at,
      ca.created_at,
      ca.award_amount,
      fu.last_follow_up_at,
      fu.last_stage,
      EXISTS (
        SELECT 1 FROM grant_sessions gs
         WHERE gs."fundingCallId" = ca.funding_call_id
           AND gs."createdByUserId" = ca.assignee_user_id
           AND gs."tenantId" = ca.tenant_id
      ) AS has_workspace,
      -- The proposal desk's record for this allocation, if one was opened.
      -- The activity timestamp is what stops a researcher who is uploading
      -- revisions every week from reading as silent.
      pr.status AS proposal_status,
      pr.updated_at AS proposal_activity_at
    FROM call_assignments ca
    JOIN LATERAL (
      SELECT unnest(u.path) AS school_id
        FROM tenant_org_units u
       WHERE u.id = ca.assignee_org_unit_id
    ) root ON root.school_id = ANY(${schools})
    LEFT JOIN LATERAL (
      SELECT f.happened_at AS last_follow_up_at,
             (SELECT s.stage FROM assignment_follow_ups s
               WHERE s.assignment_id = ca.id AND s.stage IS NOT NULL
               ORDER BY s.happened_at DESC LIMIT 1) AS last_stage
        FROM assignment_follow_ups f
       WHERE f.assignment_id = ca.id
       ORDER BY f.happened_at DESC
       LIMIT 1
    ) fu ON TRUE
    LEFT JOIN grant_proposals pr ON pr.assignment_id = ca.id
    WHERE ca.tenant_id = ${tenantId}
  `)
}

/** Windowed counts of what each person actually did, keyed by school. */
async function loadActivity(
  tenantId: string,
  schoolIds: string[],
  window: ActivityWindow
): Promise<{
  followUps: Map<string, number>
  circulated: Map<string, number>
  triage: Map<string, number>
  submitted: Map<string, number>
  dueNudges: Map<string, number>
  lastAction: Map<string, { at: Date; name: string | null }>
}> {
  const empty = {
    followUps: new Map<string, number>(),
    circulated: new Map<string, number>(),
    triage: new Map<string, number>(),
    submitted: new Map<string, number>(),
    dueNudges: new Map<string, number>(),
    lastAction: new Map<string, { at: Date; name: string | null }>(),
  }
  if (schoolIds.length === 0) return empty
  const schools = textArray(schoolIds)

  // The school an activity row belongs to is always resolved through the unit
  // path, so a note written against a department counts for its school.
  const schoolOf = (column: Prisma.Sql) => Prisma.sql`(
    SELECT unnest(u.path) FROM tenant_org_units u WHERE u.id = ${column}
    INTERSECT SELECT unnest(${schools})
    LIMIT 1
  )`

  const [followUps, circulated, triage, submitted, dueNudges, lastAction] = await Promise.all([
    prisma.$queryRaw<Array<{ key: string; count: number }>>(Prisma.sql`
      SELECT ${schoolOf(Prisma.sql`f.org_unit_id`)} || ':' || f.created_by_user_id AS key,
             COUNT(*)::int AS count
        FROM assignment_follow_ups f
       WHERE f.tenant_id = ${tenantId}
         AND f.happened_at BETWEEN ${window.start} AND ${window.end}
         AND ${schoolOf(Prisma.sql`f.org_unit_id`)} IS NOT NULL
       GROUP BY 1
    `),
    prisma.$queryRaw<Array<{ key: string; count: number }>>(Prisma.sql`
      SELECT ${schoolOf(Prisma.sql`ca.assignee_org_unit_id`)} || ':' || ca.assigned_by_user_id AS key,
             COUNT(*)::int AS count
        FROM call_assignments ca
       WHERE ca.tenant_id = ${tenantId}
         AND ca.created_at BETWEEN ${window.start} AND ${window.end}
         AND ${schoolOf(Prisma.sql`ca.assignee_org_unit_id`)} IS NOT NULL
       GROUP BY 1
    `),
    prisma.$queryRaw<Array<{ key: string; count: number }>>(Prisma.sql`
      SELECT t.org_unit_id || ':' || t.decided_by_user_id AS key, COUNT(*)::int AS count
        FROM call_school_triage t
       WHERE t.tenant_id = ${tenantId}
         AND t.decided_by_user_id IS NOT NULL
         AND t.decided_at BETWEEN ${window.start} AND ${window.end}
         AND t.org_unit_id = ANY(${schools})
       GROUP BY 1
    `),
    // Keyed by SCHOOL, not by who circulated the call. A submission out of your
    // school is your school's result whoever sent the call out — and heads and
    // colleagues circulate into each other's schools all the time, so keying
    // this by assigner made real submissions vanish from the officer whose
    // numbers they belong to.
    prisma.$queryRaw<Array<{ key: string; count: number }>>(Prisma.sql`
      SELECT ${schoolOf(Prisma.sql`ca.assignee_org_unit_id`)} AS key,
             COUNT(*)::int AS count
        FROM call_assignments ca
       WHERE ca.tenant_id = ${tenantId}
         AND ca.submitted_at BETWEEN ${window.start} AND ${window.end}
         AND ${schoolOf(Prisma.sql`ca.assignee_org_unit_id`)} IS NOT NULL
       GROUP BY 1
    `),
    // Reminders that fell due and were never sent. Not windowed: a nudge that
    // went stale last quarter is still not done.
    prisma.$queryRaw<Array<{ key: string; count: number }>>(Prisma.sql`
      SELECT ${schoolOf(Prisma.sql`f.org_unit_id`)} || ':' || f.created_by_user_id AS key,
             COUNT(*)::int AS count
        FROM assignment_follow_ups f
       WHERE f.tenant_id = ${tenantId}
         AND f.reminder_sent_at IS NULL
         AND f.remind_at IS NOT NULL
         AND f.remind_at <= now()
         AND ${schoolOf(Prisma.sql`f.org_unit_id`)} IS NOT NULL
       GROUP BY 1
    `),
    // The last thing anyone did in each school, and who did it. Not windowed —
    // "last touched in March" is precisely what a narrow window would hide.
    prisma.$queryRaw<Array<{ school_id: string; at: Date; name: string | null }>>(Prisma.sql`
      SELECT DISTINCT ON (school_id) school_id, happened_at AS at, name
        FROM (
          SELECT ${schoolOf(Prisma.sql`f.org_unit_id`)} AS school_id,
                 f.happened_at,
                 COALESCE(u.name, u.email) AS name
            FROM assignment_follow_ups f
            LEFT JOIN users u ON u.id = f.created_by_user_id
           WHERE f.tenant_id = ${tenantId}
        ) rows
       WHERE school_id IS NOT NULL
       ORDER BY school_id, happened_at DESC
    `),
  ])

  const toMap = (rows: Array<{ key: string; count: number }>) =>
    new Map(rows.filter((row) => row.key).map((row) => [row.key, row.count]))

  return {
    followUps: toMap(followUps),
    circulated: toMap(circulated),
    triage: toMap(triage),
    submitted: toMap(submitted),
    dueNudges: toMap(dueNudges),
    lastAction: new Map(
      lastAction.map((row) => [row.school_id, { at: row.at, name: row.name }])
    ),
  }
}

/**
 * The department as a grid.
 *
 * A school appears under every member who answers for it — the officer on the
 * rota and anyone deputising — because during leave the deputy is doing the
 * work and must be able to see it. Activity is attributed to whoever wrote the
 * row, never to "the member for that school", so cover shows up as the
 * deputy's work rather than silently flattering the primary.
 */
export async function getMemberSchoolMatrix(
  tenantId: string,
  options: {
    window: ActivityWindow
    /** Clamp to these members (a plain member sees only themselves). */
    memberIds?: string[]
    /** Clamp to these schools (a plain member sees only their own reach). */
    schoolIds?: string[]
    now?: Date
  }
): Promise<MemberSchoolMatrix> {
  const now = options.now ?? new Date()
  const allMembers = await listMembers(tenantId)
  const members = options.memberIds
    ? allMembers.filter((member) => options.memberIds!.includes(member.id))
    : allMembers

  const coveredSchoolIds = new Set<string>()
  for (const member of members) {
    for (const row of member.school_assignments) {
      if (!options.schoolIds || options.schoolIds.includes(row.org_unit_id)) {
        coveredSchoolIds.add(row.org_unit_id)
      }
    }
  }

  // Uncovered schools only belong on an unclamped (head or admin) view: a
  // member asking about their own work should not be shown the whole tenant.
  const showUncovered = !options.memberIds && !options.schoolIds
  const funnelScope = showUncovered ? undefined : Array.from(coveredSchoolIds)
  const funnel = showUncovered
    ? await getSchoolFunnel(tenantId)
    : funnelScope && funnelScope.length > 0
      ? await getSchoolFunnel(tenantId, funnelScope)
      : []
  const funnelBySchool = new Map(funnel.map((row) => [row.schoolId, row]))

  const schoolIds = Array.from(new Set([...coveredSchoolIds, ...funnel.map((r) => r.schoolId)]))
  const [allocations, activity] = await Promise.all([
    loadAllocations(tenantId, schoolIds),
    loadActivity(tenantId, schoolIds, options.window),
  ])

  // Allocations grouped by (school, assigner) and by school, so a member's row
  // can show what they circulated while the school row shows everything that
  // landed there whoever sent it.
  const bySchool = new Map<string, AllocationRow[]>()
  for (const row of allocations) {
    const list = bySchool.get(row.school_id)
    if (list) list.push(row)
    else bySchool.set(row.school_id, [row])
  }

  const progressCache = new Map<string, AssignmentProgress>()
  const progressFor = (row: AllocationRow): AssignmentProgress => {
    const cached = progressCache.get(row.assignment_id)
    if (cached) return cached
    const progress = deriveAssignmentProgress(
      row,
      row.last_follow_up_at ? { happened_at: row.last_follow_up_at, stage: row.last_stage } : null,
      row.has_workspace,
      now,
      row.proposal_status
        ? { status: row.proposal_status, latestActivityAt: row.proposal_activity_at }
        : null
    )
    progressCache.set(row.assignment_id, progress)
    return progress
  }

  const buildSchoolRow = (
    schoolId: string,
    role: 'primary' | 'deputy',
    memberUserId: string,
    funnelRow: SchoolFunnelRow | undefined,
    isAway: boolean
  ): MatrixSchoolRow => {
    const rows = bySchool.get(schoolId) || []
    const buckets = emptyBuckets()
    let awardAmount = 0
    for (const row of rows) {
      const progress = progressFor(row)
      addToBuckets(buckets, progress)
      if (String(row.outcome).toUpperCase() === 'AWARDED') awardAmount += row.award_amount || 0
    }
    const live = buckets.awaitingReply + buckets.inHand + buckets.drafting + buckets.overdue
    const key = `${schoolId}:${memberUserId}`
    const followUpsInWindow = activity.followUps.get(key) ?? 0
    const callsCirculatedInWindow = activity.circulated.get(key) ?? 0
    const triageDecisionsInWindow = activity.triage.get(key) ?? 0
    const submittedInWindow = activity.submitted.get(schoolId) ?? 0
    const dueNudges = activity.dueNudges.get(key) ?? 0
    const last = activity.lastAction.get(schoolId) ?? null

    const flagInput: FlagInput = {
      untouchedPending: funnelRow?.untouchedPending ?? 0,
      overdueUnchased: buckets.overdueUnchased,
      goneQuiet: buckets.goneQuiet,
      dueNudges,
      live,
      actionsInWindow: followUpsInWindow + callsCirculatedInWindow + triageDecisionsInWindow,
      isUnmapped: funnelRow?.isUnmapped ?? false,
      isAway,
    }
    const { flags, score } = computeFlags(flagInput)

    return {
      schoolId,
      name: funnelRow?.name ?? schoolId,
      code: funnelRow?.code ?? null,
      role,
      isUnmapped: funnelRow?.isUnmapped ?? false,
      relevantOpen: funnelRow?.relevantOpen ?? 0,
      pending: funnelRow?.pending ?? 0,
      untouchedPending: funnelRow?.untouchedPending ?? 0,
      shortlisted: funnelRow?.shortlisted ?? 0,
      assignedCalls: funnelRow?.assignedCalls ?? 0,
      buckets,
      live,
      awardAmount,
      followUpsInWindow,
      callsCirculatedInWindow,
      triageDecisionsInWindow,
      submittedInWindow,
      dueNudges,
      lastActionAt: last?.at ?? null,
      lastActorName: last?.name ?? null,
      flags,
      score,
    }
  }

  const memberRows: MatrixMemberRow[] = members.map((member) => {
    const serialized = serializeMember(member)
    const isAway = isMemberAway(member, now)

    const schools: MatrixSchoolRow[] = []
    for (const school of serialized.schools) {
      if (options.schoolIds && !options.schoolIds.includes(school.id)) continue
      schools.push(
        buildSchoolRow(school.id, 'primary', member.user_id, funnelBySchool.get(school.id), isAway)
      )
    }
    for (const school of serialized.deputySchools) {
      if (options.schoolIds && !options.schoolIds.includes(school.id)) continue
      schools.push(
        buildSchoolRow(school.id, 'deputy', member.user_id, funnelBySchool.get(school.id), isAway)
      )
    }
    schools.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))

    const totals = {
      relevantOpen: 0,
      pending: 0,
      untouchedPending: 0,
      allocated: 0,
      live: 0,
      buckets: emptyBuckets(),
      followUpsInWindow: 0,
      callsCirculatedInWindow: 0,
      submittedInWindow: 0,
      dueNudges: 0,
      awardAmount: 0,
    }
    let lastActionAt: Date | null = null
    for (const school of schools) {
      totals.relevantOpen += school.relevantOpen
      totals.pending += school.pending
      totals.untouchedPending += school.untouchedPending
      totals.allocated += school.assignedCalls
      totals.live += school.live
      totals.followUpsInWindow += school.followUpsInWindow
      totals.callsCirculatedInWindow += school.callsCirculatedInWindow
      totals.submittedInWindow += school.submittedInWindow
      totals.dueNudges += school.dueNudges
      totals.awardAmount += school.awardAmount
      for (const key of Object.keys(totals.buckets) as Array<keyof ProgressBuckets>) {
        totals.buckets[key] += school.buckets[key]
      }
      if (school.lastActionAt && (!lastActionAt || school.lastActionAt > lastActionAt)) {
        lastActionAt = school.lastActionAt
      }
    }

    const { flags, score } = computeFlags(
      sumFlagInputs(
        schools.map((school) => ({
          untouchedPending: school.untouchedPending,
          overdueUnchased: school.buckets.overdueUnchased,
          goneQuiet: school.buckets.goneQuiet,
          dueNudges: school.dueNudges,
          live: school.live,
          actionsInWindow:
            school.followUpsInWindow +
            school.callsCirculatedInWindow +
            school.triageDecisionsInWindow,
        })),
        { isAway }
      )
    )

    return {
      id: serialized.id,
      userId: serialized.userId,
      name: serialized.name,
      email: serialized.email,
      isHead: serialized.isHead,
      isAway,
      title: serialized.title,
      awayUntil: serialized.awayUntil,
      schoolCount: serialized.schools.length,
      deputyCount: serialized.deputySchools.length,
      totals,
      lastActionAt,
      flags,
      score,
      schools,
    }
  })

  // Worst first: this page exists to be read from the top.
  memberRows.sort(
    (left, right) =>
      right.score - left.score || (left.name || '').localeCompare(right.name || '')
  )

  const coveredEverywhere = new Set<string>()
  for (const member of allMembers) {
    for (const row of member.school_assignments) coveredEverywhere.add(row.org_unit_id)
  }
  const uncovered = showUncovered
    ? funnel
        .filter((row) => !coveredEverywhere.has(row.schoolId))
        .map((row) => ({
          schoolId: row.schoolId,
          name: row.name,
          code: row.code,
          relevantOpen: row.relevantOpen,
          pending: row.pending,
          untouchedPending: row.untouchedPending,
          live: row.live,
          isUnmapped: row.isUnmapped,
          lastContactAt: row.lastContactAt,
          flags: computeFlags({
            untouchedPending: row.untouchedPending,
            overdueUnchased: 0,
            goneQuiet: 0,
            dueNudges: 0,
            live: row.live,
            actionsInWindow: 1,
            isUnmapped: row.isUnmapped,
            isUncovered: true,
          }).flags,
        }))
    : []

  return {
    window: options.window,
    thresholds: DEFAULT_THRESHOLDS,
    members: memberRows,
    uncovered,
    totals: {
      members: memberRows.length,
      schools: schoolIds.length,
      uncovered: uncovered.length,
      pending: memberRows.reduce((sum, row) => sum + row.totals.pending, 0),
      untouchedPending: memberRows.reduce((sum, row) => sum + row.totals.untouchedPending, 0),
      live: memberRows.reduce((sum, row) => sum + row.totals.live, 0),
      goneQuiet: memberRows.reduce((sum, row) => sum + row.totals.buckets.goneQuiet, 0),
      overdueUnchased: memberRows.reduce(
        (sum, row) => sum + row.totals.buckets.overdueUnchased,
        0
      ),
      submittedInWindow: memberRows.reduce((sum, row) => sum + row.totals.submittedInWindow, 0),
      flaggedMembers: memberRows.filter((row) => row.score > 0).length,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* One school's call ledger                                                   */
/* -------------------------------------------------------------------------- */

export interface LedgerAllocation {
  id: string
  assignee: { id: string; name: string | null; email: string | null }
  assignedBy: { id: string; name: string | null } | null
  status: string
  outcome: string
  deadlineAt: Date | null
  progress: AssignmentProgress
  lastFollowUpAt: Date | null
  lastFollowUpKind: string | null
  /** Officer lens only; stripped for a Dean by `redactLedgerForSchoolHead`. */
  lastFollowUpNote: string | null
  followUpCount: number
  submittedAt: Date | null
  submissionReference: string | null
  /**
   * The proposal record behind this allocation, when the applicant has opened
   * one. Null is a real answer — plenty of assignments never become a proposal
   * — so the ledger says "no record" rather than implying one is missing.
   */
  proposal: { id: string; status: string; versionNo: number } | null
}

export interface LedgerCall {
  callId: string
  title: string | null
  agencyName: string | null
  closesAt: Date | null
  publishedAt: Date | null
  daysSincePublished: number | null
  queueState: QueueState
  triageStatus: string
  triageDecidedBy: string | null
  triageDecidedAt: Date | null
  lastActionAt: Date | null
  lastActorName: string | null
  isUntouched: boolean
  allocations: LedgerAllocation[]
}

export interface SchoolCallLedger {
  school: { id: string; name: string; code: string | null; isUnmapped: boolean }
  window: ActivityWindow
  counts: Record<QueueState, number> & { total: number; untouched: number }
  attention: { goneQuiet: number; overdueUnchased: number; awaitingReply: number; submitted: number }
  calls: LedgerCall[]
}

/**
 * Every call this school could apply for, and what has happened about each.
 *
 * The queue state comes from the shared ladder, so a head reading this and an
 * officer reading their own queue tabs see the same partition. Closed calls
 * still appear when work is live or was submitted against them — an application
 * in flight does not stop mattering because the call shut.
 */
export async function getSchoolCallLedger(
  tenantId: string,
  schoolId: string,
  options: { window: ActivityWindow; now?: Date }
): Promise<SchoolCallLedger> {
  const now = options.now ?? new Date()

  const school = await prisma.tenantOrgUnit.findFirst({
    where: { id: schoolId, tenant_id: tenantId },
    select: { id: true, name: true, code: true },
  })
  if (!school) throw new Error('School not found')

  const subtree = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM tenant_org_units
     WHERE tenant_id = ${tenantId} AND is_active = true AND path && ${textArray([schoolId])}
  `)
  const scopeIds = subtree.length > 0 ? subtree.map((row) => row.id) : [schoolId]
  const scopeArray = textArray(scopeIds)

  const profile = await loadUnitAreaProfile(tenantId, [schoolId])
  const relevant = relevantCallWhereSql(profile, 'fc')

  const callRows = await prisma.$queryRaw<
    Array<{
      call_id: string
      title: string | null
      agency_name: string | null
      closes_at: Date | null
      published_at: Date | null
      triage_status: string | null
      triage_decided_at: Date | null
      triage_decided_by: string | null
      live_assignments: number
      last_action_at: Date | null
      last_actor_name: string | null
    }>
  >(Prisma.sql`
    SELECT fc.id                                              AS call_id,
           COALESCE(fc.scheme_title, fc.title)                AS title,
           COALESCE(fc.agency_name, fc."agencyName")          AS agency_name,
           COALESCE(fc.close_date, fc."deadlineAt")           AS closes_at,
           COALESCE(fc."publishedAt", fc."createdAt")          AS published_at,
           tri.status                                         AS triage_status,
           tri.decided_at                                     AS triage_decided_at,
           COALESCE(du.name, du.email)                        AS triage_decided_by,
           (
             SELECT COUNT(*)::int FROM call_assignments ca
              WHERE ca.funding_call_id = fc.id
                AND ca.tenant_id = ${tenantId}
                AND ca.status NOT IN ('CANCELLED', 'DECLINED')
                AND ca.assignee_org_unit_id = ANY(${scopeArray})
           )                                                  AS live_assignments,
           act.happened_at                                    AS last_action_at,
           act.actor_name                                     AS last_actor_name
      FROM funding_calls fc
      LEFT JOIN call_school_triage tri
             ON tri.funding_call_id = fc.id AND tri.org_unit_id = ${schoolId}
      LEFT JOIN users du ON du.id = tri.decided_by_user_id
      LEFT JOIN LATERAL (
        SELECT f.happened_at, COALESCE(u.name, u.email) AS actor_name
          FROM assignment_follow_ups f
          LEFT JOIN users u ON u.id = f.created_by_user_id
          LEFT JOIN call_assignments ca ON ca.id = f.assignment_id
         WHERE f.tenant_id = ${tenantId}
           AND f.funding_call_id = fc.id
           AND (f.org_unit_id = ANY(${scopeArray}) OR ca.assignee_org_unit_id = ANY(${scopeArray}))
         ORDER BY f.happened_at DESC
         LIMIT 1
      ) act ON TRUE
     WHERE (
             (fc."tenantId" = ${tenantId} AND (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED'))
             OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED')
           )
       AND (
             -- Open and relevant to this school…
             (
               (COALESCE(fc.close_date, fc."deadlineAt") IS NULL
                OR COALESCE(fc.close_date, fc."deadlineAt") >= now())
               AND ${relevant}
             )
             -- …or closed, but this school still has work on it.
             OR EXISTS (
               SELECT 1 FROM call_assignments ca
                WHERE ca.funding_call_id = fc.id
                  AND ca.tenant_id = ${tenantId}
                  AND ca.assignee_org_unit_id = ANY(${scopeArray})
             )
           )
     ORDER BY COALESCE(fc.close_date, fc."deadlineAt") ASC NULLS LAST
     LIMIT 300
  `)

  const callIds = callRows.map((row) => row.call_id)
  const allocationRows = callIds.length
    ? await prisma.$queryRaw<
        Array<{
          id: string
          funding_call_id: string
          assignee_id: string
          assignee_name: string | null
          assignee_email: string | null
          assigner_id: string | null
          assigner_name: string | null
          status: string
          outcome: string
          deadline_at: Date | null
          responded_at: Date | null
          submitted_at: Date | null
          created_at: Date
          submission_reference: string | null
          last_follow_up_at: Date | null
          last_follow_up_kind: string | null
          last_follow_up_note: string | null
          last_stage: string | null
          follow_up_count: number
          has_workspace: boolean
          proposal_status: string | null
          proposal_activity_at: Date | null
          proposal_id: string | null
          proposal_version_no: number | null
        }>
      >(Prisma.sql`
        SELECT ca.id,
               ca.funding_call_id,
               ca.assignee_user_id            AS assignee_id,
               au.name                        AS assignee_name,
               au.email                       AS assignee_email,
               ca.assigned_by_user_id         AS assigner_id,
               COALESCE(bu.name, bu.email)    AS assigner_name,
               ca.status::text                AS status,
               ca.outcome::text               AS outcome,
               ca.deadline_at,
               ca.responded_at,
               ca.submitted_at,
               ca.created_at,
               ca.submission_reference,
               fu.happened_at                 AS last_follow_up_at,
               fu.kind                        AS last_follow_up_kind,
               fu.note                        AS last_follow_up_note,
               (SELECT s.stage FROM assignment_follow_ups s
                 WHERE s.assignment_id = ca.id AND s.stage IS NOT NULL
                 ORDER BY s.happened_at DESC LIMIT 1) AS last_stage,
               (SELECT COUNT(*)::int FROM assignment_follow_ups c WHERE c.assignment_id = ca.id)
                                              AS follow_up_count,
               EXISTS (
                 SELECT 1 FROM grant_sessions gs
                  WHERE gs."fundingCallId" = ca.funding_call_id
                    AND gs."createdByUserId" = ca.assignee_user_id
                    AND gs."tenantId" = ca.tenant_id
               )                              AS has_workspace,
               pr.status                      AS proposal_status,
               pr.updated_at                  AS proposal_activity_at,
               pr.id                          AS proposal_id,
               pr.current_version_no          AS proposal_version_no
          FROM call_assignments ca
          JOIN users au ON au.id = ca.assignee_user_id
          LEFT JOIN users bu ON bu.id = ca.assigned_by_user_id
          LEFT JOIN grant_proposals pr ON pr.assignment_id = ca.id
          LEFT JOIN LATERAL (
            SELECT f.happened_at, f.kind, f.note
              FROM assignment_follow_ups f
             WHERE f.assignment_id = ca.id
             ORDER BY f.happened_at DESC
             LIMIT 1
          ) fu ON TRUE
         WHERE ca.tenant_id = ${tenantId}
           AND ca.assignee_org_unit_id = ANY(${scopeArray})
           AND ca.funding_call_id = ANY(${textArray(callIds)})
         ORDER BY ca.created_at DESC
      `)
    : []

  const allocationsByCall = new Map<string, LedgerAllocation[]>()
  const attention = { goneQuiet: 0, overdueUnchased: 0, awaitingReply: 0, submitted: 0 }

  for (const row of allocationRows) {
    const progress = deriveAssignmentProgress(
      row,
      row.last_follow_up_at
        ? { happened_at: row.last_follow_up_at, stage: row.last_stage, kind: row.last_follow_up_kind }
        : null,
      row.has_workspace,
      now,
      row.proposal_status
        ? { status: row.proposal_status, latestActivityAt: row.proposal_activity_at }
        : null
    )
    if (progress.goneQuiet) attention.goneQuiet += 1
    if (progress.overdueUnchased) attention.overdueUnchased += 1
    if (progress.code === 'AWAITING_REPLY') attention.awaitingReply += 1
    if (progress.code === 'SUBMITTED' || progress.code === 'AWARDED') attention.submitted += 1

    const allocation: LedgerAllocation = {
      id: row.id,
      assignee: { id: row.assignee_id, name: row.assignee_name, email: row.assignee_email },
      assignedBy: row.assigner_id ? { id: row.assigner_id, name: row.assigner_name } : null,
      status: row.status,
      outcome: row.outcome,
      deadlineAt: row.deadline_at,
      progress,
      lastFollowUpAt: row.last_follow_up_at,
      lastFollowUpKind: row.last_follow_up_kind,
      lastFollowUpNote: row.last_follow_up_note,
      followUpCount: row.follow_up_count,
      submittedAt: row.submitted_at,
      submissionReference: row.submission_reference,
      proposal: row.proposal_id
        ? {
            id: row.proposal_id,
            status: row.proposal_status || 'DRAFT',
            versionNo: row.proposal_version_no ?? 0,
          }
        : null,
    }
    const list = allocationsByCall.get(row.funding_call_id)
    if (list) list.push(allocation)
    else allocationsByCall.set(row.funding_call_id, [allocation])
  }

  const counts = { pending: 0, shortlisted: 0, assigned: 0, dismissed: 0, total: 0, untouched: 0 }
  const calls: LedgerCall[] = callRows.map((row) => {
    const queueState = queueStateFor(row.triage_status, row.live_assignments)
    counts[queueState] += 1
    counts.total += 1
    const daysSincePublished = row.published_at
      ? Math.max(0, Math.floor((now.getTime() - new Date(row.published_at).getTime()) / 86400000))
      : null
    const isUntouched =
      queueState === 'pending' &&
      !row.last_action_at &&
      !row.triage_status &&
      (daysSincePublished ?? 0) >= 7
    if (isUntouched) counts.untouched += 1

    return {
      callId: row.call_id,
      title: row.title,
      agencyName: row.agency_name,
      closesAt: row.closes_at,
      publishedAt: row.published_at,
      daysSincePublished,
      queueState,
      triageStatus: row.triage_status || 'NEW',
      triageDecidedBy: row.triage_decided_by,
      triageDecidedAt: row.triage_decided_at,
      lastActionAt: row.last_action_at,
      lastActorName: row.last_actor_name,
      isUntouched,
      allocations: allocationsByCall.get(row.call_id) || [],
    }
  })

  return {
    school: { id: school.id, name: school.name, code: school.code, isUnmapped: profile.isUnmapped },
    window: options.window,
    counts,
    attention,
    calls,
  }
}

/**
 * A Dean's copy of the ledger.
 *
 * The department's contact log is written for internal coordination — "rang
 * twice, no answer", "says he is waiting on a co-PI" — and notes written for
 * that purpose change character the moment the subject's own head can read
 * them. The dates and the stage are the accountability facts; the prose is not,
 * so it does not leave the department.
 */
export function redactLedgerForSchoolHead(ledger: SchoolCallLedger): SchoolCallLedger {
  return {
    ...ledger,
    calls: ledger.calls.map((call) => ({
      ...call,
      allocations: call.allocations.map((allocation) => ({
        ...allocation,
        lastFollowUpNote: null,
      })),
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* Faculty responsiveness                                                     */
/* -------------------------------------------------------------------------- */

export interface FacultyResponsivenessRow {
  userId: string
  name: string
  email: string | null
  department: string | null
  assigned: number
  awaitingReply: number
  inHand: number
  overdue: number
  submitted: number
  awarded: number
  declined: number
  medianResponseDays: number | null
  lastResponseAt: Date | null
}

/**
 * How the faculty in a branch respond to what the department sends them.
 *
 * This is the Dean's own accountability lens, pointing the other way from the
 * department's: not "is the office chasing" but "are my people answering".
 * `awaitingReply` uses the same three-day patience the chase queue does, so a
 * request sent this morning is not held against anyone.
 */
export async function getFacultyResponsiveness(
  tenantId: string,
  unitIds: string[],
  window: ActivityWindow
): Promise<FacultyResponsivenessRow[]> {
  if (unitIds.length === 0) return []
  const units = textArray(unitIds)

  const rows = await prisma.$queryRaw<
    Array<{
      user_id: string
      name: string
      email: string | null
      department: string | null
      assigned: number
      awaiting_reply: number
      in_hand: number
      overdue: number
      submitted: number
      awarded: number
      declined: number
      median_response_days: number | null
      last_response_at: Date | null
    }>
  >(Prisma.sql`
    SELECT ca.assignee_user_id                                   AS user_id,
           COALESCE(rp.display_name, u.name, u.email, '—')       AS name,
           u.email                                               AS email,
           COALESCE(ou.name, rp.department)                      AS department,
           COUNT(*)::int                                         AS assigned,
           COUNT(*) FILTER (
             WHERE ca.status = 'ASSIGNED'
               AND ca.responded_at IS NULL
               AND ca.created_at < now() - ${UNANSWERED_INTERVAL}
           )::int                                                AS awaiting_reply,
           COUNT(*) FILTER (
             WHERE ca.status IN ('ACCEPTED','IN_PROGRESS')
               AND (ca.deadline_at IS NULL OR ca.deadline_at >= now())
           )::int                                                AS in_hand,
           COUNT(*) FILTER (
             WHERE ca.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS')
               AND ca.deadline_at IS NOT NULL AND ca.deadline_at < now()
           )::int                                                AS overdue,
           COUNT(*) FILTER (WHERE ca.status = 'COMPLETED')::int   AS submitted,
           COUNT(*) FILTER (WHERE ca.outcome = 'AWARDED')::int    AS awarded,
           COUNT(*) FILTER (WHERE ca.status = 'DECLINED')::int    AS declined,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (ca.responded_at - ca.created_at)) / 86400
           ) FILTER (WHERE ca.responded_at IS NOT NULL)           AS median_response_days,
           MAX(ca.responded_at)                                   AS last_response_at
      FROM call_assignments ca
      JOIN users u ON u.id = ca.assignee_user_id
      LEFT JOIN researcher_profiles rp ON rp.user_id = ca.assignee_user_id
      LEFT JOIN tenant_org_units ou ON ou.id = ca.assignee_org_unit_id
     WHERE ca.tenant_id = ${tenantId}
       AND ca.assignee_org_unit_id = ANY(${units})
       AND ca.created_at >= ${window.start}
     GROUP BY ca.assignee_user_id, COALESCE(rp.display_name, u.name, u.email, '—'), u.email,
              COALESCE(ou.name, rp.department)
  `)

  return rows
    .map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      department: row.department,
      assigned: row.assigned,
      awaitingReply: row.awaiting_reply,
      inHand: row.in_hand,
      overdue: row.overdue,
      submitted: row.submitted,
      awarded: row.awarded,
      declined: row.declined,
      medianResponseDays:
        row.median_response_days === null ? null : Math.round(row.median_response_days * 10) / 10,
      lastResponseAt: row.last_response_at,
    }))
    // Worst first, same as everywhere else: unanswered, then late, then quiet.
    .sort(
      (left, right) =>
        right.awaitingReply + right.overdue - (left.awaitingReply + left.overdue) ||
        right.assigned - left.assigned ||
        left.name.localeCompare(right.name)
    )
}

/** The department's summary for one branch, reusing the shared bucket rules. */
export async function getUnitSummary(tenantId: string, unitIds: string[]) {
  return getSummary({ tenantId, scopeUnitIds: unitIds })
}
