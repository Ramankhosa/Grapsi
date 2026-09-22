/**
 * The calls nobody has taken up, named one by one.
 *
 * The department already counts these — `untouchedPending` sits on every school
 * row and every member total. A count is enough to know somebody is behind and
 * useless for doing anything about it: a head reading "6 relevant calls
 * untouched for a week" beside an officer name cannot open the six, cannot see
 * which closes on Friday, and cannot tell whether they are one agency deadline
 * or six separate lapses. So the number was arguable and the work was not.
 *
 * This returns the rows behind the number, using the same predicates the number
 * is built from — `queueStateSql` for who is on it, `relevantCallWhereSql` for
 * whether it concerns the school at all, and `untouchedSql` for the age — so the
 * list and the count can never disagree. If they ever do, one of the three is
 * being called with different arguments, not with different logic.
 *
 * One query per school, deliberately, like the funnel: a tenant has five to
 * thirty schools, each needs its own discipline profile resolved anyway, and the
 * alternative is a grouped query whose predicates would slowly drift from the
 * ones the officer's own queue uses.
 */
import { notTakenUpSql } from '@/lib/assignments/shared'
import {
  loadUnitAreaProfile,
  relevanceForCalls,
  actionableSchoolCallWhereSql,
  type CallRelevance,
} from '@/lib/funding/callUnitRelevance'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import type { ActivityWindow } from './accountabilityService'
import { callEnteredAtSql, openCallSql, subtreeUnitIds, textArray, visibleCallSql } from './callSql'
import { getCoverageForUnits } from './membershipService'
import { queueStateSql, untouchedSql } from './queueState'
import { getDeptSettings, type DeptSettings } from './settings'

export interface BacklogCall {
  callId: string
  schoolId: string
  schoolName: string
  title: string | null
  agencyName: string | null
  /** When it entered the system: published, else created. */
  enteredAt: Date | null
  /** Whole days since then. The number the report is sorted and filtered on. */
  daysWaiting: number
  closesAt: Date | null
  /**
   * Days until the agency stops accepting applications. Negative means the call
   * has already closed, which only happens on a row kept by `includeClosed`.
   */
  daysToClose: number | null
  /** How the call matches this school, for the reader who asks "why us?". */
  relevance: CallRelevance
  triageStatus: string
  /** People already shortlisted for it. A shortlist with no assignment is its own pendency. */
  shortlisted: number
  /** Which rungs of the escalation ladder have fired: OFFICER, HEAD, ADMIN. */
  escalated: string[]
  /** When the last rung fired, so the ladder can wait its gap before the next. */
  lastEscalatedAt: Date | null
  officer: {
    memberId: string
    userId: string | null
    name: string | null
    isAway: boolean
    /** The deputy standing in while the officer is away, when there is one. */
    coveringName: string | null
    /** Covered on paper, away, and with no deputy: nobody at all, in practice. */
    effectivelyUncovered: boolean
  } | null
}

export interface UnallocatedBacklog {
  window: ActivityWindow
  untouchedDays: number
  calls: BacklogCall[]
  totals: {
    calls: number
    schools: number
    /** Closing inside a fortnight — the rows where doing nothing becomes final. */
    closingSoon: number
    /** No officer covers the school at all, so nobody was ever going to act. */
    uncovered: number
    oldestDays: number
  }
}

interface BacklogRow {
  call_id: string
  title: string | null
  agency_name: string | null
  entered_at: Date | null
  closes_at: Date | null
  triage_status: string | null
  escalation_stages: string[] | null
  last_escalated_at: Date | null
  shortlisted: number
}

function wholeDays(from: Date | null, to: Date): number | null {
  if (!from) return null
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86400000)
}

/**
 * One school worth of backlog.
 *
 * `includeClosed` exists because the two audiences want opposite things. An
 * officer wants the work they can still do, so a closed call is noise. A head
 * doing a post-mortem wants exactly the closed ones: a call that shut with
 * nobody on it is the loss the department exists to prevent, and it disappears
 * from every other screen the moment it closes.
 */
async function backlogForSchool(
  tenantId: string,
  school: { id: string; name: string },
  settings: DeptSettings,
  options: { includeClosed: boolean; now: Date }
): Promise<BacklogRow[]> {
  const scopeIds = await subtreeUnitIds(tenantId, [school.id])
  const scopeArray = textArray(scopeIds)

  const profile = await loadUnitAreaProfile(tenantId, [school.id])
  // Pin included, so this list and the school's own queue tab agree about which
  // calls concern it — including one the school itself declared relevant against
  // the classifier judgement.
  const relevant = actionableSchoolCallWhereSql(tenantId, school.id, 'fc')

  const liveAssignments = Prisma.sql`(
    SELECT COUNT(*)::int FROM call_assignments ca
     WHERE ca.funding_call_id = fc.id
       AND ca.tenant_id = ${tenantId}
       AND ${notTakenUpSql('ca')}
       AND ca.assignee_org_unit_id = ANY(${scopeArray})
  )`
  const state = queueStateSql(liveAssignments, 'tri')
  const untouched = untouchedSql({
    pending: state.pending,
    triageAlias: 'tri',
    enteredAt: callEnteredAtSql('fc'),
    contactExists: Prisma.sql`EXISTS (
      SELECT 1 FROM assignment_follow_ups f
       WHERE f.funding_call_id = fc.id
         AND f.org_unit_id = ANY(${scopeArray})
    )`,
    untouchedDays: settings.untouchedDays,
  })

  return prisma.$queryRaw<BacklogRow[]>(Prisma.sql`
    SELECT fc.id                                     AS call_id,
           COALESCE(fc.scheme_title, fc.title)       AS title,
           COALESCE(fc.agency_name, fc."agencyName") AS agency_name,
           ${callEnteredAtSql('fc')}                 AS entered_at,
           COALESCE(fc.close_date, fc."deadlineAt")  AS closes_at,
           tri.status                                AS triage_status,
           tri.escalation_stages                     AS escalation_stages,
           tri.last_escalated_at                     AS last_escalated_at,
           (
             SELECT COUNT(*)::int FROM call_candidates cc
              WHERE cc.funding_call_id = fc.id
                AND cc.tenant_id = ${tenantId}
                AND cc.status IN ('SHORTLISTED', 'APPROACHED')
           )                                         AS shortlisted
      FROM funding_calls fc
      LEFT JOIN call_school_triage tri
             ON tri.funding_call_id = fc.id AND tri.org_unit_id = ${school.id}
     WHERE ${visibleCallSql(tenantId, 'fc')}
       AND ${options.includeClosed ? Prisma.sql`TRUE` : openCallSql('fc')}
       AND ${relevant}
       AND ${untouched}
     ORDER BY COALESCE(fc.close_date, fc."deadlineAt") ASC NULLS LAST
     LIMIT 400
  `)
}

/**
 * Every relevant call nobody has taken up, across the schools asked about.
 *
 * Sorted by how soon doing nothing becomes permanent, not by how long it has
 * been waiting: a call that has sat for six weeks and closes in March is less
 * urgent than one that arrived eight days ago and closes on Friday, and a report
 * that puts the six-week-old one first will be worked top-down into the wrong
 * order. Undated calls sort last, then by age.
 */
export async function getUnallocatedBacklog(
  tenantId: string,
  options: {
    window: ActivityWindow
    /** Schools to report on. Callers clamp this to the viewer reach before calling. */
    schoolIds: string[]
    /** Raise above the tenant threshold to find only the worst of it. */
    minDays?: number
    /** Keep calls that have already closed — the post-mortem lens. */
    includeClosed?: boolean
    now?: Date
    settings?: DeptSettings
  }
): Promise<UnallocatedBacklog> {
  const now = options.now ?? new Date()
  const settings = options.settings ?? (await getDeptSettings(tenantId))
  const includeClosed = options.includeClosed ?? false

  const schools = await prisma.tenantOrgUnit.findMany({
    where: {
      tenant_id: tenantId,
      is_active: true,
      ...(options.schoolIds.length > 0 ? { id: { in: options.schoolIds } } : { depth: 0 }),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  // Coverage once for the tenant, then fanned out. Never once per school: that
  // is the query explosion the sibling services carefully avoid. Keyed by the
  // unit asked about rather than by school root, so a Head of Department looking
  // at their own department still sees who covers it.
  const coverageByUnit = await getCoverageForUnits(
    tenantId,
    schools.map((school) => school.id)
  )

  const calls: BacklogCall[] = []
  for (const school of schools) {
    const rows = await backlogForSchool(tenantId, school, settings, { includeClosed, now })
    if (rows.length === 0) continue

    const profile = await loadUnitAreaProfile(tenantId, [school.id])
    const relevanceByCall = await relevanceForCalls(
      profile,
      rows.map((row) => row.call_id)
    )
    const cover = coverageByUnit.get(school.id) ?? null

    for (const row of rows) {
      const daysWaiting = wholeDays(row.entered_at, now) ?? 0
      if (options.minDays !== undefined && daysWaiting < options.minDays) continue

      calls.push({
        callId: row.call_id,
        schoolId: school.id,
        schoolName: school.name,
        title: row.title,
        agencyName: row.agency_name,
        enteredAt: row.entered_at,
        daysWaiting,
        closesAt: row.closes_at,
        daysToClose: row.closes_at ? -(wholeDays(row.closes_at, now) ?? 0) : null,
        relevance: relevanceByCall.get(row.call_id) ?? { tier: 'none', reason: null },
        triageStatus: row.triage_status || 'NEW',
        shortlisted: row.shortlisted,
        escalated: row.escalation_stages || [],
        lastEscalatedAt: row.last_escalated_at,
        officer:
          cover && cover.memberId
            ? {
                memberId: cover.memberId,
                userId: cover.memberUserId,
                name: cover.memberName,
                isAway: cover.primaryAway,
                // Only named while they are actually standing in. A deputy shown
                // permanently reads as joint ownership, which is the one thing
                // the single-primary rule exists to prevent.
                coveringName: cover.primaryAway ? cover.deputyName : null,
                effectivelyUncovered: cover.uncoveredRightNow,
              }
            : null,
      })
    }
  }

  calls.sort((left, right) => {
    const leftClose = left.daysToClose ?? Number.MAX_SAFE_INTEGER
    const rightClose = right.daysToClose ?? Number.MAX_SAFE_INTEGER
    return leftClose - rightClose || right.daysWaiting - left.daysWaiting
  })

  return {
    window: options.window,
    untouchedDays: options.minDays ?? settings.untouchedDays,
    calls,
    totals: {
      calls: calls.length,
      schools: new Set(calls.map((call) => call.schoolId)).size,
      closingSoon: calls.filter((call) => call.daysToClose !== null && call.daysToClose <= 14)
        .length,
      // Nobody on the rota, or somebody on the rota who is away with no cover.
      // The second is the one that used to be invisible: the school looked
      // staffed on every screen while nothing at all was happening in it.
      uncovered: calls.filter((call) => !call.officer || call.officer.effectivelyUncovered).length,
      oldestDays: calls.reduce((worst, call) => Math.max(worst, call.daysWaiting), 0),
    },
  }
}

const CSV_COLUMNS: Array<[string, (call: BacklogCall) => unknown]> = [
  ['School', (call) => call.schoolName],
  ['Call', (call) => call.title || '(untitled)'],
  ['Agency', (call) => call.agencyName || ''],
  ['Entered', (call) => (call.enteredAt ? new Date(call.enteredAt).toISOString().slice(0, 10) : '')],
  ['Days waiting', (call) => call.daysWaiting],
  ['Closes', (call) => (call.closesAt ? new Date(call.closesAt).toISOString().slice(0, 10) : '')],
  ['Days to close', (call) => call.daysToClose ?? ''],
  ['Relevance', (call) => call.relevance.tier],
  ['Why', (call) => call.relevance.reason || ''],
  ['Triage', (call) => call.triageStatus],
  ['Shortlisted', (call) => call.shortlisted],
  ['Covering officer', (call) => call.officer?.name || 'nobody'],
  ['Officer away', (call) => (call.officer?.isAway ? 'yes' : 'no')],
  ['Standing in', (call) => call.officer?.coveringName || ''],
  ['Escalated to', (call) => call.escalated.join(' ')],
]

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function backlogToCsv(calls: BacklogCall[]) {
  const lines = [CSV_COLUMNS.map(([heading]) => csvCell(heading)).join(',')]
  for (const call of calls) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(call))).join(','))
  }
  return `${lines.join('\n')}\n`
}
