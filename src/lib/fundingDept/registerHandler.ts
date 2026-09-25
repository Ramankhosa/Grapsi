/**
 * Reports built on the stored call-to-school mapping: Overview, Call Register,
 * Mapping register, Audit trail and the Governance pack. Same access fence as
 * every other management report (primary/deputy school scope), same export
 * stamp; the difference is that these page and count in SQL.
 */
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { getAuditTrail, AUDIT_ENTITY_TYPES } from './auditTrail'
import { textArray } from './callSql'
import { getCallRegister, getOverview, registerExportTables, RegisterError, type RegisterFilters } from './callRegister'
import { managementAccess } from './managementAccess'
import { exportResponse } from './managementHandler'
import { definitionsSheet, writeTables, type ExportTable } from './managementExport'
import { managementWindow } from './managementService'
import { getMappedCalls, getSchoolRoutingGaps, getUnclassifiedQueue } from './mappingRegister'
import { reportFilterKey, reportScopeKey, writeReportSnapshot } from './reportSnapshot'
import { getDeptSettings } from './settings'

export const MAPPING_REPORTS = ['overview', 'register', 'mapping', 'audit', 'governance'] as const

export async function registerReportHandler(request: NextRequest, view: (typeof MAPPING_REPORTS)[number]) {
  const access = await managementAccess(request)
  if ('response' in access) return access.response
  const { tenantId } = access.context
  try {
    const params = new URL(request.url).searchParams
    const requestedSchool = params.get('schoolId')
    // A coordinator asking for another school's rows is refused, not silently emptied.
    if (requestedSchool && access.schoolIds && !access.schoolIds.includes(requestedSchool))
      return NextResponse.json({ error: 'That school is outside your access.' }, { status: 403 })
    const allTime = params.get('window') === 'all'
    const window = allTime ? { start: null, end: null, asOf: new Date(), label: 'All time', timezone: 'Asia/Kolkata' } : await managementWindow(tenantId, params)
    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
    const format = params.get('format')
    const exporting = format === 'csv' || format === 'xlsx'
    const scope = access.schoolIds
    const stamp = (report: string, snapshot: string | null) => ({ report, snapshot, periodLabel: window.label, periodStart: window.start, periodEnd: window.end,
      filters: Object.fromEntries([...params].filter(([k]) => !['format', 'page', 'pageSize'].includes(k))) })
    const snapshotOf = async (payload: unknown) => writeReportSnapshot(tenantId, access.context.user.id, reportScopeKey(access), reportFilterKey(params, view), payload as never)
    const registerFilters: RegisterFilters = {
      scopeSchoolIds: scope, schoolId: requestedSchool, coordinatorUserId: params.get('coordinatorId'), reviewState: params.get('reviewState'),
      deadlineState: params.get('deadlineState'), submission: params.get('submission'), source: params.get('source'), callSearch: params.get('callSearch'),
      callId: params.get('callId'), overdueActions: params.get('overdueActions') === 'true', start: window.start, end: window.end, asOf: window.asOf, page, pageSize, all: exporting,
    }

    if (view === 'register') {
      const register = await getCallRegister(tenantId, registerFilters)
      if (exporting) {
        const snapshot = await snapshotOf(register)
        return exportResponse(writeTables([definitionsSheet(stamp('Call register', snapshot), [['Rows', `${register.total} calls`]]), ...registerExportTables(register.rows)], format), format, 'dsr-call-register')
      }
      return NextResponse.json({ ...register, ordered: undefined, windowLabel: window.label, asOf: window.asOf, lens: access.department ? 'department' : 'member' })
    }

    if (view === 'overview') {
      const settings = await getDeptSettings(tenantId)
      const start = window.start ?? new Date(0), end = window.end ?? new Date(Date.now() + 1)
      const overview = await getOverview(tenantId, { scopeSchoolIds: scope, start, end, asOf: window.asOf, untouchedDays: settings.untouchedDays })
      const unclassified = access.department ? await getUnclassifiedQueue(tenantId, { pageSize: 1, asOf: window.asOf }) : null
      return NextResponse.json({ ...overview, unclassified: unclassified ? { total: unclassified.total, overdue: unclassified.overdue, overdueAfterDays: unclassified.overdueAfterDays } : null,
        routingEnabled: settings.callMappingRoutingEnabled, windowLabel: window.label, asOf: window.asOf, lens: access.department ? 'department' : 'member' })
    }

    if (view === 'mapping') {
      const tab = params.get('tab') || 'mapped'
      if (tab === 'unclassified') {
        if (!access.department) return NextResponse.json({ error: 'The unclassified queue belongs to the department head.' }, { status: 403 })
        const queue = await getUnclassifiedQueue(tenantId, { page, pageSize, all: exporting, asOf: window.asOf })
        if (exporting) return exportResponse(writeTables([definitionsSheet(stamp('Unclassified queue', await snapshotOf(queue))),
          { name: 'Unclassified calls', rows: [['Call ID', 'Call', 'Agency', 'Entered', 'Age (days)', 'Deadline', 'Origin school', 'Global catalog'],
            ...queue.rows.map(r => [r.id, r.title, r.agency, r.entered_at.toISOString(), r.ageDays, r.deadline?.toISOString(), r.origin_school, r.global ? 'Yes' : 'No'])] }], format), format, 'dsr-unclassified-queue')
        return NextResponse.json({ ...queue, tab })
      }
      if (tab === 'schools') {
        const rows = await getSchoolRoutingGaps(tenantId, scope)
        return NextResponse.json({ rows, total: rows.length, page: 1, pageSize: rows.length, tab })
      }
      const mapped = await getMappedCalls(tenantId, { scopeSchoolIds: scope, schoolId: requestedSchool, source: params.get('source'), active: params.get('active'),
        callSearch: params.get('callSearch'), page, pageSize, all: exporting })
      if (exporting) return exportResponse(writeTables([definitionsSheet(stamp('Mapping register', await snapshotOf(mapped))),
        { name: 'Mappings', rows: [['Call ID', 'Call', 'School', 'Source', 'Tier', 'Reason', 'Origin', 'Mapped at', 'Mapped by', 'Reconstructed or backfilled', 'Active', 'Ended at', 'Ended by', 'Ended reason'],
          ...mapped.rows.map(r => [r.call_id, r.title, r.school_name, r.sourceLabel, r.tier, r.reason, r.is_origin ? 'Yes' : 'No', r.mapped_at.toISOString(), r.mapped_by, r.reconstructed ? 'Yes' : 'No',
            r.is_active ? 'Yes' : 'No', r.ended_at?.toISOString(), r.ended_by, r.ended_reason])] }], format), format, 'dsr-mapping-register')
      return NextResponse.json({ ...mapped, tab })
    }

    if (view === 'audit') {
      const entityType = params.get('entityType')
      if (entityType && !AUDIT_ENTITY_TYPES.includes(entityType as never)) return NextResponse.json({ error: 'Unknown audit entry type.' }, { status: 400 })
      const trail = await getAuditTrail(tenantId, { scopeSchoolIds: scope, schoolId: requestedSchool, callId: params.get('callId'), entityType,
        start: window.start, end: window.end, page, pageSize: Math.max(pageSize, 50), all: exporting })
      if (exporting) return exportResponse(writeTables([definitionsSheet(stamp('Audit trail', await snapshotOf(trail))),
        { name: 'Audit trail', rows: [['When (UTC)', 'Who', 'What', 'School', 'Call ID', 'Call', 'Type', 'Kind', 'Reason', 'Inferred'],
          ...trail.rows.map(r => [r.occurred_at.toISOString(), r.actor_name, r.summary, r.school_name, r.call_id, r.call_title, r.entity_type, r.kind, r.reason, r.inferred ? 'Yes' : 'No'])] }], format), format, 'dsr-audit-trail')
      return NextResponse.json(trail)
    }

    // Governance pack: one workbook for a school or university review meeting.
    const settings = await getDeptSettings(tenantId)
    const start = window.start ?? new Date(0), end = window.end ?? new Date(Date.now() + 1)
    const [overview, register, missedNever, missedAllocated, corrective, unclassified] = await Promise.all([
      getOverview(tenantId, { scopeSchoolIds: scope, start, end, asOf: window.asOf, untouchedDays: settings.untouchedDays }),
      getCallRegister(tenantId, { ...registerFilters, all: true }),
      getCallRegister(tenantId, { scopeSchoolIds: scope, schoolId: requestedSchool, deadlineState: 'MISSED_NEVER_ALLOCATED', asOf: window.asOf, all: true }),
      getCallRegister(tenantId, { scopeSchoolIds: scope, schoolId: requestedSchool, deadlineState: 'MISSED_ALLOCATED_NOT_SUBMITTED', asOf: window.asOf, all: true }),
      prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`SELECT x.id, s.name school, x.call_id, x.title, COALESCE(u.name, u.email) owner, x.failure_type, x.status, x.due_at, x.resolution_note
        FROM dsr_actions x JOIN tenant_org_units s ON s.id=x.school_id LEFT JOIN users u ON u.id=x.owner_user_id
        WHERE x.tenant_id=${tenantId} AND x.category='CORRECTIVE' ${scope ? Prisma.sql`AND x.school_id = ANY(${textArray(scope)})` : Prisma.empty} ORDER BY x.due_at NULLS LAST`),
      access.department ? getUnclassifiedQueue(tenantId, { all: true, asOf: window.asOf }) : Promise.resolve(null),
    ])
    const snapshot = await snapshotOf({ overview, register: register.totals })
    const t = overview.totals, n = overview.needsAttention
    const missedSheet = (name: string, rows: typeof missedNever.rows): ExportTable => ({ name, rows: [['Call ID', 'Call', 'Deadline', 'School', 'Responsible coordinator', 'Allocations', 'Closure or explanation'],
      ...rows.flatMap(r => r.responsibilities.map(p => [r.callId, r.title, r.deadline?.toISOString(), p.schoolName, p.coordinator?.name || 'Unassigned', p.allocations.map(a => `${a.faculty} (${a.submissionState})`).join(' | '),
        p.disposition ? `${p.disposition.reason}${p.disposition.explanation ? `: ${p.disposition.explanation}` : ''}` : 'No explanation recorded']))] })
    const tables: ExportTable[] = [
      definitionsSheet(stamp('DSR governance pack', snapshot)),
      { name: 'Overview', rows: [['Measure', 'Value', 'Scope'],
        ['Calls entered', t.callsEntered, 'Period'], ['Calls mapped to a school', t.callsMapped, 'Period'], ['School reviews pending', t.reviewsPending, 'Period'],
        ['Reviewed but unallocated', t.reviewedUnallocated, 'Period'], ['Allocations made', t.allocations, 'Period'], ['Submissions', t.submissions, 'Period'],
        [], ['Needs attention now', '', 'Ignores the period'], ['Responsibilities with an overdue action', n.overdueActions, 'Now'], ['Reviews overdue', n.reviewsOverdue, 'Now'],
        ['Closing soon, not allocated', n.closingSoonUnallocated, 'Now'], ['Missed, never allocated', n.missedNeverAllocated, 'Now'],
        ['Missed, allocated but not submitted', n.missedAllocatedNotSubmitted, 'Now'], ['Mappings with no coordinator', n.withoutCoordinator, 'Now'],
        [], ['School', 'Coordinator', 'Responsibilities', 'Reviews pending', 'Reviewed, unallocated', 'Allocated', 'Closed', 'Submissions', 'Missed'],
        ...overview.schools.map(s => [s.school_name, s.coordinator_name || 'Unassigned', s.responsibilities, s.reviews_pending, s.reviewed_unallocated, s.allocated, s.closed, s.submissions, s.missed])] },
      ...registerExportTables(register.rows),
      missedSheet('Missed never allocated', missedNever.rows), missedSheet('Missed not submitted', missedAllocated.rows),
      { name: 'Corrective actions', rows: [['Action ID', 'School', 'Call ID', 'Action', 'Owner', 'Failure type', 'Status', 'Due', 'Resolution'],
        ...corrective.map(r => [r.id, r.school, r.call_id, r.title, r.owner, r.failure_type, r.status, r.due_at?.toISOString(), r.resolution_note])] },
      ...(unclassified ? [{ name: 'Unclassified queue', rows: [['Call ID', 'Call', 'Age (days)', 'Deadline', 'Origin school'],
        ...unclassified.rows.map(r => [r.id, r.title, r.ageDays, r.deadline?.toISOString(), r.origin_school])] }] : []),
    ]
    return exportResponse(writeTables(tables, 'xlsx'), 'xlsx', 'dsr-governance-pack')
  } catch (error) {
    if (error instanceof RegisterError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('DSR mapping report failed', error)
    const missingSchema = (error as { meta?: { code?: string } })?.meta?.code === '42P01'
    return NextResponse.json({ error: missingSchema ? 'The DSR report database update is pending. Ask the administrator to apply the reporting migration.' : error instanceof Error ? error.message : 'Report unavailable.' },
      { status: missingSchema ? 503 : 500 })
  }
}
