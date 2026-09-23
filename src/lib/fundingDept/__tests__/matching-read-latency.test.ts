import {afterEach,describe,expect,it,vi} from 'vitest'

const mocks=vi.hoisted(()=>({query:vi.fn(),findCalls:vi.fn()}))
vi.mock('@/lib/prisma',()=>({default:{$queryRaw:mocks.query}}))
vi.mock('@/lib/funding/myAreasService',()=>({findCallsInMyAreas:mocks.findCalls}))
import {reportSchoolMatchStates} from '../currentMatches'

afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.clearAllMocks()})

describe('report matching read latency',()=>{
  it('returns an incomplete state without waiting for the census',async()=>{
    vi.useFakeTimers()
    mocks.query.mockResolvedValue([])
    mocks.findCalls.mockImplementation(()=>new Promise(()=>{}))
    const state=await reportSchoolMatchStates('tenant',['school'])
    expect(state.get('school')).toEqual({fresh:false,complete:false,unprofiled:[]})
    expect(mocks.findCalls).not.toHaveBeenCalled()
  })
})
