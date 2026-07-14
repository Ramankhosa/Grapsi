import { describe, expect, it } from 'vitest'

import {
  sanitizeGrantRuleText,
  splitGrantRuleTextIntoPoints,
  summarizeGrantRuleText,
} from '@/lib/grants/ruleText'

// The exact failure observed in production: extractor text with a raw
// scroll-to-text source URL glued straight onto the prose.
const ICMR_RULE =
  'Concept notes must specify the domain and priority area, technical readiness level (≥3), objectives, study design and methodology (including study participants, interventions, outcomes, sample size, data collection, data management, analysis and ethical considerations), project implementation plan with milestone chart, risks and challenges, expected outcomes (up to 500 words) and referenceswww.icmr.gov.in/icmrobject/uploads/Call/1780383566_eoiforconceptproposalsonpriorityresearchtopicsintb.pdf#:~:text=b,as%20therapeutics%2C%20regimens%2C%20primary%20or'

describe('sanitizeGrantRuleText', () => {
  it('strips glued scroll-to-text source URLs from extractor prose', () => {
    const cleaned = sanitizeGrantRuleText(ICMR_RULE)
    expect(cleaned).not.toMatch(/www\./)
    expect(cleaned).not.toMatch(/icmr\.gov\.in/)
    expect(cleaned).not.toMatch(/#:~:text=/)
    expect(cleaned).not.toMatch(/%20/)
    expect(cleaned).toContain('Concept notes must specify the domain and priority area')
    expect(cleaned).toContain('expected outcomes (up to 500 words)')
  })

  it('strips scheme URLs and bare domain paths', () => {
    expect(sanitizeGrantRuleText('See https://example.org/guide.pdf for details')).toBe('See for details')
    expect(sanitizeGrantRuleText('Budget rules at icmr.gov.in/uploads/budget.pdf apply')).toBe('Budget rules at apply')
  })

  it('normalizes whitespace and orphan punctuation', () => {
    expect(sanitizeGrantRuleText('  Cover   the objectives ,  and timeline :  ')).toBe('Cover the objectives, and timeline')
  })

  it('returns empty string for URL-only input', () => {
    expect(sanitizeGrantRuleText('www.example.org/file.pdf#:~:text=a%2Cb')).toBe('')
  })
})

describe('splitGrantRuleTextIntoPoints', () => {
  it('keeps short rules as a single point', () => {
    expect(splitGrantRuleTextIntoPoints('State the total budget in INR.')).toEqual(['State the total budget in INR.'])
  })

  it('splits a giant enumeration into atomic checkable points without breaking parentheticals', () => {
    const points = splitGrantRuleTextIntoPoints(ICMR_RULE, { maxPoints: 6 })
    expect(points.length).toBeGreaterThan(1)
    expect(points.length).toBeLessThanOrEqual(6)
    for (const point of points) {
      expect(point.length).toBeLessThanOrEqual(181)
      expect(point).not.toMatch(/www\./)
    }
    // Top-level comma split must not break inside "(including study participants, interventions, ...)".
    const methodology = points.find((point) => point.includes('study design and methodology'))
    expect(methodology).toBeTruthy()
    expect(methodology).toContain('(including study participants')
  })

  it('returns empty for empty input', () => {
    expect(splitGrantRuleTextIntoPoints('')).toEqual([])
  })
})

describe('summarizeGrantRuleText', () => {
  it('truncates at a word boundary with an ellipsis', () => {
    const summary = summarizeGrantRuleText(ICMR_RULE, 90)
    expect(summary.length).toBeLessThanOrEqual(91)
    expect(summary.endsWith('…')).toBe(true)
    expect(summary).not.toMatch(/www\./)
  })

  it('returns short text unchanged', () => {
    expect(summarizeGrantRuleText('Stay under 24 months.', 140)).toBe('Stay under 24 months.')
  })
})
