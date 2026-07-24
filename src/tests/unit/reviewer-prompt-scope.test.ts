import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }))
// Both provider modules build a client at import time from env credentials,
// which this pure-logic suite has no need for.
vi.mock('../../../lib/openaiService', () => ({ generateFromOpenAI: vi.fn() }))
vi.mock('../../../lib/geminiService', () => ({
  generateFromGemini: vi.fn(),
  generateFromGeminiWithFiles: vi.fn(),
  isGeminiRateLimitErrorLike: vi.fn(() => false),
  getGeminiRetryAfterMs: vi.fn(() => null),
}))

import { normalizeReviewerCallContext } from '@/lib/reviewer/callContext'
import { buildFallbackContextSummary } from '@/lib/reviewer/content'
import { selectContextProviderTitles } from '../../../lib/reviewerService'

/**
 * A URL-extracted call as it reaches the reviewer: several narrative sections
 * routed to different buckets, plus one annexure that must never be scored.
 */
function urlExtractedContext() {
  return normalizeReviewerCallContext({
    title: 'Mission Call',
    agency_name: 'Agency',
    rules_source: 'url_extracted',
    template_sections: [
      {
        label: 'Methodology',
        bucketKey: 'methodology',
        requiredFacts: ['State the sample size'],
        wordLimit: 2000,
      },
      {
        label: 'Budget Justification',
        bucketKey: 'budget',
        requiredFacts: ['Justify every equipment line'],
      },
      {
        label: 'Annexure II: Endorsement form',
        bucketKey: 'attachments_submission',
        requiredFacts: ['Head of institution signature'],
      },
    ],
    scoring_criteria: [{ label: 'Feasibility', weight: 50 }],
  })
}

describe('reviewer rule scoping for URL-extracted calls', () => {
  it('keeps each section rule attached to its own bucket', () => {
    const context = urlExtractedContext()
    const methodology = context.template_sections.find((section) => section.bucketKey === 'methodology')
    const budget = context.template_sections.find((section) => section.bucketKey === 'budget')

    expect(methodology?.workflowMode).toBe('app_draft')
    expect(budget?.workflowMode).toBe('app_draft')
    // Both are app_draft with distinct buckets, which is what makes the prompt
    // builder file each rule under its own section rather than globally.
    expect(methodology?.bucketKey).not.toBe(budget?.bucketKey)
  })

  it('routes the annexure away from scored narrative', () => {
    const context = urlExtractedContext()
    const annexure = context.template_sections.find(
      (section) => section.bucketKey === 'attachments_submission'
    )

    expect(annexure?.workflowMode).toBe('external')
  })

  it('lists mandatory sections and length rules the reviewer can check', () => {
    const context = urlExtractedContext()

    expect(context.mandatory_sections).toEqual([])
    expect(context.reviewer_context_text).toContain('Methodology (Methodology / Approach): 2000 words')
    expect(context.reviewer_context_text).toContain('Feasibility (weight 50)')
  })
})

describe('context-summary provider selection', () => {
  it('skips sections no other section reads as context', () => {
    const providers = selectContextProviderTitles([
      'Abstract',
      'Introduction',
      'Objectives',
      'Methodology',
      'Budget Justification',
      'Conclusion',
    ])

    // Abstract feeds Introduction/Objectives/Conclusion; Methodology feeds Budget.
    expect(providers.has('Abstract')).toBe(true)
    expect(providers.has('Objectives')).toBe(true)
    expect(providers.has('Methodology')).toBe(true)

    // Nothing depends on the Conclusion or the Budget, so pre-generating their
    // summaries is a paid call whose output is never read.
    expect(providers.has('Conclusion')).toBe(false)
    expect(providers.has('Budget Justification')).toBe(false)
  })

  it('keeps every section when the titles are non-standard, so nothing is lost', () => {
    const titles = ['Part A', 'Part B', 'Part C']
    const providers = selectContextProviderTitles(titles)

    expect(providers.size).toBe(titles.length)
  })
})

describe('free context-summary fallback', () => {
  it('returns short sections verbatim', () => {
    expect(buildFallbackContextSummary('We will pilot in three districts.')).toBe(
      'We will pilot in three districts.'
    )
  })

  it('clips long sections at a sentence boundary', () => {
    const long = `${'This sentence carries real detail about the workplan. '.repeat(20)}Trailing fragment`
    const summary = buildFallbackContextSummary(long)

    expect(summary.length).toBeLessThanOrEqual(600)
    expect(summary.endsWith('.')).toBe(true)
    expect(summary).not.toContain('Trailing fragment')
  })

  it('never leaves the field blank for content that exists', () => {
    expect(buildFallbackContextSummary('<p>Objectives are listed below.</p>')).toBe(
      'Objectives are listed below.'
    )
    expect(buildFallbackContextSummary('   ')).toBe('')
  })
})
