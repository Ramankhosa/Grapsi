import { describe,expect,it } from 'vitest'
import { memberWorkedCallIds } from '../memberWork'
const start=new Date('2026-10-01'),end=new Date('2026-11-01'),at=new Date('2026-10-15')
describe('individual contribution attribution',()=>{
  it('credits the actor rather than the school owner, and counts each call once',()=>{
    const facts={visibleCallIds:new Set(['call','other']),applications:[{call_id:'call',assignment_id:'a',allocated_by:'b',created_at:at,submission_recorder:'b',submitted_at:at}],
      contacts:[{call_id:'call',actor_id:'b',happened_at:at}],events:[{entity_id:'action',entity_type:'ACTION',actor_user_id:'b',occurred_at:at,after_data:{call_id:'other'}}]}
    expect([...memberWorkedCallIds('b',start,end,facts)].sort()).toEqual(['call','other'])
    expect(memberWorkedCallIds('primary-school-owner',start,end,facts).size).toBe(0)
  })
  it('excludes activity outside the selected period or visible school-call scope',()=>{
    const facts={visibleCallIds:new Set(['call']),applications:[],contacts:[{call_id:'call',actor_id:'b',happened_at:end},{call_id:'hidden',actor_id:'b',happened_at:at}],events:[]}
    expect(memberWorkedCallIds('b',start,end,facts).size).toBe(0)
  })
})
