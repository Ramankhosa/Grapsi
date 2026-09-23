import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest,NextResponse} from 'next/server'
const mocks=vi.hoisted(()=>({handler:vi.fn(),access:vi.fn(),school:vi.fn(),person:vi.fn(),snapshot:vi.fn(),report:vi.fn()}))
vi.mock('@/lib/fundingDept/managementHandler',()=>({managementReportHandler:mocks.handler}))
vi.mock('@/lib/fundingDept/managementAccess',()=>({managementAccess:mocks.access,schoolIsAccessible:mocks.school}))
vi.mock('@/lib/prisma',()=>({default:{user:{findFirst:mocks.person}}}))
vi.mock('@/lib/fundingDept/reportSnapshot',()=>({readReportSnapshot:mocks.snapshot,reportFilterKey:()=> 'filter',reportScopeKey:()=> 'scope'}))
vi.mock('@/lib/fundingDept/managementService',()=>({getManagementReport:mocks.report,managementWindow:()=>({asOf:new Date(),start:new Date(),end:new Date()})}))
import {GET as reportRoute} from '@/app/api/funding-dept/reports/[report]/route'
import {GET as personRoute} from '@/app/api/funding-dept/reports/faculty/[userId]/calls/route'

describe('role report routes',()=>{
  beforeEach(()=>vi.clearAllMocks())
  it.each(['workbench','incoming','corrective-actions'])('serves %s rather than returning 404',async report=>{
    mocks.handler.mockResolvedValue(NextResponse.json({ok:true}))
    const request=new NextRequest(`http://localhost/api/funding-dept/reports/${report}`)
    expect((await reportRoute(request,{params:{report}}))?.status).toBe(200)
    expect(mocks.handler).toHaveBeenCalledWith(request,report)
  })
  it('denies an out-of-scope person before reading matching evidence',async()=>{
    mocks.access.mockResolvedValue({context:{tenantId:'t1',user:{id:'member'}},schoolIds:['s1']})
    mocks.person.mockResolvedValue({id:'person',researcher_profile:{org_unit:{path:['s2']}}})
    mocks.school.mockResolvedValue(false)
    const response=await personRoute(new NextRequest('http://localhost/api/funding-dept/reports/faculty/person/calls'),{params:{userId:'person'}})
    expect(response?.status).toBe(404)
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
  it('preserves deputy context, snapshot matching and person pagination',async()=>{
    mocks.access.mockResolvedValue({context:{tenantId:'t1',user:{id:'deputy'}},schoolIds:['s1'],deputy:true})
    mocks.person.mockResolvedValue({id:'person',name:'Faculty',researcher_profile:{org_unit:{path:['s1']}}})
    mocks.school.mockResolvedValue(true)
    mocks.snapshot.mockResolvedValue({faculty:[{id:'person',profileReady:true}],members:[{schools:[{id:'s1',calls:Array.from({length:25},(_,i)=>({id:`call${i}`,matches:[{user_id:'person',match_reason:'Saved research area'}]}))}]}],options:{}})
    const request=new NextRequest('http://localhost/api/funding-dept/reports/faculty/person/calls?portfolio=deputy&snapshot=saved&page=2')
    const response=await personRoute(request,{params:{userId:'person'}}),body=await response!.json()
    expect(mocks.access).toHaveBeenCalledWith(request)
    expect(mocks.snapshot).toHaveBeenCalledWith('saved','t1','deputy','scope','filter')
    expect(body.total).toBe(25)
    expect(body.calls).toHaveLength(5)
    expect(body.calls[0].match.match_reason).toBe('Saved research area')
  })
})
