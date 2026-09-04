import { describe, expect, it } from 'vitest'

import {
  SUBMISSION_PROOF_REQUIRED,
  buildSubmissionUpdate,
} from '@/lib/assignments/submission'

const NOW = new Date('2026-09-20T10:00:00.000Z')
const empty = {
  submission_reference: null,
  submission_url: null,
  submission_notes: null,
  submitted_at: null,
}

describe('buildSubmissionUpdate', () => {
  it('refuses a completion with nothing attached', () => {
    const result = buildSubmissionUpdate({ record: empty, now: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(SUBMISSION_PROOF_REQUIRED)
  })

  it('treats whitespace as no proof at all', () => {
    const result = buildSubmissionUpdate({ record: empty, reference: '   ', notes: '', now: NOW })
    expect(result.ok).toBe(false)
  })

  it('accepts any one of reference, link or notes', () => {
    for (const proof of [{ reference: 'SERB/2026/112' }, { url: 'https://x.test/a' }, { notes: 'Filed on the portal' }]) {
      const result = buildSubmissionUpdate({ record: empty, ...proof, now: NOW })
      expect(result.ok).toBe(true)
    }
  })

  it('accepts proof already on the record, so re-completing needs no retyping', () => {
    const result = buildSubmissionUpdate({
      record: { ...empty, submission_reference: 'SERB/2026/112' },
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Nothing was passed, so nothing is overwritten.
      expect(result.data.submission_reference).toBeUndefined()
      expect(result.data.status).toBe('COMPLETED')
    }
  })

  it('dates the submission when it happened, not when it was recorded', () => {
    const happenedAt = new Date('2026-09-15T06:00:00.000Z')
    const result = buildSubmissionUpdate({
      record: empty,
      notes: 'Told me on the phone',
      submittedAt: happenedAt,
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.submitted_at.toISOString()).toBe(happenedAt.toISOString())
      expect(result.data.completed_at.toISOString()).toBe(NOW.toISOString())
    }
  })

  it('keeps an existing submission date when none is supplied', () => {
    const earlier = new Date('2026-08-01T00:00:00.000Z')
    const result = buildSubmissionUpdate({
      record: { ...empty, submission_notes: 'Filed', submitted_at: earlier },
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.submitted_at.toISOString()).toBe(earlier.toISOString())
  })

  it('gives the assignments route and the follow-up route the same row', () => {
    const fromPatch = buildSubmissionUpdate({
      record: empty,
      notes: 'Submitted on the portal',
      submittedAt: new Date('2026-09-18T00:00:00.000Z'),
      now: NOW,
    })
    const fromFollowUp = buildSubmissionUpdate({
      record: empty,
      notes: 'Submitted on the portal',
      submittedAt: new Date('2026-09-18T00:00:00.000Z'),
      now: NOW,
    })
    expect(fromPatch).toEqual(fromFollowUp)
  })
})
