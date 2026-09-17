import { describe, expect, it } from 'vitest'
import { applicationState, csvCell, deadlineAttention, evidenceFingerprint, hasSubmissionEvidence, inPeriod, opportunityActionState, opportunityDeadlineAttention, ratio } from '@/lib/fundingDept/managementRules'
import type { ApplicationRow } from '@/lib/fundingDept/managementRules'

const row=(overrides:Partial<ApplicationRow>={}):ApplicationRow=>({id:'assignment:a',tenant_id:'t',school_id:'s',call_id:'c',assignment_id:'a',proposal_id:null,faculty_id:'f',allocated_by:'o',created_at:new Date('2026-01-01'),assignment_status:'IN_PROGRESS',outcome:'PENDING',proposal_status:'DRAFT',submitted_at:null,submission_reference:null,submission_url:null,submission_notes:null,submission_recorder:null,internal_deadline:null,review_deadline:null,agency_deadline:null,title:'Call',agency:null,requested_amount:null,sanctioned_amount:null,currency:'INR',version_no:1,updated_at:new Date('2026-01-01'),...overrides})

describe('canonical DSR management rules',()=>{
  it('keeps rejected-after-submission in the submitted funnel',()=>expect(applicationState(row({proposal_status:'REJECTED',submitted_at:new Date('2026-01-15')}))).toMatchObject({stage:'REJECTED',workState:'SUBMITTED',submitted:true,closed:true}))
  it('keeps an overdue concern independent of workflow stage',()=>expect(applicationState(row({proposal_status:'IN_REVIEW'}))).toMatchObject({stage:'INTERNAL_REVIEW',workState:'PENDING'}))
  it('requires a reference, URL or document rather than notes for evidence',()=>{expect(hasSubmissionEvidence(row({submission_notes:'I submitted it'}),[])).toBe(false);expect(hasSubmissionEvidence(row({submission_reference:'ACK'}),[])).toBe(true)})
  it('invalidates verification fingerprints when evidence changes',()=>expect(evidenceFingerprint(row({submission_reference:'A'}),[])).not.toBe(evidenceFingerprint(row({submission_reference:'B'}),[])))
  it('uses a half-open reporting boundary',()=>{const start=new Date('2026-01-01'),end=new Date('2026-02-01');expect(inPeriod(start,start,end)).toBe(true);expect(inPeriod(end,start,end)).toBe(false)})
  it('shows percentage denominators and neutral empty values',()=>{expect(ratio(2,4)).toEqual({numerator:2,denominator:4,percent:50});expect(ratio(0,0).percent).toBeNull()})
  it('neutralizes formulas in CSV exports',()=>expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"'))
  it('does not treat an automated researcher match as human action',()=>expect(opportunityActionState({applications:0,candidatesReviewed:0,externalContacts:0,recordedActions:0,dispositionRecorded:false})).toEqual({touched:false,signals:[]}))
  it('recognizes each auditable opportunity action signal',()=>{
    expect(opportunityActionState({applications:1,candidatesReviewed:1,externalContacts:1,recordedActions:1,dispositionRecorded:true})).toEqual({
      touched:true,signals:['APPLICATION_OR_ALLOCATION','FACULTY_REVIEWED','EXTERNAL_FACULTY_CONTACT','NAMED_ACTION','NO_UPTAKE_DECISION'],
    })
  })
  it('classifies the inclusive 21-day window using India calendar dates',()=>{
    const asOf=new Date('2026-09-17T18:00:00+05:30')
    expect(deadlineAttention('2026-09-17T00:00:00.000Z',asOf)).toMatchObject({daysToDeadline:0,upcoming21:true,missed:false})
    expect(deadlineAttention('2026-10-08T00:00:00.000Z',asOf)).toMatchObject({daysToDeadline:21,upcoming21:true})
    expect(deadlineAttention('2026-10-09T00:00:00.000Z',asOf)).toMatchObject({daysToDeadline:22,upcoming21:false})
    expect(deadlineAttention('2026-09-16T00:00:00.000Z',asOf)).toMatchObject({daysToDeadline:-1,missed:true})
  })
  it('only calls a passed relevant opportunity missed when allocation and submission are both absent',()=>{
    const base={deadline:'2026-09-16T00:00:00.000Z',asOf:new Date('2026-09-17T12:00:00+05:30'),quality:'confirmed',formalAllocations:0,submissions:0,outstandingApplications:0}
    expect(opportunityDeadlineAttention(base).missedUnallocatedNoSubmission).toBe(true)
    expect(opportunityDeadlineAttention({...base,formalAllocations:1}).missedUnallocatedNoSubmission).toBe(false)
    expect(opportunityDeadlineAttention({...base,submissions:1}).missedUnallocatedNoSubmission).toBe(false)
    expect(opportunityDeadlineAttention({...base,quality:'dismissed'}).missedUnallocatedNoSubmission).toBe(false)
    expect(opportunityDeadlineAttention({...base,deadline:null}).missedUnallocatedNoSubmission).toBe(false)
  })
})
