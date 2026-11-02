/**
 * The DSR Reports hub: Incoming Calls, Assigned Calls, Pendency and Follow-ups.
 * One access fence (`resolveHubScope`), one export stamp, one error shape.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantTimeZone } from '@/lib/tenant/locale'
import { getMatchWidth } from './settings'
import { zonedDayStart } from '@/lib/i18n/format'

import { resolveHubScope, paging, type HubScope } from './hubScope'
import { exportResponse } from './managementHandler'
import { definitionsSheet, writeTables, type ExportTable } from './managementExport'
import { AssignedError, assignedExportTables, getAssignedCalls } from './assignedCalls'
import { FollowUpReportError, followUpExportTables, getFollowUpReport } from './followUpReport'
import { getIncomingCalls, incomingExportTables, IncomingError } from './incomingCalls'
import { getPendency, PendencyError, pendencyExportTables } from './pendencyReport'
import { hubSnapshotKeys, readHubSnapshot, writeHubSnapshot, type HubSnapshot } from './hubSnapshot'
import { weekStarts } from './followUpReport'

export const HUB_REPORTS = ['incoming-calls', 'assigned-calls', 'pendency', 'follow-ups'] as const
export type HubReport = (typeof HUB_REPORTS)[number]

export class HubReportError extends Error { constructor(message: string, public status = 400) { super(message) } }

const TITLES: Record<HubReport, string> = {
  'incoming-calls': 'Incoming calls', 'assigned-calls': 'Assigned calls', pendency: 'Pendency', 'follow-ups': 'Follow-ups',
}

type Built = { payload: Record<string, unknown>; tables: () => ExportTable[]; extra?: unknown[][] }
type Builder = (scope: HubScope, params: URLSearchParams, exporting: boolean, asOf: Date) => Promise<Built>

const builders: Record<HubReport, Builder> = {
  'incoming-calls': async (scope, params, exporting, asOf) => {
    const { page, pageSize } = paging(params)
    const closing = params.get('closingWithin')
    const result = await getIncomingCalls(scope.tenantId, {
      schoolIds: scope.schoolIdsIgnoringMember, coordinatorUserId: scope.memberUserId, width: await getMatchWidth(scope.tenantId), includeExpired: params.get('includeExpired') === 'true', action: params.get('action'),
      closingWithin: closing ? Number(closing) : null, source: params.get('source'), search: params.get('q'), callId: params.get('callId'),
      asOf, page, pageSize, all: exporting,
    })
    return { payload: result, tables: () => incomingExportTables(result.rows), extra: [['Calls', result.total]] }
  },
  'assigned-calls': async (scope, params, exporting, asOf) => {
    const { page, pageSize } = paging(params)
    const result = await getAssignedCalls(scope.tenantId, {
      schoolIds: scope.schoolIdsIgnoringMember, coordinatorUserId: scope.memberUserId, status: params.get('status'), due: params.get('due'), silent: params.get('silent') === 'true',
      awaitingReply: params.get('awaitingReply') === 'true', submittedIn: params.get('submittedIn'), assignedByUserId: params.get('assignedBy') === 'me' ? scope.userId : null,
      search: params.get('q'), callId: params.get('callId'), assignmentId: params.get('assignmentId'), evidence: params.get('evidence'), asOf, page, pageSize, all: exporting,
    })
    return { payload: result, tables: () => assignedExportTables(result.rows), extra: [['Allocations', result.total]] }
  },
  pendency: async (scope, params, exporting, asOf) => {
    const { page, pageSize } = paging(params)
    const timeZone = await getTenantTimeZone(scope.tenantId)
    const day = (v: string | null, plus = 0) => {
      if (!v) return null
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HubReportError('Dates must be YYYY-MM-DD.')
      const parsed = new Date(`${v}T00:00:00Z`)
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== v) throw new HubReportError('Choose a valid calendar date.')
      // Local midnight in the tenant's zone (India unless set), as a UTC instant.
      const shifted = new Date(Date.parse(`${v}T00:00:00Z`) + plus * 86400000).toISOString().slice(0, 10)
      return zonedDayStart(shifted, timeZone)
    }
    const min = params.get('minMatches')
    // A chosen member means "calls this person is responsible for": the by-member
    // table's basis, which follows per-call transfers rather than primary schools.
    const result = await getPendency(scope.tenantId, {
      schoolIds: scope.schoolIdsIgnoringMember, coordinatorUserId: params.get('noCoordinator')==='true' ? 'none' : params.get('coordinatorId') || scope.memberUserId, width: await getMatchWidth(scope.tenantId), matchedOnly: params.get('matchedOnly') === 'true', state: params.get('state'), deadlineFrom: day(params.get('deadlineFrom')), deadlineTo: day(params.get('deadlineTo'), 1),
      minMatches: min ? Math.max(1, Number(min) || 1) : null, workState: params.get('workState'), search: params.get('q'), asOf, page, pageSize, all: exporting,
    })
    return { payload: result, tables: () => pendencyExportTables(result.rows, result.members), extra: [['Rows', result.total]] }
  },
  'follow-ups': async (scope, params, exporting, asOf) => {
    const { page, pageSize } = paging(params)
    const result = await getFollowUpReport(scope.tenantId, {
      schoolIds: scope.schoolIdsIgnoringMember, memberUserId: scope.memberUserId, weeks: Number(params.get('weeks') || 8),
      facultyOnly: params.get('facultyOnly') === 'true', silentOnly: params.get('silentOnly') === 'true', logWeek: params.get('logWeek'),
      logAuthorId: params.get('logAuthor'), assignmentId: params.get('assignmentId'), callId: params.get('callId'), asOf, page, pageSize, all: exporting,
    })
    return { payload: result, tables: () => followUpExportTables(result), extra: [['Weeks', result.weeks.join(', ')]] }
  },
}

export async function hubReportHandler(request: NextRequest, report: HubReport) {
  const scope = await resolveHubScope(request)
  if ('response' in scope) return scope.response
  const params = new URL(request.url).searchParams
  const format = params.get('format')
  const exporting = format === 'csv' || format === 'xlsx'
  try {
    const keys = hubSnapshotKeys(scope, report, params)
    let snapshotId = params.get('snapshot')
    let saved: HubSnapshot | null = snapshotId ? await readHubSnapshot(snapshotId, scope, keys) : null
    if (snapshotId && !saved) throw new HubReportError('This report expired or its access changed. Refresh to load the latest records.', 409)
    if (!saved) {
      const asOf = new Date()
      const timeZone = await getTenantTimeZone(scope.tenantId)
      const built = await builders[report](scope, params, true, asOf)
      const weeks = report === 'follow-ups' ? weekStarts(asOf, Number(params.get('weeks') || 8), timeZone) : []
      const start = weeks.length ? zonedDayStart(weeks[0], timeZone) : null
      const periodLabel = report === 'follow-ups' ? `Last ${weeks.length} weeks, through the report date`
        : report === 'pendency' ? (params.get('deadlineFrom') || params.get('deadlineTo') ? `Entry deadlines: ${params.get('deadlineFrom') || 'any'} to ${params.get('deadlineTo') || 'any'}` : 'Outstanding responsibilities and recorded deadline outcomes')
          : report === 'assigned-calls' ? (params.get('submittedIn') === 'month' ? 'Submissions in the current calendar month' : 'Allocation portfolio as of the report date')
            : params.get('includeExpired') === 'true' ? 'Open and expired opportunities as of the report date' : 'Open opportunities as of the report date'
      saved = { payload: built.payload, tables: built.tables(), asOf: asOf.toISOString(), timeZone, periodLabel,
        periodStart: start?.toISOString(), periodEnd: weeks.length ? asOf.toISOString() : undefined }
      snapshotId = await writeHubSnapshot(scope, keys, saved)
    }
    if (exporting) {
      const filters = Object.fromEntries([...params].filter(([k]) => !['format', 'page', 'pageSize', 'snapshot', 'logPage'].includes(k)))
      const tables = [definitionsSheet({ report: TITLES[report], filters, timeZone: saved.timeZone, snapshot: snapshotId,
        generatedAt: new Date(saved.asOf), periodLabel: saved.periodLabel,
        periodStart: saved.periodStart ? new Date(saved.periodStart) : null, periodEnd: saved.periodEnd ? new Date(saved.periodEnd) : null }), ...saved.tables]
      return exportResponse(writeTables(tables, format), format, `dsr-${report}`)
    }
    const { page, pageSize } = paging(params)
    const payload: Record<string, any> = { ...saved.payload, page, pageSize }
    if (Array.isArray(payload.rows)) payload.rows = payload.rows.slice((page - 1) * pageSize, page * pageSize)
    if (Array.isArray(payload.effort)) payload.effort = payload.effort.slice((page - 1) * pageSize, page * pageSize)
    const logPage = Math.max(1, Number.parseInt(params.get('logPage') || '1', 10) || 1)
    if (Array.isArray(payload.log)) payload.log = payload.log.slice((logPage - 1) * 25, logPage * 25)
    return NextResponse.json({ ...payload, logPage, logPageSize: 25, snapshot: snapshotId, asOf: saved.asOf,
      timeZone: saved.timeZone, periodLabel: saved.periodLabel, lens: scope.lens, portfolio: scope.portfolio, options: scope.options, viewerMemberId: scope.memberId })
  } catch (error) {
    if (error instanceof IncomingError || error instanceof AssignedError || error instanceof PendencyError || error instanceof FollowUpReportError || error instanceof HubReportError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error(`DSR hub report ${report} failed`, error)
    const code = (error as { meta?: { code?: string }; code?: string })?.meta?.code
    const pending = code === '42P01' || code === '42703'
    return NextResponse.json({ error: pending ? 'A DSR database update is pending. Ask the administrator to apply the latest migrations.' : 'Report unavailable. Please refresh.' },
      { status: pending ? 503 : 500 })
  }
}
