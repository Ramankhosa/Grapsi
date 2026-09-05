import { describe, expect, it } from 'vitest'

import {
  describeProposalEvent,
  type ProposalEventRow,
} from '@/components/proposals/ProposalHistory'
import { PROPOSAL_EVENT_KINDS } from '@/lib/proposals/shared'

/**
 * The history is the one place a reader meets every event kind, and its
 * fallback is a de-underscored enum name — so a kind added to the services and
 * forgotten here does not fail, it just prints "milestone changed" at a
 * professor. That happened once already. This test is the reason it cannot
 * happen quietly a second time.
 */

function event(kind: string, payload: Record<string, unknown> = {}): ProposalEventRow {
  return {
    id: `evt-${kind}`,
    kind,
    fromStatus: null,
    toStatus: null,
    payload,
    visibleToFaculty: true,
    createdAt: new Date('2026-09-05T10:00:00Z').toISOString(),
    actor: 'Priya Menon',
  }
}

/** What the fallback would produce, which no kind is allowed to settle for. */
function fallbackFor(kind: string): string {
  return kind.toLowerCase().replace(/_/g, ' ')
}

describe('describeProposalEvent', () => {
  it('has real copy for every event kind the services write', () => {
    const bare: string[] = []
    for (const kind of PROPOSAL_EVENT_KINDS) {
      const sentence = describeProposalEvent(event(kind))
      if (sentence === fallbackFor(kind)) bare.push(kind)
    }
    expect(bare).toEqual([])
  })

  it('never returns an empty string, whatever the payload', () => {
    for (const kind of PROPOSAL_EVENT_KINDS) {
      expect(describeProposalEvent(event(kind)).trim().length).toBeGreaterThan(0)
      // A row written before a payload field existed must still read.
      expect(
        describeProposalEvent({ ...event(kind), payload: null } as ProposalEventRow).trim().length
      ).toBeGreaterThan(0)
    }
  })

  it('names the letter that was issued, and says when one is withdrawn', () => {
    expect(
      describeProposalEvent(
        event('DOCUMENT_ISSUED', { title: 'Endorsement letter', referenceNo: 'DSR/2026/114' })
      )
    ).toBe('Endorsement letter issued (DSR/2026/114).')

    expect(
      describeProposalEvent(event('DOCUMENT_ISSUED', { withdrawn: true, title: 'Endorsement letter' }))
    ).toBe('Endorsement letter was withdrawn.')
  })

  it('gives the reason a required attachment was waived', () => {
    expect(
      describeProposalEvent(
        event('CHECKLIST_CHANGED', {
          label: 'Ethics clearance',
          to: 'WAIVED',
          note: 'Desk research only',
        })
      )
    ).toBe('Ethics clearance — waived: Desk research only')

    expect(
      describeProposalEvent(event('CHECKLIST_CHANGED', { label: 'Investigator CV', to: 'DONE' }))
    ).toBe('Investigator CV — received.')
  })

  it('reads a follow-up as a sentence rather than a dropdown label', () => {
    const sentence = describeProposalEvent(
      event('FOLLOW_UP', {
        contactKind: 'CALL',
        note: 'With the expert committee',
        movedTo: 'UNDER_AGENCY_REVIEW',
      })
    )
    expect(sentence).toBe(
      'Followed up by phone — now under agency review: With the expert committee'
    )
    // The nouns from the form would have produced "by phone call".
    expect(sentence).not.toContain('by phone call')
  })

  it('describes a whole post-award schedule in one line', () => {
    expect(
      describeProposalEvent(event('MILESTONE_CHANGED', { scheduled: true, years: 3, count: 6 }))
    ).toBe('Post-award schedule set up — 6 obligations over 3 years.')

    // One year is not "1 years".
    expect(
      describeProposalEvent(event('MILESTONE_CHANGED', { scheduled: true, years: 1, count: 2 }))
    ).toContain('over 1 year.')
  })

  it('keeps the original end date visible when a project is extended', () => {
    const sentence = describeProposalEvent(
      event('MILESTONE_CHANGED', {
        projectDates: true,
        extension: true,
        previousEnd: '2028-04-01T00:00:00.000Z',
        endAt: '2028-09-30T00:00:00.000Z',
        reason: 'Agency granted six months',
      })
    )
    expect(sentence).toContain('extended')
    expect(sentence).toContain('Agency granted six months')
    // An extension that silently overwrote the old date would be unauditable.
    expect(sentence).toMatch(/from .*2028/)
  })

  it('marks an obligation with its own status word', () => {
    expect(
      describeProposalEvent(
        event('MILESTONE_CHANGED', { title: 'Utilisation certificate — year 1', to: 'SUBMITTED' })
      )
    ).toBe('Utilisation certificate — year 1 marked submitted.')
  })
})
