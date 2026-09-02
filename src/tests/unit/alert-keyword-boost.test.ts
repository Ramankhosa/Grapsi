import { describe, expect, it } from 'vitest'

import {
  boostTierForKeywords,
  matchedAlertKeywords,
} from '@/lib/funding/alertKeywordBoost'

// A researcher's saved alert keywords promote a weak embedding match to
// moderate when the call's text hits one of them. These tests pin the text
// semantics: word boundaries, case, phrases, symbols, and the short-keyword
// discard.

const CALL = {
  title: 'Quantum Sensing for Climate Monitoring',
  schemeTitle: 'National Quantum Mission — Call 4',
  summary: 'Supports photonics and gene editing research groups.',
  description: 'Projects on COVID-19 surveillance are in scope.',
  disciplines: ['Photonics', 'Synthetic Biology'],
}

describe('matchedAlertKeywords', () => {
  it('matches case-insensitively across title, summary, description and disciplines', () => {
    expect(matchedAlertKeywords(CALL, ['QUANTUM'])).toEqual(['QUANTUM'])
    expect(matchedAlertKeywords(CALL, ['photonics'])).toEqual(['photonics'])
    expect(matchedAlertKeywords(CALL, ['synthetic biology'])).toEqual(['synthetic biology'])
  })

  it('matches multi-word phrases as phrases', () => {
    expect(matchedAlertKeywords(CALL, ['climate monitoring'])).toEqual(['climate monitoring'])
    expect(matchedAlertKeywords(CALL, ['monitoring climate'])).toEqual([])
  })

  it('respects word boundaries — "gene" must not hit "generation"', () => {
    const call = { title: 'Next generation networks' }
    expect(matchedAlertKeywords(call, ['gene'])).toEqual([])
    expect(matchedAlertKeywords(CALL, ['gene'])).toEqual(['gene'])
  })

  it('falls back to substring matching for symbol-bearing keywords', () => {
    expect(matchedAlertKeywords(CALL, ['COVID-19'])).toEqual(['COVID-19'])
    const cppCall = { title: 'High-performance C++ toolchains' }
    expect(matchedAlertKeywords(cppCall, ['C++'])).toEqual(['C++'])
  })

  it('discards keywords shorter than 3 characters', () => {
    const call = { title: 'AI for everyone' }
    expect(matchedAlertKeywords(call, ['AI'])).toEqual([])
  })

  it('returns empty for empty inputs', () => {
    expect(matchedAlertKeywords(CALL, [])).toEqual([])
    expect(matchedAlertKeywords({}, ['quantum'])).toEqual([])
  })

  it('dedupes keywords that normalize to the same text', () => {
    expect(matchedAlertKeywords(CALL, ['Quantum', ' quantum '])).toEqual(['Quantum'])
  })
})

describe('boostTierForKeywords', () => {
  it('promotes a weak match to moderate on a keyword hit', () => {
    expect(boostTierForKeywords('weak', ['quantum'], CALL)).toBe('moderate')
  })

  it('leaves a weak match weak with no hit', () => {
    expect(boostTierForKeywords('weak', ['astrophysics'], CALL)).toBe('weak')
  })

  it('passes higher tiers through untouched, even on a hit', () => {
    expect(boostTierForKeywords('moderate', ['quantum'], CALL)).toBe('moderate')
    expect(boostTierForKeywords('strong', ['quantum'], CALL)).toBe('strong')
  })
})
