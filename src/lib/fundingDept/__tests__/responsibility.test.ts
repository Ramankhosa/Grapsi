import { describe, expect, it } from 'vitest'
import { closesOpportunity, isExpiredInIndia, resolveResponsibility } from '../responsibility'

const asOf = new Date('2026-09-22T10:00:00+05:30')

describe('role workbench responsibility resolver', () => {
  it('keeps the whole India deadline day active', () => {
    expect(isExpiredInIndia('2026-09-22T00:00:00Z', asOf)).toBe(false)
    expect(isExpiredInIndia('2026-09-21T23:59:00+05:30', asOf)).toBe(true)
  })

  it('puts an overdue named action first while preserving waiting-with', () => {
    const result = resolveResponsibility({
      responsibilityType: 'MATCHED_FOLLOW_UP', asOf, matchingComplete: true,
      actions: [{ title: 'Chase response', owner_user_id: 'u1', waiting_with: 'FACULTY', status: 'OPEN', due_at: '2026-09-20T10:00:00+05:30' }],
    })
    expect(result.queue).toBe('ACTION_OVERDUE')
    expect(result.actionClass).toBe('WAITING_ON_FACULTY')
  })

  it('does not call an incomplete matching projection member neglect', () => {
    const result = resolveResponsibility({
      responsibilityType: 'MATCHED_FOLLOW_UP', asOf, matchingComplete: false,
    })
    expect(result).toMatchObject({ queue: 'DATA_ROUTING', actionClass: 'DATA_GAP' })
  })

  it('retains expired calls only when live work remains', () => {
    const result = resolveResponsibility({
      responsibilityType: 'MATCHED_FOLLOW_UP', asOf, matchingComplete: true,
      deadline: '2026-09-20', activeApplications: 1,
    })
    expect(result).toMatchObject({ expired: true, retainedBecauseLiveWork: true })
  })

  it('keeps the designated next action while separately exposing an older overdue obligation',()=>{
    const result=resolveResponsibility({responsibilityType:'MATCHED_FOLLOW_UP',asOf,matchingComplete:false,schoolUnmapped:true,
      actions:[{id:'old',title:'Earlier review',owner_user_id:'reviewer',waiting_with:'REVIEWER',status:'ACKNOWLEDGED',due_at:'2026-09-20'},
        {id:'next',is_next:true,title:'Contact faculty',owner_user_id:'member',waiting_with:'FACULTY',status:'OPEN',due_at:'2026-09-25'}]})
    expect(result.queue).toBe('ACTION_OVERDUE')
    expect(result.nextAction?.id).toBe('next')
    expect(result.overdueObligation?.id).toBe('old')
    expect(result.dataWarnings).toContain('Matching incomplete')
  })

  it('does not let unresolved reasons close a duty',()=>{
    expect(closesOpportunity('AWAITING_ACTION')).toBe(false)
    expect(closesOpportunity('RELEVANCE_UNRESOLVED')).toBe(false)
    expect(closesOpportunity('NO_SUITABLE_FACULTY')).toBe(true)
  })

  it('requires review of every matching person, not just one',()=>{
    expect(resolveResponsibility({responsibilityType:'MATCHED_FOLLOW_UP',asOf,matchedPeople:3,candidatesReviewed:1}).complete).toBe(false)
    expect(resolveResponsibility({responsibilityType:'MATCHED_FOLLOW_UP',asOf,matchedPeople:3,candidatesReviewed:3}).queue).toBe('COMPLETED')
  })

  it('closes origin intake independently of ongoing matched-school work',()=>{
    const shared={asOf,triageDecisionRecorded:true,activeApplications:1,actions:[{title:'Draft proposal',owner_user_id:'u1',waiting_with:'DSR',status:'OPEN',due_at:'2026-09-20'}]}
    expect(resolveResponsibility({...shared,responsibilityType:'ORIGIN_REVIEW'}).queue).toBe('COMPLETED')
    expect(resolveResponsibility({...shared,responsibilityType:'MATCHED_FOLLOW_UP'}).queue).toBe('ACTION_OVERDUE')
  })

  it('uses department first-review targets and does not blame an uncovered school',()=>{
    const shared={responsibilityType:'ORIGIN_REVIEW' as const,asOf,firstSeenAt:'2026-09-18',thresholds:{firstTouchTargetDays:2,untouchedDays:7,silentDays:14,unansweredDays:3}}
    expect(resolveResponsibility(shared)).toMatchObject({firstReviewOverdue:true,queue:'ACTION_OVERDUE'})
    expect(resolveResponsibility({...shared,ownerMissing:true}).queue).toBe('DATA_ROUTING')
  })

  it('infers faculty chase from the application even without a named action',()=>{
    expect(resolveResponsibility({responsibilityType:'MATCHED_FOLLOW_UP',asOf,waitingWith:'FACULTY',waitingSince:'2026-09-17',activeApplications:1})).toMatchObject({queue:'ACTION_OVERDUE',facultyChaseDue:true,actionClass:'WAITING_ON_FACULTY'})
  })

  it.each(['REVIEWER','APPROVER','AGENCY'])('preserves the waiting party %s',(waitingWith)=>{
    const result=resolveResponsibility({responsibilityType:'MATCHED_FOLLOW_UP',asOf,activeApplications:1,waitingWith})
    expect(result.queue).toBe('WAITING_ON_OTHERS')
    expect(result.waitingWith).toBe(waitingWith)
  })

  it('keeps undated calls active and expires at India midnight only',()=>{
    expect(isExpiredInIndia(null,asOf)).toBe(false)
    expect(isExpiredInIndia('2026-09-21T23:00:00Z',new Date('2026-09-22T18:29:59Z'))).toBe(false)
    expect(isExpiredInIndia('2026-09-21T23:00:00Z',new Date('2026-09-22T18:30:00Z'))).toBe(true)
  })
})
