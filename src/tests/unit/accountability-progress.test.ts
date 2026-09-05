import { describe, expect, it } from 'vitest'

import {
  addToBuckets,
  deriveAssignmentProgress,
  emptyBuckets,
  type ProgressAssignment,
} from '@/lib/fundingDept/accountabilityProgress'

const NOW = new Date('2026-09-20T10:00:00.000Z')
const day = (n: number) => new Date(`2026-09-${String(n).padStart(2, '0')}T09:00:00.000Z`)

function assignment(overrides: Partial<ProgressAssignment> = {}): ProgressAssignment {
  return {
    status: 'ACCEPTED',
    outcome: 'PENDING',
    deadline_at: null,
    responded_at: day(10),
    submitted_at: null,
    created_at: day(1),
    ...overrides,
  }
}

describe('deriveAssignmentProgress', () => {
  it('lets a decision outrank everything, including a long-past deadline', () => {
    const progress = deriveAssignmentProgress(
      assignment({ outcome: 'AWARDED', status: 'COMPLETED', deadline_at: day(2) }),
      null,
      false,
      NOW
    )
    expect(progress.code).toBe('AWARDED')
    expect(progress.isLive).toBe(false)
    // An awarded project must never be reported as overdue work.
    expect(progress.overdueUnchased).toBe(false)
  })

  it('reports a completed assignment as submitted', () => {
    const progress = deriveAssignmentProgress(
      assignment({ status: 'COMPLETED', submitted_at: day(18) }),
      null,
      false,
      NOW
    )
    expect(progress.code).toBe('SUBMITTED')
    expect(progress.isLive).toBe(false)
  })

  it('separates an unanswered request from work in hand', () => {
    const waiting = deriveAssignmentProgress(
      assignment({ status: 'ASSIGNED', responded_at: null }),
      null,
      false,
      NOW
    )
    expect(waiting.code).toBe('AWAITING_REPLY')

    const accepted = deriveAssignmentProgress(assignment(), null, false, NOW)
    expect(accepted.code).toBe('IN_HAND')
  })

  it('shows a draft workspace as drafting, but only once the deadline is safe', () => {
    expect(deriveAssignmentProgress(assignment(), null, true, NOW).code).toBe('DRAFTING')
    expect(
      deriveAssignmentProgress(assignment({ deadline_at: day(5) }), null, true, NOW).code
    ).toBe('OVERDUE')
  })

  it('takes the last action from the newest of follow-up, reply and creation', () => {
    const progress = deriveAssignmentProgress(
      assignment({ created_at: day(1), responded_at: day(4) }),
      { happened_at: day(18) },
      false,
      NOW
    )
    expect(progress.lastActionAt?.toISOString()).toBe(day(18).toISOString())
    expect(progress.daysSilent).toBe(2)
    expect(progress.goneQuiet).toBe(false)
  })

  it('flags live work nobody has touched for a fortnight, whatever its code', () => {
    const quiet = deriveAssignmentProgress(
      assignment({ status: 'ASSIGNED', responded_at: null, created_at: day(1) }),
      null,
      false,
      NOW
    )
    // Still "awaiting reply" — gone quiet composes with it rather than replacing it.
    expect(quiet.code).toBe('AWAITING_REPLY')
    expect(quiet.goneQuiet).toBe(true)
    expect(quiet.daysSilent).toBe(19)
  })

  it('never calls settled work quiet', () => {
    const declined = deriveAssignmentProgress(
      assignment({ status: 'DECLINED', created_at: day(1), responded_at: day(1) }),
      null,
      false,
      NOW
    )
    expect(declined.goneQuiet).toBe(false)
  })

  it('counts an overdue allocation as unchased only when nothing was logged after the date', () => {
    const unchased = deriveAssignmentProgress(
      assignment({ deadline_at: day(10) }),
      { happened_at: day(4) },
      false,
      NOW
    )
    expect(unchased.overdueUnchased).toBe(true)

    const chased = deriveAssignmentProgress(
      assignment({ deadline_at: day(10) }),
      { happened_at: day(15) },
      false,
      NOW
    )
    expect(chased.code).toBe('OVERDUE')
    expect(chased.overdueUnchased).toBe(false)
  })

  it('carries the latest recorded stage through', () => {
    const progress = deriveAssignmentProgress(
      assignment(),
      { happened_at: day(19), stage: 'APPROVALS' },
      false,
      NOW
    )
    expect(progress.stage).toBe('APPROVALS')
  })

  it('survives an assignment with no dates at all', () => {
    const progress = deriveAssignmentProgress(
      { status: 'ASSIGNED', created_at: null, responded_at: null },
      null,
      false,
      NOW
    )
    expect(progress.lastActionAt).toBeNull()
    expect(progress.daysSilent).toBeNull()
    expect(progress.goneQuiet).toBe(false)
  })
})

describe('progress buckets', () => {
  it('counts each allocation exactly once, plus its orthogonal attention flags', () => {
    const buckets = emptyBuckets()
    const rows = [
      assignment({ status: 'ASSIGNED', responded_at: null, created_at: day(1) }), // awaiting + quiet
      // Overdue, unchased, and silent since the reply on the 2nd: gone quiet has
      // to compose with a code other than AWAITING_REPLY or it is not orthogonal.
      assignment({ deadline_at: day(9), responded_at: day(2) }),
      assignment({ status: 'COMPLETED' }),
      assignment(),
    ]
    for (const row of rows) {
      addToBuckets(buckets, deriveAssignmentProgress(row, null, false, NOW))
    }

    expect(buckets.awaitingReply).toBe(1)
    expect(buckets.overdue).toBe(1)
    expect(buckets.submitted).toBe(1)
    expect(buckets.inHand).toBe(1)

    const primary =
      buckets.awaitingReply + buckets.overdue + buckets.submitted + buckets.inHand +
      buckets.drafting + buckets.awarded + buckets.rejected + buckets.declined + buckets.cancelled
    expect(primary).toBe(rows.length)

    expect(buckets.goneQuiet).toBe(2)
    expect(buckets.overdueUnchased).toBe(1)
  })
})

describe('deriveAssignmentProgress with a proposal record', () => {
  const now = new Date('2026-09-20T10:00:00Z')

  const live = {
    status: 'ACCEPTED',
    outcome: 'PENDING',
    created_at: new Date('2026-08-01T10:00:00Z'),
    responded_at: new Date('2026-08-02T10:00:00Z'),
    submitted_at: null,
    deadline_at: new Date('2026-10-01T10:00:00Z'),
  } as any

  it('counts an open proposal as drafting, like a Draft One workspace', () => {
    const withProposal = deriveAssignmentProgress(live, null, false, now, {
      status: 'IN_REVIEW',
    })
    expect(withProposal.code).toBe('DRAFTING')

    const without = deriveAssignmentProgress(live, null, false, now, null)
    expect(without.code).toBe('IN_HAND')
  })

  it('treats a fresh draft as activity, so the applicant is not "gone quiet"', () => {
    const silent = deriveAssignmentProgress(live, null, false, now, null)
    expect(silent.goneQuiet).toBe(true)

    const active = deriveAssignmentProgress(live, null, false, now, {
      status: 'IN_REVIEW',
      latestActivityAt: new Date('2026-09-18T10:00:00Z'),
    })
    expect(active.goneQuiet).toBe(false)
    expect(active.daysSilent).toBe(2)
  })

  it('reports the proposal status alongside the code, never inside it', () => {
    const progress = deriveAssignmentProgress(live, null, false, now, { status: 'CLEARED' })
    expect(progress.proposalStatus).toBe('CLEARED')
    // The ladder's own codes are untouched, so every existing count still sums.
    expect(['AWARDED','REJECTED','SUBMITTED','DECLINED','CANCELLED','OVERDUE','AWAITING_REPLY','DRAFTING','IN_HAND'])
      .toContain(progress.code)
  })

  it('never lets a proposal outrank a real outcome', () => {
    const awarded = deriveAssignmentProgress(
      { ...live, outcome: 'AWARDED' },
      null,
      false,
      now,
      { status: 'IN_REVIEW' }
    )
    expect(awarded.code).toBe('AWARDED')
  })
})
