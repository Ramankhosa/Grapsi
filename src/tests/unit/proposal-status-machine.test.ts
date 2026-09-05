import { describe, expect, it } from 'vitest'

import {
  CLEAR_WITHOUT_REVIEW,
  CUTOFF_PASSED,
  OVERRIDE_REASON_REQUIRED,
  nextActionFor,
  validateProposalTransition,
  validateVersionUpload,
} from '@/lib/proposals/statusMachine'

describe('validateProposalTransition', () => {
  it('walks the ordinary path', () => {
    expect(
      validateProposalTransition({ from: 'DRAFT', to: 'IN_REVIEW', lens: 'officer' }).ok
    ).toBe(true)
    expect(
      validateProposalTransition({
        from: 'IN_REVIEW',
        to: 'CLEARED',
        lens: 'officer',
        hasSharedReview: true,
      }).ok
    ).toBe(true)
    expect(
      validateProposalTransition({ from: 'CLEARED', to: 'SUBMITTED', lens: 'officer' }).ok
    ).toBe(true)
    expect(
      validateProposalTransition({ from: 'SUBMITTED', to: 'SANCTIONED', lens: 'officer' }).ok
    ).toBe(true)
  })

  it('refuses a jump the process does not allow', () => {
    const result = validateProposalTransition({ from: 'DRAFT', to: 'SANCTIONED', lens: 'admin' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('cannot go from')
  })

  it('refuses a no-op', () => {
    expect(validateProposalTransition({ from: 'IN_REVIEW', to: 'IN_REVIEW', lens: 'officer' }).ok).toBe(
      false
    )
  })

  it('never lets a Dean change anything', () => {
    const result = validateProposalTransition({ from: 'DRAFT', to: 'IN_REVIEW', lens: 'head' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('read-only')
  })

  it('lets a faculty member withdraw but not clear their own proposal', () => {
    expect(validateProposalTransition({ from: 'IN_REVIEW', to: 'WITHDRAWN', lens: 'faculty' }).ok).toBe(
      true
    )

    const clearing = validateProposalTransition({
      from: 'IN_REVIEW',
      to: 'CLEARED',
      lens: 'faculty',
      hasSharedReview: true,
    })
    expect(clearing.ok).toBe(false)
    if (!clearing.ok) expect(clearing.error).toContain('Only the funding department')
  })

  it('honours the tenant switch on who records an agency submission', () => {
    const blocked = validateProposalTransition({
      from: 'CLEARED',
      to: 'SUBMITTED',
      lens: 'faculty',
      facultyMayRecordSubmission: false,
    })
    expect(blocked.ok).toBe(false)

    expect(
      validateProposalTransition({
        from: 'CLEARED',
        to: 'SUBMITTED',
        lens: 'faculty',
        facultyMayRecordSubmission: true,
      }).ok
    ).toBe(true)
  })

  it('will not clear an unreviewed proposal silently, but will with a reason', () => {
    const bare = validateProposalTransition({
      from: 'IN_REVIEW',
      to: 'CLEARED',
      lens: 'officer',
      hasSharedReview: false,
    })
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.error).toBe(CLEAR_WITHOUT_REVIEW)

    expect(
      validateProposalTransition({
        from: 'IN_REVIEW',
        to: 'CLEARED',
        lens: 'officer',
        hasSharedReview: false,
        overrideReason: 'Deadline is tomorrow; PVC approved verbally.',
      }).ok
    ).toBe(true)
  })

  it('sends an agency revision request back through the department', () => {
    expect(
      validateProposalTransition({ from: 'REVISION_REQUESTED', to: 'IN_REVIEW', lens: 'officer' }).ok
    ).toBe(true)
  })

  it('closes out a finished record and goes no further', () => {
    expect(validateProposalTransition({ from: 'SANCTIONED', to: 'CLOSED', lens: 'officer' }).ok).toBe(
      true
    )
    expect(validateProposalTransition({ from: 'CLOSED', to: 'IN_REVIEW', lens: 'admin' }).ok).toBe(
      false
    )
  })
})

describe('validateVersionUpload', () => {
  const now = new Date('2026-09-10T10:00:00Z')

  it('accepts a draft before the cut-off', () => {
    expect(
      validateVersionUpload({
        status: 'IN_REVIEW',
        lens: 'faculty',
        reviewCutoffAt: '2026-09-20T00:00:00Z',
        now,
      }).ok
    ).toBe(true)
  })

  it('accepts a draft when no cut-off is set', () => {
    expect(validateVersionUpload({ status: 'DRAFT', lens: 'faculty', now }).ok).toBe(true)
  })

  it('blocks a faculty upload after the cut-off', () => {
    const result = validateVersionUpload({
      status: 'IN_REVIEW',
      lens: 'faculty',
      reviewCutoffAt: '2026-09-01T00:00:00Z',
      now,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(CUTOFF_PASSED)
  })

  it('lets an officer take a late draft, but only with a reason', () => {
    const bare = validateVersionUpload({
      status: 'IN_REVIEW',
      lens: 'officer',
      reviewCutoffAt: '2026-09-01T00:00:00Z',
      now,
    })
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.error).toBe(OVERRIDE_REASON_REQUIRED)

    expect(
      validateVersionUpload({
        status: 'IN_REVIEW',
        lens: 'officer',
        reviewCutoffAt: '2026-09-01T00:00:00Z',
        overrideReason: 'Agency extended the deadline by a week.',
        now,
      }).ok
    ).toBe(true)
  })

  it('stops uploads once the application has gone to the agency', () => {
    for (const status of ['SUBMITTED', 'SANCTIONED', 'REJECTED', 'CLOSED'] as const) {
      expect(validateVersionUpload({ status, lens: 'officer', now }).ok).toBe(false)
    }
  })

  it('asks a cleared proposal to be reopened before the applicant adds a draft', () => {
    const faculty = validateVersionUpload({ status: 'CLEARED', lens: 'faculty', now })
    expect(faculty.ok).toBe(false)
    if (!faculty.ok) expect(faculty.error).toContain('reopen')

    // The officer can simply take it.
    expect(validateVersionUpload({ status: 'CLEARED', lens: 'officer', now }).ok).toBe(true)
  })

  it('never lets a Dean upload', () => {
    expect(validateVersionUpload({ status: 'DRAFT', lens: 'head', now }).ok).toBe(false)
  })
})

describe('nextActionFor', () => {
  const now = new Date('2026-09-10T10:00:00Z')

  it('asks for the first draft, then waits on the department', () => {
    expect(nextActionFor({ status: 'DRAFT', currentVersionNo: 0, now })).toMatchObject({
      actor: 'faculty',
    })
    expect(nextActionFor({ status: 'DRAFT', currentVersionNo: 1, now })).toMatchObject({
      actor: 'officer',
    })
  })

  it('counts the days left to revise once a review was shared', () => {
    const action = nextActionFor({
      status: 'IN_REVIEW',
      currentVersionNo: 1,
      latestVersionReviewStatus: 'SHARED',
      reviewCutoffAt: '2026-09-13T10:00:00Z',
      now,
    })
    expect(action.actor).toBe('faculty')
    expect(action.text).toContain('3 days')
  })

  it('names the department while a run is in flight or unshared', () => {
    expect(
      nextActionFor({ status: 'IN_REVIEW', currentVersionNo: 1, latestVersionReviewStatus: 'RUNNING', now })
    ).toMatchObject({ actor: 'officer' })
    expect(
      nextActionFor({ status: 'IN_REVIEW', currentVersionNo: 1, latestVersionReviewStatus: 'REVIEWED', now })
    ).toMatchObject({ actor: 'officer' })
  })

  it('hands a cleared proposal back to the applicant, and a submitted one to the agency', () => {
    expect(nextActionFor({ status: 'CLEARED', currentVersionNo: 2, now })).toMatchObject({
      actor: 'faculty',
    })
    expect(nextActionFor({ status: 'SUBMITTED', currentVersionNo: 2, now })).toMatchObject({
      actor: 'agency',
    })
  })

  it('says nothing for a finished record', () => {
    expect(nextActionFor({ status: 'CLOSED', currentVersionNo: 2, now }).text).toBe('')
  })
})
