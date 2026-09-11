/**
 * One row per school per week, so the grid gains a direction of travel.
 *
 * Every other figure in this module is computed on read, which is right for
 * "what is pending now" and silent on the only question a head can act on: is
 * this getting better? An officer who inherited forty untouched calls and has
 * cleared thirty reads identically to one who never had any, and worse than one
 * whose backlog has quietly doubled from three to six.
 *
 * Two rules keep the history honest:
 *
 *   - Every number is derived from `getSchoolFunnel` and `getMemberSchoolMatrix`,
 *     the same functions the live page calls. A snapshot computed its own way
 *     would eventually disagree with the screen, and there would be no way to
 *     tell which was wrong.
 *   - Rows are keyed on (tenant, week, school), never on the member. Coverage is
 *     reassigned, and a history keyed on a rota that moves cannot be read
 *     backwards. `member_id` records who held it that week, the same way
 *     `CallAssignment.assignee_org_unit_id` is a snapshot rather than a join.
 *
 * Idempotent by that unique key, so a retried or double-scheduled run is a
 * no-op rather than a doubled week.
 */
import prisma from '@/lib/prisma'

import { getMemberSchoolMatrix, resolveActivityWindow } from './accountabilityService'
import { getDeptSettingsFor, type DeptSettings } from './settings'

export interface SnapshotResult {
  tenants: number
  weekStart: string
  schoolsWritten: number
  skippedDisabled: number
  failed: number
}

/**
 * Monday 00:00 UTC of the week containing `now`.
 *
 * UTC deliberately, not the tenant timezone: the week key is an identity, not a
 * report boundary, and a local-midnight key would give a tenant two rows for one
 * week whenever the job ran either side of it.
 */
export function weekStartFor(now: Date): Date {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  )
  // getUTCDay: 0 is Sunday, which belongs to the week that started six days ago.
  const offset = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return date
}

async function snapshotTenant(
  tenantId: string,
  settings: DeptSettings,
  weekStart: Date,
  now: Date,
  result: SnapshotResult
): Promise<void> {
  if (!settings.weeklySnapshotsEnabled) {
    result.skippedDisabled += 1
    return
  }

  // The week just gone, not the tenant reporting period: this row describes
  // seven days, and windowing it to a financial year would make every week in
  // that year report the same cumulative activity.
  const window = {
    start: new Date(weekStart.getTime() - 7 * 86400000),
    end: weekStart,
    label: 'Week',
    key: '30d' as const,
  }

  const matrix = await getMemberSchoolMatrix(tenantId, { window, now, settings })

  // A school appears under every member who answers for it — primary and any
  // deputy — so the rows are collapsed to one per school here, preferring the
  // officer on the rota. Two rows for one school would break the unique key and,
  // worse, double every total read back out of the history.
  const bySchool = new Map<
    string,
    { memberId: string | null; role: 'primary' | 'deputy'; row: (typeof matrix.members)[number]['schools'][number] }
  >()
  for (const member of matrix.members) {
    for (const school of member.schools) {
      const existing = bySchool.get(school.schoolId)
      if (!existing || (existing.role === 'deputy' && school.role === 'primary')) {
        bySchool.set(school.schoolId, { memberId: member.id, role: school.role, row: school })
      }
    }
  }

  const writes: Array<ReturnType<typeof prisma.fundingDeptWeeklySnapshot.upsert>> = []

  for (const [schoolId, entry] of bySchool) {
    const row = entry.row
    writes.push(
      prisma.fundingDeptWeeklySnapshot.upsert({
        where: {
          tenant_id_week_start_org_unit_id: {
            tenant_id: tenantId,
            week_start: weekStart,
            org_unit_id: schoolId,
          },
        },
        create: {
          tenant_id: tenantId,
          week_start: weekStart,
          org_unit_id: schoolId,
          member_id: entry.memberId,
          relevant_open: row.relevantOpen,
          pending: row.pending,
          untouched_pending: row.untouchedPending,
          live: row.live,
          gone_quiet: row.buckets.goneQuiet,
          overdue_unchased: row.buckets.overdueUnchased,
          due_nudges: row.dueNudges,
          submitted_in_week: row.submittedInWindow,
          actions_in_week:
            row.followUpsInWindow + row.callsCirculatedInWindow + row.triageDecisionsInWindow,
          score: Math.round(row.score),
        },
        // Overwritten rather than skipped on a re-run, so a sweep re-run after a
        // data fix corrects the week instead of preserving the wrong numbers.
        update: {
          member_id: entry.memberId,
          relevant_open: row.relevantOpen,
          pending: row.pending,
          untouched_pending: row.untouchedPending,
          live: row.live,
          gone_quiet: row.buckets.goneQuiet,
          overdue_unchased: row.buckets.overdueUnchased,
          due_nudges: row.dueNudges,
          submitted_in_week: row.submittedInWindow,
          actions_in_week:
            row.followUpsInWindow + row.callsCirculatedInWindow + row.triageDecisionsInWindow,
          score: Math.round(row.score),
        },
      })
    )
  }

  // Schools nobody covers get a row too, with a null member. Leaving them out
  // would make an uncovered school look like it had no backlog, which is the
  // exact opposite of the truth and the one gap this history most needs to show.
  for (const uncovered of matrix.uncovered) {
    if (bySchool.has(uncovered.schoolId)) continue
    const data = {
      member_id: null,
      relevant_open: uncovered.relevantOpen,
      pending: uncovered.pending,
      untouched_pending: uncovered.untouchedPending,
      live: uncovered.live,
      gone_quiet: 0,
      overdue_unchased: 0,
      due_nudges: 0,
      submitted_in_week: 0,
      actions_in_week: 0,
      score: 0,
    }
    writes.push(
      prisma.fundingDeptWeeklySnapshot.upsert({
        where: {
          tenant_id_week_start_org_unit_id: {
            tenant_id: tenantId,
            week_start: weekStart,
            org_unit_id: uncovered.schoolId,
          },
        },
        create: { tenant_id: tenantId, week_start: weekStart, org_unit_id: uncovered.schoolId, ...data },
        update: data,
      })
    )
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes)
    result.schoolsWritten += writes.length
  }
}

export async function writeWeeklySnapshots(
  options: { now?: Date; tenantId?: string } = {}
): Promise<SnapshotResult> {
  const now = options.now ?? new Date()
  const weekStart = weekStartFor(now)
  const result: SnapshotResult = {
    tenants: 0,
    weekStart: weekStart.toISOString().slice(0, 10),
    schoolsWritten: 0,
    skippedDisabled: 0,
    failed: 0,
  }

  const tenantRows = await prisma.fundingDeptMember.findMany({
    where: { is_active: true, ...(options.tenantId ? { tenant_id: options.tenantId } : {}) },
    select: { tenant_id: true },
    distinct: ['tenant_id'],
  })
  const tenantIds = tenantRows.map((row) => row.tenant_id)
  result.tenants = tenantIds.length
  if (tenantIds.length === 0) return result

  const settingsByTenant = await getDeptSettingsFor(tenantIds)

  for (const tenantId of tenantIds) {
    try {
      await snapshotTenant(tenantId, settingsByTenant.get(tenantId)!, weekStart, now, result)
    } catch (error) {
      result.failed += 1
      // One tenant must not cost every other tenant its week of history.
      console.warn(`Weekly snapshot failed for tenant ${tenantId}`, error)
    }
  }

  return result
}

export interface BacklogDelta {
  orgUnitId: string
  current: number
  previous: number | null
  /** Positive means the backlog grew. Null when there is nothing to compare to. */
  change: number | null
}

/**
 * This week against last, per school, for the digest line that turns a number
 * into news. Returns an empty map until two weeks of history exist, and callers
 * say nothing rather than implying a change they cannot see.
 */
export async function backlogDeltas(
  tenantId: string,
  weekStart: Date
): Promise<Map<string, BacklogDelta>> {
  const previousWeek = new Date(weekStart.getTime() - 7 * 86400000)
  const rows = await prisma.fundingDeptWeeklySnapshot.findMany({
    where: { tenant_id: tenantId, week_start: { in: [weekStart, previousWeek] } },
    select: { org_unit_id: true, week_start: true, untouched_pending: true },
  })

  const current = new Map<string, number>()
  const previous = new Map<string, number>()
  for (const row of rows) {
    const target = row.week_start.getTime() === weekStart.getTime() ? current : previous
    target.set(row.org_unit_id, row.untouched_pending)
  }

  const deltas = new Map<string, BacklogDelta>()
  for (const [orgUnitId, value] of current) {
    const before = previous.has(orgUnitId) ? previous.get(orgUnitId)! : null
    deltas.set(orgUnitId, {
      orgUnitId,
      current: value,
      previous: before,
      change: before === null ? null : value - before,
    })
  }
  return deltas
}
