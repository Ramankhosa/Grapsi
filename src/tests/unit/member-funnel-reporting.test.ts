import { describe, expect, it } from 'vitest'

import type { LedgerAllocation } from '@/lib/fundingDept/accountabilityService'
import {
  allocationReportingState,
  summarizeSchoolRows,
  toDsrAllocationDetail,
  type DsrSchoolFunnelRow,
} from '@/lib/fundingDept/memberFunnelService'

function allocation(overrides: Partial<LedgerAllocation> = {}): LedgerAllocation {
  return {
    id: 'a1',
    assignee: { id: 'u1', name: 'Faculty One', email: null },
    assignedBy: { id: 'u2', name: 'Officer' },
    status: 'ASSIGNED',
    outcome: 'PENDING',
    deadlineAt: null,
    allocatedAt: new Date('2026-09-01'),
    progress: {
      code: 'AWAITING_REPLY', label: 'Awaiting reply', isLive: true, stage: null,
      lastActionAt: new Date('2026-09-01'), daysSilent: 1, goneQuiet: false,
      overdueUnchased: false, proposalStatus: null,
    },
    lastFollowUpAt: null,
    lastFollowUpKind: null,
    lastFollowUpNote: null,
    followUpCount: 0,
    externalContactCount: 0,
    lastExternalContactAt: null,
    lastExternalContactKind: null,
    lastExternalContactBy: null,
    submittedAt: null,
    submissionReference: null,
    submissionUrl: null,
    submissionNotes: null,
    submissionEvidenceStatus: null,
    submissionRecordedBy: null,
    proposal: null,
    ...overrides,
  }
}

describe('DSR member funnel status mapping', () => {
  it('keeps rejected-after-submission in the submitted work-state funnel', () => {
    expect(allocationReportingState(allocation({
      submittedAt: new Date('2026-09-10'),
      progress: { ...allocation().progress, code: 'REJECTED' },
      proposal: { id: 'p1', status: 'REJECTED', versionNo: 2 },
    }))).toEqual({ workState: 'SUBMITTED', detailedStage: 'REJECTED' })
  })

  it('maps declined and lapsed work to closed without submission', () => {
    expect(allocationReportingState(allocation({ progress: { ...allocation().progress, code: 'DECLINED' } }))).toEqual({
      workState: 'CLOSED_WITHOUT_SUBMISSION', detailedStage: 'DECLINED',
    })
    expect(allocationReportingState(allocation({ progress: { ...allocation().progress, code: 'LAPSED' } }))).toEqual({
      workState: 'CLOSED_WITHOUT_SUBMISSION', detailedStage: 'LAPSED_NOT_APPLIED',
    })
  })
})

describe('DSR member funnel reconciliation', () => {
  it('does not count internal notes as an external follow-up', () => {
    const row = toDsrAllocationDetail(allocation({ followUpCount: 4, externalContactCount: 0 }))
    expect(row.followUp).toMatchObject({ followedUp: false, contactEvents: 0 })
    expect(row.exceptions).toContain('NO_FOLLOW_UP')
  })

  it('counts several external contacts as one followed-up allocation', () => {
    const row = toDsrAllocationDetail(allocation({ externalContactCount: 3 }))
    expect(row.followUp).toMatchObject({ followedUp: true, contactEvents: 3 })
  })

  it('sums unique school rows without re-counting deputy ownership', () => {
    const school = (id: string, allocated: number): DsrSchoolFunnelRow => ({
      id, name: id, code: null, isUnmapped: false, relevantCalls: 2, facultyMatches: 5,
      allocated, pending: 1, followedUp: 1, contactEvents: 3, submitted: allocated - 1,
      overdue: 0, needsAttention: 1, childCount: 2, calls: [],
    })
    const result = summarizeSchoolRows([school('s1', 3), school('s2', 2)])
    expect(result).toMatchObject({ schools: 2, relevantCalls: 4, facultyMatches: 10, allocated: 5, submitted: 3 })
  })
})
