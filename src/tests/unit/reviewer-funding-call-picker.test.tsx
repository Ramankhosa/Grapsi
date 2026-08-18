import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import FundingCallPicker from '@/components/reviewer/FundingCallPicker'
import {
  dedupeById,
  filterCallsLocally,
  formatCallDeadline,
  resolveVisibleCalls,
  splitOnQuery,
  type FundingCallOption,
} from '@/lib/reviewer/fundingCallPicker'

function makeCall(overrides: Partial<FundingCallOption> = {}): FundingCallOption {
  return {
    id: overrides.id || 'call-1',
    title: overrides.title || 'National quantum mission',
    agencyName: overrides.agencyName === undefined ? 'DST' : overrides.agencyName,
    summary: overrides.summary === undefined ? 'Supports quantum research groups.' : overrides.summary,
    deadlineAt: overrides.deadlineAt === undefined ? '2026-09-12T00:00:00.000Z' : overrides.deadlineAt,
    sourceUrl: overrides.sourceUrl === undefined ? 'https://example.org/call' : overrides.sourceUrl,
    readiness: overrides.readiness || 'template_manual',
    readinessLabel: overrides.readinessLabel || 'Approved template',
  }
}

describe('funding call picker list maths', () => {
  it('drops duplicate ids so two rows can never share a React key', () => {
    const calls = dedupeById([
      makeCall({ id: 'a' }),
      makeCall({ id: 'b' }),
      makeCall({ id: 'a', title: 'Same id, later copy' }),
      null,
    ])

    expect(calls.map((call) => call.id)).toEqual(['a', 'b'])
    expect(calls[0].title).toBe('National quantum mission')
  })

  it('matches on title, agency, and summary', () => {
    const library = [
      makeCall({ id: 'a', title: 'Quantum mission', agencyName: 'DST', summary: null }),
      makeCall({ id: 'b', title: 'Vaccine platform', agencyName: 'ICMR', summary: 'Covers cold chain work.' }),
    ]

    expect(filterCallsLocally(library, 'quantum').map((call) => call.id)).toEqual(['a'])
    expect(filterCallsLocally(library, 'icmr').map((call) => call.id)).toEqual(['b'])
    expect(filterCallsLocally(library, 'cold chain').map((call) => call.id)).toEqual(['b'])
    expect(filterCallsLocally(library, '   ')).toHaveLength(2)
  })

  it('shows the whole library when nothing is typed', () => {
    const library = [makeCall({ id: 'a' }), makeCall({ id: 'b' })]

    expect(resolveVisibleCalls({ library, query: '', remote: null })).toHaveLength(2)
  })

  it('surfaces server hits for calls outside the loaded page, without losing local matches', () => {
    const library = [
      makeCall({ id: 'local', title: 'Quantum sensing pilot', summary: null }),
      makeCall({ id: 'other', title: 'Unrelated scheme', agencyName: 'CSIR', summary: null }),
    ]
    // The call the user is after is old, so it never came back in the first page.
    const remote = { query: 'quantum', calls: [makeCall({ id: 'deep', title: 'Quantum legacy mission' })] }

    const visible = resolveVisibleCalls({ library, query: 'quantum', remote })

    expect(visible.map((call) => call.id)).toEqual(['deep', 'local'])
  })

  it('ignores server results that answered an earlier query', () => {
    const library = [makeCall({ id: 'local', title: 'Quantum sensing pilot', summary: null })]
    const stale = { query: 'vaccine', calls: [makeCall({ id: 'vaccine-call', title: 'Vaccine platform' })] }

    const visible = resolveVisibleCalls({ library, query: 'quantum', remote: stale })

    expect(visible.map((call) => call.id)).toEqual(['local'])
  })

  it('formats deadlines and tolerates missing or broken dates', () => {
    expect(formatCallDeadline('2026-09-12T00:00:00.000Z')).toMatch(/2026/)
    expect(formatCallDeadline(null)).toBeNull()
    expect(formatCallDeadline('not a date')).toBeNull()
  })

  it('highlights matches without choking on regex characters typed into search', () => {
    expect(splitOnQuery('Quantum mission', 'quantum')).toEqual([
      { text: 'Quantum', match: true },
      { text: ' mission', match: false },
    ])
    expect(() => splitOnQuery('C++ (phase 2) grant', 'C++ (phase')).not.toThrow()
    expect(splitOnQuery('C++ (phase 2) grant', 'C++ (phase')).toEqual([
      { text: 'C++ (phase', match: true },
      { text: ' 2) grant', match: false },
    ])
  })
})

describe('funding call picker rendering', () => {
  it('renders the selected call from the selection itself, not from the loaded list', () => {
    // `enabled={false}` keeps the library empty, standing in for a selected call
    // that the current search or page of results does not contain.
    const markup = renderToStaticMarkup(
      <FundingCallPicker
        value={makeCall({ id: 'off-list', title: 'Deep archive scheme', agencyName: 'DRDO' })}
        onChange={() => {}}
        enabled={false}
      />
    )

    expect(markup).toContain('Deep archive scheme')
    expect(markup).toContain('DRDO')
    expect(markup).toContain('Approved template')
  })

  it('never renders a native select, whose DOM selection can drift from state', () => {
    const markup = renderToStaticMarkup(
      <FundingCallPicker value={null} onChange={() => {}} enabled={false} />
    )

    expect(markup).not.toContain('<select')
    expect(markup).not.toContain('<option')
  })
})
