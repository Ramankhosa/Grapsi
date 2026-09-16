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

import { resolveActivityWindow } from './accountabilityService'
import { getManagementReport } from './managementService'
import { inPeriod } from './managementRules'
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

  const report = await getManagementReport(tenantId, {...window,asOf:now,mode:'pending'})
  const writes: Array<ReturnType<typeof prisma.fundingDeptWeeklySnapshot.upsert>> = []
  for (const member of report.members) for (const school of member.schools) {
    const apps=report.applications.filter(a=>a.school_id===school.id)
    const open=apps.filter(a=>a.outstanding)
    const actions=report.actions.filter(a=>a.school_id===school.id)
    const data={
      member_id:member.id==='unassigned'?null:member.id,
      relevant_open:school.calls.filter(c=>c.quality==='confirmed' && (!c.deadline||c.deadline>=now)).length,
      pending:school.calls.filter(c=>c.unallocated && (!c.deadline||c.deadline>=now)).length,
      untouched_pending:school.calls.filter(c=>c.unallocated&&!c.lastAction).length,
      live:open.length,
      gone_quiet:open.filter(a=>!a.followedUp).length,
      overdue_unchased:open.filter(a=>a.exceptions.includes('overdue')&&!a.followedUp).length,
      due_nudges:actions.filter(a=>a.status==='OPEN'&&a.due_at&&a.due_at<now).length,
      submitted_in_week:apps.filter(a=>inPeriod(a.submitted_at,window.start,window.end)).length,
      actions_in_week:actions.filter(a=>inPeriod(a.completed_at,window.start,window.end)).length+
        apps.reduce((n,a)=>n+a.contacts.filter(c=>c.target==='FACULTY'&&['CALL','EMAIL','MEETING'].includes(c.kind)&&inPeriod(c.happened_at,window.start,window.end)).length,0),
      // Retained only for legacy storage compatibility; no overall ranking.
      score:0,
    }
    writes.push(prisma.fundingDeptWeeklySnapshot.upsert({
      where:{tenant_id_week_start_org_unit_id:{tenant_id:tenantId,week_start:weekStart,org_unit_id:school.id}},
      create:{tenant_id:tenantId,week_start:weekStart,org_unit_id:school.id,...data},update:data,
    }))
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
