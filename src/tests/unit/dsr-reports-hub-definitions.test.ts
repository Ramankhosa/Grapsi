import { describe, expect, it } from 'vitest'

import {
  actionStatus, indiaDate, indiaWeekStart, isCountableFollowUp, isFacultyContact, isQualifyingMatch, pendencyState, rollupActionStatus,
} from '@/lib/fundingDept/reportDefinitions'
import { weekStarts } from '@/lib/fundingDept/followUpReport'
import { departmentEventTitle } from '@/lib/fundingDept/callTimeline'

const none = { actionCompletedAt: null, triageDecidedAt: null, shortlisted: 0, allocations: 0, followUps: 0, namedActions: 0 }

describe('action status', () => {
  it('is not started until a person records something', () => {
    expect(actionStatus(none)).toBe('NOT_STARTED')
  })
  it('is in progress after any recorded work, including an allocation', () => {
    for (const change of [{ triageDecidedAt: new Date() }, { shortlisted: 1 }, { allocations: 1 }, { followUps: 2 }, { namedActions: 1 }])
      expect(actionStatus({ ...none, ...change })).toBe('IN_PROGRESS')
  })
  it('is completed only by the manual mark', () => {
    expect(actionStatus({ ...none, allocations: 3, actionCompletedAt: '2026-09-25T10:00:00Z' })).toBe('COMPLETED')
  })
  it('rolls a call up to its least-advanced school', () => {
    expect(rollupActionStatus(['COMPLETED', 'NOT_STARTED', 'IN_PROGRESS'])).toBe('NOT_STARTED')
    expect(rollupActionStatus(['COMPLETED', 'IN_PROGRESS'])).toBe('IN_PROGRESS')
    expect(rollupActionStatus(['COMPLETED', 'COMPLETED'])).toBe('COMPLETED')
    expect(rollupActionStatus([])).toBe('NOT_STARTED')
  })
})

describe('pendency state', () => {
  const base = { daysToDeadline: 30, qualifyingMatches: 2, takenUpAllocations: 0, independentApplications: 0, dismissed: false, actionCompleted: false }
  it('needs a direct match and no uptake', () => {
    expect(pendencyState({ ...base, qualifyingMatches: 0 })).toBeNull()
    expect(pendencyState({ ...base, takenUpAllocations: 1 })).toBeNull()
    expect(pendencyState({ ...base, independentApplications: 1 })).toBeNull()
    expect(pendencyState({ ...base, dismissed: true })).toBeNull()
  })
  it('grades by the deadline', () => {
    expect(pendencyState(base)).toBe('PENDING')
    expect(pendencyState({ ...base, daysToDeadline: null })).toBe('PENDING')
    expect(pendencyState({ ...base, daysToDeadline: 14 })).toBe('AT_RISK')
    expect(pendencyState({ ...base, daysToDeadline: 0 })).toBe('AT_RISK')
    expect(pendencyState({ ...base, daysToDeadline: -1 })).toBe('MISSED')
  })
  it('lists a coordinator closure separately instead of counting it', () => {
    expect(pendencyState({ ...base, daysToDeadline: -3, actionCompleted: true })).toBe('COMPLETED_NO_ALLOCATION')
  })
})

describe('qualifying match', () => {
  const m = { inferred: false, source_version: 'person-call-census-v1', match_tier: 'strong', first_seen_at: new Date('2026-09-01T10:00:00Z') }
  it('counts automatic strong and moderate matches seen by the deadline day', () => {
    expect(isQualifyingMatch(m, new Date('2026-09-10T00:00:00Z'))).toBe(true)
    expect(isQualifyingMatch({ ...m, match_tier: 'moderate' }, null)).toBe(true)
  })
  it('ignores weak, reconstructed, manual and post-deadline matches', () => {
    expect(isQualifyingMatch({ ...m, match_tier: 'weak' }, null)).toBe(false)
    expect(isQualifyingMatch({ ...m, inferred: true }, null)).toBe(false)
    expect(isQualifyingMatch({ ...m, source_version: 'manual-allocation-v1' }, null)).toBe(false)
    expect(isQualifyingMatch(m, new Date('2026-08-31T00:00:00Z'))).toBe(false)
  })
  it('compares India calendar days, so a match seen late on the deadline day still counts', () => {
    // 18:00 UTC on 9 Sep is 23:30 IST on 9 Sep; the deadline day is 9 Sep.
    expect(isQualifyingMatch({ ...m, first_seen_at: new Date('2026-09-09T18:00:00Z') }, new Date('2026-09-09T00:00:00Z'))).toBe(true)
    // 19:00 UTC on 9 Sep is already 10 Sep in India.
    expect(isQualifyingMatch({ ...m, first_seen_at: new Date('2026-09-09T19:00:00Z') }, new Date('2026-09-09T00:00:00Z'))).toBe(false)
  })
})

describe('India weeks', () => {
  it('starts weeks on Monday, India time', () => {
    expect(indiaDate('2026-09-27T19:00:00Z')).toBe('2026-09-28')
    expect(indiaWeekStart('2026-09-27T19:00:00Z')).toBe('2026-09-28') // Sunday night UTC = Monday in India
    expect(indiaWeekStart('2026-09-27T18:00:00Z')).toBe('2026-09-21') // 23:30 IST Sunday
    expect(indiaWeekStart('2026-09-25T06:00:00Z')).toBe('2026-09-21')
  })
  it('lists the last n weeks oldest first, ending with the current week', () => {
    expect(weekStarts(new Date('2026-09-25T06:00:00Z'), 3)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
  })
})

describe('follow-up effort', () => {
  it('excludes review history and counts faculty contacts only by kind and target', () => {
    expect(isCountableFollowUp({ kind: 'TRIAGE' })).toBe(false)
    expect(isCountableFollowUp({ kind: 'NOTE' })).toBe(true)
    expect(isFacultyContact({ kind: 'CALL', contact_target: 'FACULTY' })).toBe(true)
    expect(isFacultyContact({ kind: 'CALL', contact_target: 'AGENCY' })).toBe(false)
    expect(isFacultyContact({ kind: 'NOTE', contact_target: 'FACULTY' })).toBe(false)
  })
})

describe('call timeline', () => {
  it('shows the manual completion mark', () => {
    expect(departmentEventTitle({ entity_type: 'REVIEW', kind: 'ACTION_COMPLETED', school_name: 'School of Sciences', after_data: {} })).toBe('School of Sciences: DSR action marked completed')
    expect(departmentEventTitle({ entity_type: 'REVIEW', kind: 'ACTION_REOPENED', school_name: 'School of Sciences', after_data: {} })).toBe('School of Sciences: DSR action completion undone')
  })
})
