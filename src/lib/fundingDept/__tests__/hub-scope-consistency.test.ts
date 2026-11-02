import { beforeEach,describe,expect,it,vi } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({scope:vi.fn(),incoming:vi.fn(),assigned:vi.fn(),pendency:vi.fn()}))
vi.mock('@/lib/fundingDept/hubScope',()=>({resolveHubScope:m.scope,paging:()=>({page:1,pageSize:25})}))
vi.mock('@/lib/fundingDept/settings',()=>({getMatchWidth:async()=> 'WIDE'}))
vi.mock('@/lib/tenant/locale',()=>({getTenantTimeZone:async()=> 'Asia/Kolkata'}))
vi.mock('@/lib/fundingDept/hubSnapshot',()=>({hubSnapshotKeys:()=>({scope:'scope',filters:'filters'}),readHubSnapshot:vi.fn(),writeHubSnapshot:async()=> 'snapshot'}))
vi.mock('@/lib/fundingDept/managementHandler',()=>({exportResponse:vi.fn()}))
vi.mock('@/lib/fundingDept/incomingCalls',()=>({getIncomingCalls:m.incoming,incomingExportTables:()=>[],IncomingError:class extends Error{}}))
vi.mock('@/lib/fundingDept/assignedCalls',()=>({getAssignedCalls:m.assigned,assignedExportTables:()=>[],AssignedError:class extends Error{}}))
vi.mock('@/lib/fundingDept/pendencyReport',()=>({getPendency:m.pendency,pendencyExportTables:()=>[],PendencyError:class extends Error{}}))
vi.mock('@/lib/fundingDept/followUpReport',()=>({weekStarts:()=>['2026-10-26'],getFollowUpReport:vi.fn(),followUpExportTables:()=>[],FollowUpReportError:class extends Error{}}))
import { hubReportHandler } from '../hubHandler'
beforeEach(()=>{
  vi.clearAllMocks();m.scope.mockResolvedValue({tenantId:'tenant',schoolIds:['primary'],schoolIdsIgnoringMember:['primary','covered'],memberUserId:'member-b',userId:'head',memberId:'head',options:{},lens:'department',portfolio:'primary'})
  m.incoming.mockResolvedValue({rows:[],total:0});m.assigned.mockResolvedValue({rows:[],total:0});m.pendency.mockResolvedValue({rows:[],members:[],total:0})
})
describe('consistent report member and matching scope',()=>{
  it.each(['incoming-calls','assigned-calls','pendency'] as const)('uses operational call ownership across accessible schools for %s',async report=>{
    await hubReportHandler(new NextRequest(`http://localhost/api/funding-dept/reports/${report}?memberId=b`),report)
    const fn=report==='incoming-calls'?m.incoming:report==='assigned-calls'?m.assigned:m.pendency
    expect(fn.mock.calls[0][1]).toMatchObject({schoolIds:['primary','covered'],coordinatorUserId:'member-b'})
    if(report!=='assigned-calls')expect(fn.mock.calls[0][1].width).toBe('WIDE')
  })
  it('can drill into the recorded owner of missed work even after that member retired',async()=>{
    await hubReportHandler(new NextRequest('http://localhost/api/funding-dept/reports/pendency?coordinatorId=retired-owner&state=MISSED'),'pendency')
    expect(m.pendency.mock.calls[0][1]).toMatchObject({coordinatorUserId:'retired-owner',state:'MISSED'})
  })
  it('can list unassigned responsibilities without widening school access',async()=>{
    await hubReportHandler(new NextRequest('http://localhost/api/funding-dept/reports/pendency?noCoordinator=true'),'pendency')
    expect(m.pendency.mock.calls[0][1]).toMatchObject({schoolIds:['primary','covered'],coordinatorUserId:'none'})
  })
})
