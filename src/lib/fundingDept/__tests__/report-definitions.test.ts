import { describe, expect, it } from 'vitest'
import {
  REPORT_DEFINITIONS, countIntakeEvents, countSchoolResponsibilities, countSubmissions, countUniqueCalls,
  deadlineState, reconcile, reviewState, submissionState, submissionSummary,
} from '../reportDefinitions'

const asOf = new Date('2026-09-25T10:00:00+05:30')
const app = (over: Record<string, unknown> = {}) => ({ assignment_id: 'a1', assignment_status: 'IN_PROGRESS', proposal_status: null, outcome: null, submitted_at: null, ...over }) as any

describe('report units', () => {
  it('counts a call entered twice and mapped to three schools as 2 events, 1 call, 3 responsibilities', () => {
    const intake = countIntakeEvents([
      { id: 'import:1', callId: 'c1', enteredAt: '2026-09-01' },
      { id: 'intake:2', callId: 'c1', enteredAt: '2026-09-03' },
    ])
    expect(intake).toMatchObject({ events: 2, uniqueCalls: 1, duplicates: 1 })
    expect([...intake.duplicateIds]).toEqual(['intake:2'])
    expect(countSchoolResponsibilities(['s1', 's2', 's3', 's1'].map(schoolId => ({ callId: 'c1', schoolId })))).toBe(3)
  })

  it('never counts an ad-hoc application row as a call or a responsibility', () => {
    const rows = [{ id: 'c1', schoolId: 's1' }, { id: 'adhoc:p1', schoolId: 's1' }, { id: 'c1', schoolId: 's2' }]
    expect(countUniqueCalls(rows)).toBe(1)
    expect(countSchoolResponsibilities(rows)).toBe(2)
  })

  it('keeps arrivals awaiting extraction as events only', () => {
    expect(countIntakeEvents([{ id: 'intake:1', callId: null }, { id: 'intake:2', callId: null, duplicate: true }]))
      .toMatchObject({ events: 2, uniqueCalls: 0, duplicates: 1, awaitingExtraction: 2 })
  })

  it('treats a linked proposal at the agency as a submitted allocation, but not a draft', () => {
    expect(countSubmissions([app({ proposal_status: 'SUBMITTED' }), app({ proposal_status: 'DRAFT' }), app({ assignment_status: 'COMPLETED' })])).toBe(2)
  })
})

describe('review state ladder', () => {
  const base = { triageStatus: null, triageDecidedAt: null, dispositionReason: null, formalAllocations: 0, namedActions: 0 }
  it('does not treat an undecided triage stamp as a review', () => {
    expect(reviewState({ ...base, triageStatus: 'RELEVANT' })).toBe('NOT_REVIEWED')
    expect(reviewState({ ...base, triageStatus: 'IN_REVIEW', triageDecidedAt: asOf })).toBe('NOT_REVIEWED')
  })
  it('separates reviewed-but-unallocated from allocated and closed', () => {
    expect(reviewState({ ...base, triageStatus: 'RELEVANT', triageDecidedAt: asOf })).toBe('REVIEWED_ALLOCATION_PENDING')
    expect(reviewState({ ...base, namedActions: 1 })).toBe('REVIEWED_ALLOCATION_PENDING')
    expect(reviewState({ ...base, triageStatus: 'RELEVANT', triageDecidedAt: asOf, formalAllocations: 2 })).toBe('ALLOCATED')
    expect(reviewState({ ...base, triageStatus: 'NOT_RELEVANT', triageDecidedAt: asOf })).toBe('CLOSED_NO_ALLOCATION')
    expect(reviewState({ ...base, dispositionReason: 'CAPACITY' })).toBe('CLOSED_NO_ALLOCATION')
  })
  it('lets unresolved dispositions stay open', () => {
    expect(reviewState({ ...base, dispositionReason: 'RELEVANCE_UNRESOLVED' })).toBe('NOT_REVIEWED')
    expect(reviewState({ ...base, dispositionReason: 'AWAITING_ACTION' })).toBe('REVIEWED_ALLOCATION_PENDING')
  })
})

describe('submission state', () => {
  it('separates submitted, verified and closed-without-submission', () => {
    expect(submissionState(app(), false)).toEqual({ state: 'NOT_SUBMITTED', workingStage: 'PROPOSAL_DRAFTING' })
    expect(submissionState(app({ submitted_at: asOf }), false).state).toBe('SUBMITTED_UNVERIFIED')
    expect(submissionState(app({ submitted_at: asOf }), true).state).toBe('SUBMITTED_VERIFIED')
    expect(submissionState(app({ assignment_status: 'DECLINED' }), false).state).toBe('CLOSED_NO_SUBMISSION')
  })
  it('reports partial submission as "x of y" over formal allocations only', () => {
    const summary = submissionSummary([app({ submitted_at: asOf }), app(), app({ assignment_status: 'DECLINED' }), app({ assignment_id: null, submitted_at: asOf })])
    expect(summary).toMatchObject({ allocations: 3, submitted: 1, independent: 1, independentSubmitted: 1, label: '1 of 3 submitted' })
  })
})

describe('deadline state', () => {
  const facts = { formalAllocations: 0, submissions: 0, closedWithReason: false }
  it('keeps the whole India deadline day open and flags closing soon', () => {
    expect(deadlineState({ ...facts, deadline: '2026-09-25T00:00:00Z' }, asOf)).toBe('CLOSING_SOON')
    expect(deadlineState({ ...facts, deadline: '2026-10-02T00:00:00Z' }, asOf)).toBe('CLOSING_SOON')
    expect(deadlineState({ ...facts, deadline: '2026-10-03T00:00:00Z' }, asOf)).toBe('OPEN')
    expect(deadlineState({ ...facts, deadline: null }, asOf)).toBe('NO_DEADLINE')
  })
  it('splits the two kinds of miss and leaves handled calls alone', () => {
    const past = '2026-09-24T00:00:00Z'
    expect(deadlineState({ ...facts, deadline: past }, asOf)).toBe('MISSED_NEVER_ALLOCATED')
    expect(deadlineState({ ...facts, deadline: past, formalAllocations: 2 }, asOf)).toBe('MISSED_ALLOCATED_NOT_SUBMITTED')
    expect(deadlineState({ ...facts, deadline: past, formalAllocations: 2, submissions: 1 }, asOf)).toBe('PASSED_HANDLED')
    expect(deadlineState({ ...facts, deadline: past, closedWithReason: true }, asOf)).toBe('PASSED_HANDLED')
  })
})

describe('definitions and reconciliation', () => {
  it('publishes one glossary entry per unit and state', () => {
    expect(REPORT_DEFINITIONS.length).toBeGreaterThanOrEqual(6 + 1 + 4 + 4 + 6)
    expect(new Set(REPORT_DEFINITIONS.map(d => d.term)).size).toBe(REPORT_DEFINITIONS.length)
  })
  it('reports a headline that disagrees with its rows', () => {
    expect(reconcile('Calls', { headline: 3, drillDown: 3, exported: 3 })).toBeNull()
    expect(reconcile('Calls', { headline: 3, drillDown: 2 })).toMatch(/headline 3, drill-down 2/)
  })
})
