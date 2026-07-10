import { describe, expect, it } from 'vitest'

import {
  buildDeterministicIdeaAnchor,
  hashGrantPrepIdeaAnchor,
  normalizeGrantPrepIdeaAnchor,
} from '@/lib/grantPrep/ideaAnchor'

const LONG_IDEA_TEXT = [
  'Develop a solar-powered cold-chain microgrid for smallholder dairy cooperatives in rural Punjab that cuts post-harvest milk spoilage.',
  'The problem is that over 30% of milk collected in remote villages spoils before reaching chilling centres due to unreliable grid power.',
  'Our approach combines modular photovoltaic refrigeration units with an IoT-based routing layer that dynamically assigns collection vehicles.',
  'Beneficiaries are roughly 4,000 smallholder dairy farmers organised across 60 village-level cooperative societies in three districts.',
  'The project will also train village-level technicians, mostly women from self-help groups, to maintain the refrigeration units locally and build a sustainable service economy around the cold chain.',
].join(' ') // > 600 chars, mirrors the ideaText the Draft Zero route builds (up to 4000 chars)

describe('buildDeterministicIdeaAnchor', () => {
  it('builds an anchor from a long Draft Zero idea text instead of throwing', () => {
    // Regression: option.text > 600 chars used to fail anchorSchema.safeParse
    // (cleanText produced maxLength + 2 chars) and threw
    // "The selected idea could not be normalized into an anchor."
    expect(LONG_IDEA_TEXT.length).toBeGreaterThan(600)
    const anchor = buildDeterministicIdeaAnchor(
      { text: LONG_IDEA_TEXT, rationale: 'Strong fit with the rural energy access priority.' },
      ['Rural energy access', 'Agri value chains']
    )
    expect(anchor.title).toBeTruthy()
    expect(anchor.oneSentenceSummary.length).toBeLessThanOrEqual(600)
    expect(anchor.coreApproach.length).toBeLessThanOrEqual(600)
    for (const item of anchor.nonNegotiables) expect(item.length).toBeLessThanOrEqual(240)
    for (const keyword of anchor.keywords) expect(keyword.length).toBeLessThanOrEqual(80)
    expect(hashGrantPrepIdeaAnchor(anchor)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles the 4000-char worst case the generate route can produce', () => {
    const text = 'A '.repeat(1000) + LONG_IDEA_TEXT
    const anchor = buildDeterministicIdeaAnchor({ text: text.slice(0, 4000), rationale: null }, [])
    expect(anchor.oneSentenceSummary.length).toBeLessThanOrEqual(600)
  })

  it('handles priority areas longer than the 80-char keyword cap', () => {
    const longArea = 'Sustainable and inclusive agricultural transformation for climate-resilient smallholder livelihoods'
    expect(longArea.length).toBeGreaterThan(80)
    const anchor = buildDeterministicIdeaAnchor({ text: LONG_IDEA_TEXT, rationale: null }, [longArea])
    for (const keyword of anchor.keywords) expect(keyword.length).toBeLessThanOrEqual(80)
  })
})

describe('normalizeGrantPrepIdeaAnchor', () => {
  it('truncates over-length LLM fields instead of rejecting the whole anchor', () => {
    const anchor = normalizeGrantPrepIdeaAnchor({
      version: 'idea_anchor_v1',
      title: 'T'.repeat(700),
      oneSentenceSummary: 'S'.repeat(700),
      coreApproach: 'C'.repeat(700),
      nonNegotiables: ['N'.repeat(500)],
      keywords: ['K'.repeat(120)],
    })
    expect(anchor).not.toBeNull()
    expect(anchor!.title.length).toBeLessThanOrEqual(180)
    expect(anchor!.oneSentenceSummary.length).toBeLessThanOrEqual(600)
    expect(anchor!.coreApproach.length).toBeLessThanOrEqual(600)
    expect(anchor!.nonNegotiables[0].length).toBeLessThanOrEqual(240)
    expect(anchor!.keywords[0].length).toBeLessThanOrEqual(80)
  })

  it('still rejects anchors missing a title or summary', () => {
    expect(normalizeGrantPrepIdeaAnchor({ title: '', oneSentenceSummary: 'x' })).toBeNull()
    expect(normalizeGrantPrepIdeaAnchor({ title: 'x' })).toBeNull()
    expect(normalizeGrantPrepIdeaAnchor(null)).toBeNull()
    expect(normalizeGrantPrepIdeaAnchor({ title: '   ', oneSentenceSummary: 'x' })).toBeNull()
  })

  it('caps list item counts', () => {
    const anchor = normalizeGrantPrepIdeaAnchor({
      title: 'Title',
      oneSentenceSummary: 'Summary',
      funderFit: Array.from({ length: 20 }, (_, i) => `fit ${i}`),
      keywords: Array.from({ length: 40 }, (_, i) => `kw ${i}`),
    })
    expect(anchor!.funderFit.length).toBeLessThanOrEqual(6)
    expect(anchor!.keywords.length).toBeLessThanOrEqual(16)
  })
})
