import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(()=>({call:vi.fn(),query:vi.fn(),claim:vi.fn(),notification:vi.fn(),plan:vi.fn()}))
vi.mock('@/lib/prisma',()=>({default:{fundingCall:{findUnique:m.call},$queryRaw:m.query,
  $transaction:async (fn:any)=>fn({$queryRaw:m.claim,notification:{create:m.notification}})}}))
vi.mock('@/lib/fundingDept/callSchoolMapping',()=>({planTenantMappings:m.plan}))
vi.mock('@/lib/tenant/locale',()=>({getTenantLocale:async()=>({timezone:'Asia/Kolkata',locale:'en-IN'})}))
import { coveredSchoolsForCall,notifyCoveringOfficers } from '../newCallNoticeService'

beforeEach(()=>{
  vi.clearAllMocks()
  m.call.mockResolvedValue({id:'call',tenantId:'a',title:'Private call',visibility:'TENANT_PRIVATE',notification_policy:'NORMAL'})
  m.query.mockResolvedValue([{tenant_id:'a',school_id:'school-a',school_name:'Biotech A',user_id:'officer-a',rerouted:false},
    {tenant_id:'b',school_id:'school-b',school_name:'Biotech B',user_id:'officer-b',rerouted:false}])
  m.claim.mockResolvedValue([{user_id:'officer-a'}]);m.notification.mockResolvedValue({id:'notification'})
})
describe('authorized, idempotent officer notices',()=>{
  it('never sends private call details to another tenant',async()=>{
    const result=await notifyCoveringOfficers('call')
    expect(result.notified).toBe(1)
    expect(m.notification).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tenant_id:'a',user_id:'officer-a'})}))
    expect(m.call.mock.calls[0][0].select.tenantId).toBe(true)
    const sql=m.query.mock.calls[0][0]
    expect(sql.text).toContain('m.is_active');expect(sql.text).toContain('TENANT_PRIVATE');expect(sql.text).toContain('is_active IS DISTINCT FROM false')
  })
  it('does not notify again when the delivery has already been claimed',async()=>{
    m.claim.mockResolvedValue([])
    expect((await notifyCoveringOfficers('call')).notified).toBe(0)
    expect(m.notification).not.toHaveBeenCalled()
    expect(m.claim.mock.calls[0][0].text).toContain('ON CONFLICT DO NOTHING')
  })
  it('can notify mapped schools in multiple institutions for a published global call',async()=>{
    m.call.mockResolvedValue({id:'call',tenantId:null,title:'Global call',visibility:'GLOBAL_PUBLISHED'})
    expect((await notifyCoveringOfficers('call')).notified).toBe(2)
  })
  it.each(['SUPPRESSED','GLOBAL_CATALOG'])('does not deliver %s calls',async value=>{
    m.call.mockResolvedValue({id:'call',visibility:value==='GLOBAL_CATALOG'?value:'TENANT_PRIVATE',notification_policy:value})
    expect((await notifyCoveringOfficers('call')).notified).toBe(0)
    expect(m.notification).not.toHaveBeenCalled()
  })
  it('uses stored mappings rather than independent broad-area matching',async()=>{
    await coveredSchoolsForCall('call')
    expect(m.query.mock.calls[0][0].text).toContain('dsr_call_school_mappings')
    expect(m.plan).not.toHaveBeenCalled()
  })
  it('refuses an empty or foreign preview scope for a private call',async()=>{
    expect(await coveredSchoolsForCall('call',[])).toEqual([])
    expect(await coveredSchoolsForCall('call',['b'])).toEqual([])
    expect(m.query).not.toHaveBeenCalled()
  })
})
