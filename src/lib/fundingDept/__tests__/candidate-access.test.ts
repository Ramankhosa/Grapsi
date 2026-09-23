import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const mocks=vi.hoisted(()=>({context:vi.fn(),call:vi.fn(),person:vi.fn(),save:vi.fn(),list:vi.fn(),assign:vi.fn()}))
vi.mock('@/lib/auth/tenantAccess',()=>({requireTenantScope:mocks.context,isAccessError:(r:any)=>Boolean(r.error)}))
vi.mock('@/lib/prisma',()=>({prisma:{fundingCall:{findFirst:mocks.call},user:{findFirst:mocks.person},callCandidate:{upsert:mocks.save,findMany:mocks.list}},default:{}}))
vi.mock('@/lib/fundingDept/opportunitySnapshot',()=>({snapshotFundingOpportunity:vi.fn()}))
vi.mock('@/lib/orgUnits/scope',()=>({canAssignToUser:mocks.assign}))
import {POST,GET} from '@/app/api/funding-dept/calls/[callId]/candidates/route'
describe('DSR contact permission versus assignment permission',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    mocks.context.mockResolvedValue({tenantId:'tenant',user:{id:'member'},scope:{isTenantWide:false,canAssign:false,canViewReports:true,managedUnitIds:['school'],fundingDept:{isMember:true,isHead:false}}})
    mocks.call.mockResolvedValue({id:'call'})
    mocks.person.mockResolvedValue({researcher_profile:{org_unit_id:'school'}})
    mocks.save.mockResolvedValue({id:'candidate',status:'APPROACHED'})
    mocks.list.mockResolvedValue([])
  })
  const post=(status:string)=>POST(new NextRequest('http://localhost/api/funding-dept/calls/call/candidates',{method:'POST',body:JSON.stringify({userId:'faculty',status})}),{params:{callId:'call'}})
  it('allows a member to record contact without granting assignment authority',async()=>{
    expect((await post('APPROACHED')).status).toBe(201)
    expect(mocks.save).toHaveBeenCalled()
    expect((await post('ASSIGNED')).status).toBe(403)
  })
  it('denies contact outside current school coverage',async()=>{
    mocks.person.mockResolvedValue({researcher_profile:{org_unit_id:'other'}})
    expect((await post('APPROACHED')).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not expose another school shortlist on a shared call',async()=>{
    await GET(new NextRequest('http://localhost/api/funding-dept/calls/call/candidates'),{params:{callId:'call'}})
    expect(mocks.list.mock.calls[0][0].where.user.researcher_profile.org_unit_id.in).toEqual(['school'])
  })
})
