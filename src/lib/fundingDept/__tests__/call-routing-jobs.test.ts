import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),classify:vi.fn(),map:vi.fn(),notify:vi.fn()}))
vi.mock('@/lib/prisma',()=>({default:{$queryRaw:m.query,$executeRaw:m.execute}}))
vi.mock('@/lib/funding/disciplineClassifier',()=>({classifyFundingCall:m.classify}))
vi.mock('@/lib/fundingDept/callSchoolMapping',()=>({mapCallToSchools:m.map}))
vi.mock('@/lib/fundingDept/newCallNoticeService',()=>({notifyCoveringOfficers:m.notify}))
import { requestCallRouting,routingRetryMinutes,sweepCallRouting } from '../callRoutingJobs'
beforeEach(()=>{vi.clearAllMocks();m.query.mockResolvedValue([]);m.execute.mockResolvedValue(1);m.classify.mockResolvedValue({});m.map.mockResolvedValue([]);m.notify.mockResolvedValue({notified:1})})
describe('durable publication routing',()=>{
  it('maps before notification and marks only the claimed generation complete',async()=>{
    m.query.mockResolvedValueOnce([{call_id:'call',generation:3,attempts:2}])
    expect(await sweepCallRouting({limit:1})).toEqual({processed:1,completed:1,failed:0})
    expect(m.classify.mock.invocationCallOrder[0]).toBeLessThan(m.map.mock.invocationCallOrder[0])
    expect(m.map.mock.invocationCallOrder[0]).toBeLessThan(m.notify.mock.invocationCallOrder[0])
    const sql=m.execute.mock.calls[0][0]
    expect(sql.text).toContain("status='COMPLETED'");expect(sql.values).toEqual(['call',3,2])
    expect(m.query.mock.calls[0][0].text).toContain('SKIP LOCKED')
  })
  it('a failed mapping never sends a notice, and remains retryable',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    try {
      m.query.mockResolvedValueOnce([{call_id:'call',generation:1,attempts:1}]);m.map.mockRejectedValueOnce(Error('mapping failed'))
      expect((await sweepCallRouting({limit:1})).failed).toBe(1)
      expect(m.notify).not.toHaveBeenCalled()
      expect(m.execute.mock.calls[0][0].text).toContain("status='FAILED'")
    } finally {log.mockRestore()}
  })
  it('claims one job at a time and recovers expired leases',async()=>{
    m.query.mockResolvedValueOnce([{call_id:'one',generation:1,attempts:1}]).mockResolvedValueOnce([{call_id:'two',generation:1,attempts:1}])
    expect((await sweepCallRouting({limit:2})).completed).toBe(2)
    expect(m.query.mock.calls[1][0].text).toContain("interval '15 minutes'")
    expect(m.execute.mock.invocationCallOrder[0]).toBeLessThan(m.query.mock.invocationCallOrder[1])
  })
  it('explicit retry resets failures and advances the generation',async()=>{
    await requestCallRouting('call')
    expect(m.execute.mock.calls[0][0].text).toContain('generation=dsr_call_routing_jobs.generation+1')
  })
  it('backs off repeated failures within a bounded retry interval',()=>{
    expect(routingRetryMinutes(1)).toBe(2);expect(routingRetryMinutes(8)).toBe(256);expect(routingRetryMinutes(100)).toBe(360)
  })
})
