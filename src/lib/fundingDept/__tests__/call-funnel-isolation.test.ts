import { beforeEach,describe,expect,it,vi } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({query:vi.fn(),calls:vi.fn(),call:vi.fn(),count:vi.fn(),alerts:vi.fn(),assignments:vi.fn(),candidates:vi.fn()}))
vi.mock('@/lib/auth/tenantAccess',()=>({requireTenantScope:async()=>({tenantId:'tenant-a',user:{id:'head'},scope:{isTenantWide:true}}),isAccessError:()=>false}))
vi.mock('@/lib/fundingDept/shared',()=>({canReviewDept:()=>true}))
vi.mock('@/lib/tenant/locale',()=>({getTenantLocale:async()=>({timezone:'Asia/Kolkata',currency:'INR',locale:'en-IN'})}))
vi.mock('@/lib/funding/callUnitRelevance',()=>({loadUnitAreaProfile:async()=>({isUnmapped:true}),relevantCallWhereSql:vi.fn()}))
vi.mock('@/lib/orgUnits/tree',()=>({listSubtreeUnitIds:async()=>['school','department']}))
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:m.query,fundingCall:{findMany:m.calls,findFirst:m.call,count:m.count},fundingCallAlert:{findMany:m.alerts},callAssignment:{findMany:m.assignments},callCandidate:{findMany:m.candidates}}}))
import { GET as list } from '@/app/api/funding-dept/calls/route'
import { GET as detail } from '@/app/api/funding-dept/calls/[callId]/route'
const call={id:'global-call',title:'Global call',scheme_title:null,agencyName:'Agency',agency_name:null,close_date:null,deadlineAt:null,visibility:'GLOBAL_PUBLISHED',status:'PUBLISHED',catalog_status:'PUBLISHED',updatedAt:new Date()}
beforeEach(()=>{
  vi.clearAllMocks();m.calls.mockResolvedValue([call]);m.call.mockResolvedValue(call);m.count.mockResolvedValue(1)
  m.alerts.mockResolvedValue([]);m.assignments.mockResolvedValue([]);m.candidates.mockResolvedValue([])
  m.query.mockImplementation(async (sql:any)=>sql.text.includes('FROM funding_call_alerts')?[{funding_call_id:'global-call',matched:8,emails_sent:8,emails_queued:0,emails_failed:0,last_alert_at:null}]
    :sql.text.includes('FROM call_assignments')?[]:[{id:'global-call'}])
})
describe('tenant and school fences on the older call funnel',()=>{
  it('counts only recipients from this institution and selected school',async()=>{
    const response=await list(new NextRequest('http://localhost/api/funding-dept/calls?orgUnitId=school'))
    expect(response.status).toBe(200);expect((await response.json()).calls[0].matched.count).toBe(8)
    const sql=m.query.mock.calls.map(([q]:any[])=>q).find((q:any)=>q.text?.includes('FROM funding_call_alerts'))
    expect(sql.text).toContain('recipient."tenantId"=')
    expect(sql.text).toContain('ANY(recipient_unit.path)')
    expect(sql.values).toContain('tenant-a');expect(sql.values).toContain('school')
    const counts=m.count.mock.calls.map(([arg]:any[])=>JSON.stringify(arg))
    expect(counts.some((arg:string)=>arg.includes('"none":{"tenant_id":"tenant-a"}'))).toBe(true)
  })
  it('applies the same school filter to recipient and allocation detail lists',async()=>{
    expect((await detail(new NextRequest('http://localhost/api/funding-dept/calls/global-call?orgUnitId=school'),{params:{callId:'global-call'}})).status).toBe(200)
    expect(m.alerts.mock.calls[0][0].where.user).toMatchObject({tenantId:'tenant-a',researcher_profile:{org_unit_id:{in:['school','department']}}})
    expect(m.assignments.mock.calls[0][0].where).toMatchObject({tenant_id:'tenant-a',assignee_org_unit_id:{in:['school','department']}})
  })
  it('rejects an unavailable/private foreign call before reading its people',async()=>{
    m.call.mockResolvedValue(null)
    expect((await detail(new NextRequest('http://localhost/api/funding-dept/calls/private'),{params:{callId:'private'}})).status).toBe(404)
    expect(m.alerts).not.toHaveBeenCalled()
  })
})
