import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/prisma',()=>({default:{}}))
import {revive,reportFilterKey,reportScopeKey} from '../reportSnapshot'

describe('DSR snapshot consistency',()=>{
  it('revives all dates introduced by the role workbench',()=>{
    const keys=['asOf','at','lastEngagementAt','firstTouchAt','acknowledged_at','refreshed_at','lastActivityAt','enteredAt','away_from','away_until','due_at','deadline']
    const result=revive({nested:keys.map(key=>({[key]:'2026-09-22T04:30:00.000Z'}))})
    keys.forEach((key,i)=>expect(result.nested[i][key]).toBeInstanceOf(Date))
  })
  it('pagination and exports share the same filter key but expiry and duties do not',()=>{
    const key=(query:string)=>reportFilterKey(new URLSearchParams(query),'workbench')
    expect(key('includeExpired=true')).toBe(key('page=2&format=xlsx&snapshot=abc&includeExpired=true'))
    expect(key('includeExpired=true')).not.toBe(key('includeExpired=false'))
    expect(key('queue=ACTION_OVERDUE')).not.toBe(key('queue=NEW_TO_REVIEW'))
  })
  it('does not share snapshots between primary and deputy reach',()=>{
    expect(reportScopeKey({department:false,deputy:false,schoolIds:['s1']})).not.toBe(reportScopeKey({department:false,deputy:true,schoolIds:['s1']}))
    expect(reportScopeKey({department:false,deputy:false,schoolIds:['s1']})).not.toBe(reportScopeKey({department:false,deputy:false,schoolIds:['s2']}))
  })
})
