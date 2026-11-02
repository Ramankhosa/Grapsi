import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({ scope: vi.fn(), read: vi.fn(), write: vi.fn(), incoming: vi.fn(), followUps: vi.fn() }))
vi.mock('@/lib/fundingDept/hubScope', () => ({ resolveHubScope: m.scope, paging: (p: URLSearchParams) => ({ page: Number(p.get('page') || 1), pageSize: Number(p.get('pageSize') || 25) }) }))
vi.mock('@/lib/fundingDept/settings', () => ({ getMatchWidth: async () => 'WIDE' }))
vi.mock('@/lib/tenant/locale', () => ({ getTenantTimeZone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/fundingDept/hubSnapshot', () => ({ hubSnapshotKeys: () => ({ scope: 'authorized-scope', filters: 'filters' }), readHubSnapshot: m.read, writeHubSnapshot: m.write }))
vi.mock('@/lib/fundingDept/managementHandler', () => ({ exportResponse: (content: any) => new Response(content) }))
vi.mock('@/lib/fundingDept/incomingCalls', () => ({ getIncomingCalls: m.incoming, incomingExportTables: (rows: any[]) => [{ name: 'Calls', rows: rows.map(row => [row.callId]) }], IncomingError: class extends Error {} }))
vi.mock('@/lib/fundingDept/assignedCalls', () => ({ getAssignedCalls: vi.fn(), assignedExportTables: () => [], AssignedError: class extends Error {} }))
vi.mock('@/lib/fundingDept/pendencyReport', () => ({ getPendency: vi.fn(), pendencyExportTables: () => [], PendencyError: class extends Error {} }))
vi.mock('@/lib/fundingDept/followUpReport', () => ({ getFollowUpReport: m.followUps, weekStarts: () => ['2026-10-05','2026-10-12','2026-10-19','2026-10-26'], followUpExportTables: () => [], FollowUpReportError: class extends Error {} }))
import { hubReportHandler } from '../hubHandler'
const request = (params = '', report = 'incoming-calls') => new NextRequest(`http://localhost/api/funding-dept/reports/${report}?${params}`)
const saved = { payload: { rows: [{ callId: 'one' }, { callId: 'two' }, { callId: 'three' }], total: 3 }, tables: [{ name: 'Calls', rows: [['one'], ['two'], ['three']] }], asOf: '2026-10-31T12:00:00Z', timeZone: 'Asia/Kolkata', periodLabel: 'Frozen opportunity portfolio' }
beforeEach(() => {
  vi.clearAllMocks()
  m.scope.mockResolvedValue({ tenantId:'tenant',userId:'head',schoolIdsIgnoringMember:['school'],memberUserId:null,lens:'department',portfolio:'primary',memberId:'member',options:{schools:[],members:[]} })
  m.write.mockResolvedValue('snapshot-id'); m.read.mockResolvedValue(null)
  m.incoming.mockResolvedValue(saved.payload)
})
describe('DSR immutable report pagination and exports', () => {
  it('materializes the scoped record set once, then returns the requested page', async () => {
    const response = await hubReportHandler(request('page=2&pageSize=2'), 'incoming-calls')
    const body = await response.json()
    expect(body.rows).toEqual([{callId:'three'}]); expect(body.total).toBe(3); expect(body.snapshot).toBe('snapshot-id')
    expect(m.incoming.mock.calls[0][1]).toMatchObject({all:true,schoolIds:['school']})
    expect(m.write.mock.calls[0][2].payload.rows).toHaveLength(3)
  })
  it('reuses an authorized snapshot for later pages without rerunning the report', async () => {
    m.read.mockResolvedValue(saved)
    const body = await (await hubReportHandler(request('snapshot=snapshot-id&page=2&pageSize=2'), 'incoming-calls')).json()
    expect(body.rows).toEqual([{callId:'three'}]); expect(body.asOf).toBe(saved.asOf); expect(m.incoming).not.toHaveBeenCalled()
    expect(m.read.mock.calls[0][1]).toMatchObject({tenantId:'tenant',userId:'head'})
  })
  it('exports the complete frozen set and the exact displayed snapshot and period', async () => {
    m.read.mockResolvedValue(saved)
    const text = await (await hubReportHandler(request('snapshot=snapshot-id&page=2&format=csv'), 'incoming-calls')).text()
    expect(text).toContain('"Snapshot ID","snapshot-id"'); expect(text).toContain('"Reporting period","Frozen opportunity portfolio"')
    expect(text).toContain('one'); expect(text).toContain('three'); expect(m.incoming).not.toHaveBeenCalled()
  })
  it('rejects expired or changed-scope snapshots instead of silently exporting newer records', async () => {
    const response = await hubReportHandler(request('snapshot=expired&format=csv'), 'incoming-calls')
    expect(response.status).toBe(409); expect(m.incoming).not.toHaveBeenCalled()
  })
  it('labels rolling follow-up exports with their actual period and zone', async () => {
    m.followUps.mockResolvedValue({ weeks:['2026-10-05','2026-10-12','2026-10-19','2026-10-26'],effort:[],log:[],total:0 })
    await hubReportHandler(request('weeks=4', 'follow-ups'), 'follow-ups')
    expect(m.write.mock.calls[0][2]).toMatchObject({periodLabel:'Last 4 weeks, through the report date',timeZone:'Asia/Kolkata',periodStart:'2026-10-04T18:30:00.000Z'})
  })
  it('paginates the evidence log independently of allocation rows', async () => {
    m.read.mockResolvedValue({...saved,payload:{effort:[{assignmentId:'a'}],total:1,log:Array.from({length:51},(_,index)=>({id:index})),logTotal:51}})
    const body = await (await hubReportHandler(request('snapshot=snapshot-id&logPage=3','follow-ups'), 'follow-ups')).json()
    expect(body.log).toEqual([{id:50}]);expect(body.effort).toHaveLength(1);expect(body.logPage).toBe(3)
  })
})
