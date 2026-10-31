import { beforeEach,describe,expect,it,vi } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),call:vi.fn(),person:vi.fn(),existing:vi.fn()}))
vi.mock('@/lib/auth/tenantAccess',()=>({requireTenantScope:m.auth,isAccessError:(v:any)=>'error'in v}))
vi.mock('@/lib/prisma',()=>({prisma:{fundingCall:{findFirst:m.call},user:{findFirst:m.person},callAssignment:{findUnique:m.existing}}}))
vi.mock('@/lib/tenant/locale',()=>({getTenantTimeZone:async()=> 'Asia/Kolkata'}))
vi.mock('@/lib/assignments/notifyAssignment',()=>({notifyNewAssignment:vi.fn()}))
vi.mock('@/lib/fundingDept/opportunitySnapshot',()=>({snapshotFundingOpportunity:vi.fn()}))
import { POST } from '@/app/api/assignments/route'
const post=(over:Record<string,unknown>={})=>POST(new NextRequest('http://localhost/api/assignments',{method:'POST',body:JSON.stringify({fundingCallId:'call',assigneeUserId:'person',...over})}))
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({tenantId:'tenant',user:{id:'assigner'},scope:{canAssign:true}});m.person.mockResolvedValue(null)})
describe('allocation write enforcement',()=>{
  it('blocks a call whose required entry deadline passed despite a future final deadline',async()=>{
    m.call.mockResolvedValue({id:'call',import_run_id:'i',entry_closes_at:new Date('2000-01-01'),final_deadline_at:new Date('2099-01-01'),close_date:new Date('2099-01-01')})
    expect((await post()).status).toBe(409)
    expect(m.person).not.toHaveBeenCalled()
  })
  it('blocks an explicitly closed import without a recorded deadline',async()=>{
    m.call.mockResolvedValue({id:'call',import_run_id:'i',source_closed_at:new Date('2000-01-01')})
    expect((await post()).status).toBe(409)
  })
  it.each([{}, {allocationMethod:'MANUAL',allocationReason:'DSR_RECOMMENDATION'}])('requires an active faculty account for either allocation method: %s',async method=>{
    m.call.mockResolvedValue({id:'call',close_date:null,deadlineAt:null})
    expect((await post(method)).status).toBe(404)
    expect(m.person.mock.calls[0][0].where).toMatchObject({tenantId:'tenant',status:'ACTIVE'})
    expect(m.existing).not.toHaveBeenCalled()
  })
})
