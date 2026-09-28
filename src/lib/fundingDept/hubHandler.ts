/**
 * The DSR Reports hub: Incoming Calls, Assigned Calls, Pendency and Follow-ups.
 * One access fence (`resolveHubScope`), one export stamp, one error shape.
 */
import { NextRequest, NextResponse } from 'next/server'

import { resolveHubScope, paging, type HubScope } from './hubScope'
import { exportResponse } from './managementHandler'
import { definitionsSheet, writeTables, type ExportTable } from './managementExport'
import { AssignedError, assignedExportTables, getAssignedCalls } from './assignedCalls'
import { FollowUpReportError, followUpExportTables, getFollowUpReport } from './followUpReport'
import { getIncomingCalls, incomingExportTables, IncomingError } from './incomingCalls'
import { getPendency, PendencyError, pendencyExportTables } from './pendencyReport'

export const HUB_REPORTS = ['incoming-calls', 'assigned-calls', 'pendency', 'follow-ups'] as const
export type HubReport = (typeof HUB_REPORTS)[number]

export class HubReportError extends Error { constructor(message: string, public status = 400) { super(message) } }

const TITLES: Record<HubReport, string> = {
  'incoming-calls': 'Incoming calls', 'assigned-calls': 'Assigned calls', pendency: 'Pendency', 'follow-ups': 'Follow-ups',
}

type Built = { payload: Record<string, unknown>; tables: () => ExportTable[]; extra?: unknown[][] }
type Builder = (scope: HubScope, params: URLSearchParams, exporting: boolean) => Promise<Built>

const builders: Record<HubReport, Builder> = {
  'incoming-calls': async (scope, params, exporting) => {
    const { page, pageSize } = paging(params)
    const closing = params.get('closingWithin')
    const result = await getIncomingCalls(scope.tenantId, {
      schoolIds: scope.schoolIds, includeExpired: params.get('includeExpired') === 'true', action: params.get('action'),
      closingWithin: closing ? Number(closing) : null, source: params.get('source'), search: params.get('q'), callId: params.get('callId'),
      asOf: new Date(), page, pageSize, all: exporting,
    })
    return { payload: result, tables: () => incomingExportTables(result.rows), extra: [['Calls', result.total]] }
  },
  'assigned-calls': async (scope, params, exporting) => {
    const { page, pageSize } = paging(params)
    const result = await getAssignedCalls(scope.tenantId, {
      schoolIds: scope.schoolIds, status: params.get('status'), due: params.get('due'), silent: params.get('silent') === 'true',
      awaitingReply: params.get('awaitingReply') === 'true', submittedIn: params.get('submittedIn'), assignedByUserId: params.get('assignedBy') === 'me' ? scope.userId : null,
      search: params.get('q'), callId: params.get('callId'), assignmentId: params.get('assignmentId'), asOf: new Date(), page, pageSize, all: exporting,
    })
    return { payload: result, tables: () => assignedExportTables(result.rows), extra: [['Allocations', result.total]] }
  },
  pendency: async (scope, params, exporting) => {
    const { page, pageSize } = paging(params)
    const day = (v: string | null, plus = 0) => {
      if (!v) return null
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HubReportError('Dates must be YYYY-MM-DD.')
      // India midnight, as a UTC instant.
      return new Date(new Date(`${v}T00:00:00Z`).getTime() - 330 * 60000 + plus * 86400000)
    }
    const min = params.get('minMatches')
    // A chosen member means "calls this person is responsible for": the by-member
    // table's basis, which follows per-call transfers rather than primary schools.
    const result = await getPendency(scope.tenantId, {
      schoolIds: scope.memberUserId ? scope.schoolIdsIgnoringMember : scope.schoolIds, coordinatorUserId: scope.memberUserId, state: params.get('state'), deadlineFrom: day(params.get('deadlineFrom')), deadlineTo: day(params.get('deadlineTo'), 1),
      minMatches: min ? Math.max(1, Number(min) || 1) : null, search: params.get('q'), asOf: new Date(), page, pageSize, all: exporting,
    })
    return { payload: result, tables: () => pendencyExportTables(result.rows, result.members), extra: [['Rows', result.total]] }
  },
  'follow-ups': async (scope, params, exporting) => {
    const { page, pageSize } = paging(params)
    const result = await getFollowUpReport(scope.tenantId, {
      schoolIds: scope.schoolIdsIgnoringMember, memberUserId: scope.memberUserId, weeks: Number(params.get('weeks') || 8),
      facultyOnly: params.get('facultyOnly') === 'true', silentOnly: params.get('silentOnly') === 'true', logWeek: params.get('logWeek'),
      logAuthorId: params.get('logAuthor'), assignmentId: params.get('assignmentId'), callId: params.get('callId'), asOf: new Date(), page, pageSize, all: exporting,
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
    const built = await builders[report](scope, params, exporting)
    if (exporting) {
      const filters = Object.fromEntries([...params].filter(([k]) => !['format', 'page', 'pageSize'].includes(k)))
      const tables = [definitionsSheet({ report: TITLES[report], filters }, built.extra), ...built.tables()]
      return exportResponse(writeTables(tables, format), format, `dsr-${report}`)
    }
    return NextResponse.json({ ...built.payload, asOf: new Date(), lens: scope.lens, portfolio: scope.portfolio, options: scope.options, viewerMemberId: scope.memberId })
  } catch (error) {
    if (error instanceof IncomingError || error instanceof AssignedError || error instanceof PendencyError || error instanceof FollowUpReportError || error instanceof HubReportError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error(`DSR hub report ${report} failed`, error)
    const code = (error as { meta?: { code?: string }; code?: string })?.meta?.code
    const pending = code === '42P01' || code === '42703'
    return NextResponse.json({ error: pending ? 'A DSR database update is pending. Ask the administrator to apply the latest migrations.' : 'Report unavailable. Please refresh.' },
      { status: pending ? 503 : 500 })
  }
}
