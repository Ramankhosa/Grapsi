import { describe,expect,it } from 'vitest'
import { callEntryClosed,callEntryDeadline } from '@/lib/funding/callDeadline'
import { responsibilityPendencyState } from '../reportDefinitions'
import { registerAttentionSql } from '../callRegister'

const now=new Date('2026-10-23T12:00:00Z')
const imported={import_run_id:'import',entry_closes_at:new Date('2026-10-01'),final_deadline_at:new Date('2026-12-01'),close_date:new Date('2026-12-01')}
describe('call entry dates',()=>{
  it('closes entry at a required LOI date, independently of the final deadline',()=>{
    expect(callEntryDeadline(imported)?.toISOString().slice(0,10)).toBe('2026-10-01')
    expect(callEntryClosed(imported,now)).toBe(true)
  })
  it('respects explicit source closure without a legacy date',()=>{
    expect(callEntryClosed({import_run_id:'import',source_closed_at:new Date('2026-10-22')},now)).toBe(true)
  })
  it('keeps date-only deadlines open for their whole local day',()=>{
    expect(callEntryClosed({import_run_id:'i',entry_closes_at:new Date('2026-10-23'),deadline_timezone:'America/New_York'},now)).toBe(false)
    expect(callEntryClosed({close_date:new Date('2026-10-23')},now)).toBe(false)
  })
  it('reads the funder’s timezone for imported entry, and ignores import-only fields on curated calls',()=>{
    const call={import_run_id:'i',entry_closes_at:new Date('2026-10-22'),deadline_timezone:'America/Los_Angeles'}
    expect(callEntryClosed(call,new Date('2026-10-23T01:00:00Z'),'Asia/Kolkata')).toBe(false)
    expect(callEntryDeadline({entry_closes_at:new Date('2000-01-01'),close_date:new Date('2026-12-01')})?.getUTCFullYear()).toBe(2026)
  })
})

describe('complete responsibility backlog',()=>{
  const facts={daysToDeadline:30,submissionsAtDeadline:0,allocationsAtDeadline:0,closedAtDeadline:false,submissions:0,takenUp:0,closedNow:false}
  it('does not need any faculty match or human touch to remain outstanding',()=>expect(responsibilityPendencyState(facts)).toBe('PENDING'))
  it('retains allocated but unsubmitted work',()=>expect(responsibilityPendencyState({...facts,takenUp:1,daysToDeadline:3})).toBe('AT_RISK'))
  it('a draft independent application is still pending',()=>expect(responsibilityPendencyState({...facts,submissions:0})).toBe('PENDING'))
  it('late submissions and late closures cannot erase a miss',()=>{
    expect(responsibilityPendencyState({...facts,daysToDeadline:-1,submissions:1,closedNow:true})).toBe('MISSED')
    expect(responsibilityPendencyState({...facts,daysToDeadline:-1,takenUp:1})).toBe('MISSED')
  })
  it('recognizes on-time submission and valid no-allocation closure',()=>{
    expect(responsibilityPendencyState({...facts,daysToDeadline:-1,submissionsAtDeadline:1})).toBeNull()
    expect(responsibilityPendencyState({...facts,daysToDeadline:-1,closedAtDeadline:true})).toBe('COMPLETED_NO_ALLOCATION')
    expect(responsibilityPendencyState({...facts,closedNow:true})).toBe('COMPLETED_NO_ALLOCATION')
  })
  it('does not close an allocated application using a no-allocation reason',()=>expect(responsibilityPendencyState({...facts,takenUp:1,closedNow:true})).toBe('PENDING'))
})

describe('overview filter contracts',()=>{
  it('the school missed filter includes both kinds of missed work',()=>expect(registerAttentionSql('MISSED',now,7).text).toContain("'MISSED_NEVER_ALLOCATED','MISSED_ALLOCATED_NOT_SUBMITTED'"))
  it('the overdue-review filter excludes newly mapped work',()=>{
    const filter=registerAttentionSql('REVIEWS_OVERDUE',now,7)
    expect(filter.text).toContain('mapped_at <')
    expect(filter.values).toContain('2026-10-16T12:00:00.000Z')
  })
  it('closing-unallocated excludes already allocated responsibilities',()=>expect(registerAttentionSql('CLOSING_UNALLOCATED',now,7).text).toContain("review_state IN ('NOT_REVIEWED','REVIEWED_ALLOCATION_PENDING')"))
})
