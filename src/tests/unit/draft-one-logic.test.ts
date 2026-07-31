import { describe, expect, it } from 'vitest'

import {
  buildAiFixInstructions,
  buildAiReviewQueue,
  buildDraftOneQueue,
  countWords,
  normalizeDraftOneSection,
  summarizeDraftOneSections,
} from '@/lib/draftOne/logic'
import type { GrantAiReviewReport } from '@/types/grant'

function makeRawSection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sectionKey: 'problem_need',
    label: 'Problem & Need',
    sectionOrder: 2,
    sectionType: 'narrative',
    workflowMode: 'app_draft',
    citationMode: 'mapped_evidence',
    required: true,
    wordBudget: 800,
    characterLimit: null,
    content: '',
    isStale: false,
    grantAiReviewReport: null,
    grantAiReviewStale: false,
    grantRuleProfile: {
      requiredPoints: ['Name the beneficiary group'],
      evaluationFocus: [],
      reviewerSignals: [],
      avoidRules: ['No unsupported claims'],
      formatConstraints: [],
    },
    ...overrides,
  }
}

function makeAiReview(overrides: Partial<GrantAiReviewReport> = {}): GrantAiReviewReport {
  return {
    version: 1,
    verdict: 'minor_revisions',
    score: 78,
    summary: 'Solid framing but the beneficiary group is never named.',
    strengths: ['Clear problem statement'],
    findings: [
      {
        severity: 'important',
        rule: 'Name the beneficiary group',
        issue: 'The target beneficiary group is never explicitly named.',
        fix: 'Name the beneficiary group (rural adolescent girls, 10-19) in the opening paragraph.',
      },
    ],
    reviewedContentHash: 'abc123',
    generatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('draft one section normalization', () => {
  it('derives status from content, staleness, and the AI review verdict', () => {
    expect(normalizeDraftOneSection(makeRawSection()).status).toBe('pending')
    expect(normalizeDraftOneSection(makeRawSection({ content: 'Drafted text.' })).status).toBe('unreviewed')
    expect(
      normalizeDraftOneSection(
        makeRawSection({ content: 'Drafted text.', grantAiReviewReport: makeAiReview({ verdict: 'ready', findings: [] }) })
      ).status
    ).toBe('ready')
    expect(
      normalizeDraftOneSection(makeRawSection({ content: 'Drafted text.', grantAiReviewReport: makeAiReview() })).status
    ).toBe('issues')
    expect(
      normalizeDraftOneSection(
        makeRawSection({ content: 'Edited.', grantAiReviewReport: makeAiReview({ verdict: 'ready', findings: [] }), grantAiReviewStale: true })
      ).status
    ).toBe('unreviewed')
    expect(normalizeDraftOneSection(makeRawSection({ content: 'Drafted text.', isStale: true })).status).toBe('stale')
    expect(normalizeDraftOneSection(makeRawSection({ workflowMode: 'team_manual' })).status).toBe('manual')
    expect(normalizeDraftOneSection(makeRawSection({ sectionKey: 'bibliography' })).status).toBe('manual')
  })
})

describe('draft one queues', () => {
  it('queues only auto-draftable sections without content (or stale), in template order', () => {
    const sections = [
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'summary', sectionOrder: 1 })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'methodology', sectionOrder: 3 })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'drafted', sectionOrder: 2, content: 'Done already.' })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'stale_one', sectionOrder: 4, content: 'Old.', isStale: true })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'attachments', sectionOrder: 5, workflowMode: 'team_manual' })),
    ]
    const queue = buildDraftOneQueue(sections)
    expect(queue.map((section) => section.sectionKey)).toEqual(['summary', 'methodology', 'stale_one'])
    const full = buildDraftOneQueue(sections, { includeDrafted: true })
    expect(full.map((section) => section.sectionKey)).toEqual(['summary', 'drafted', 'methodology', 'stale_one'])
  })

  it('review queue covers drafted sections without a current verdict', () => {
    const sections = [
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'unreviewed', sectionOrder: 1, content: 'Text.' })),
      normalizeDraftOneSection(
        makeRawSection({ sectionKey: 'edited', sectionOrder: 2, content: 'Text.', grantAiReviewReport: makeAiReview(), grantAiReviewStale: true })
      ),
      normalizeDraftOneSection(
        makeRawSection({ sectionKey: 'done', sectionOrder: 3, content: 'Text.', grantAiReviewReport: makeAiReview({ verdict: 'ready', findings: [] }) })
      ),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'empty', sectionOrder: 4 })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'manual', sectionOrder: 5, workflowMode: 'team_manual' })),
    ]
    expect(buildAiReviewQueue(sections).map((section) => section.sectionKey)).toEqual(['unreviewed', 'edited'])
    expect(buildAiReviewQueue(sections, { includeReviewed: true }).map((section) => section.sectionKey)).toEqual([
      'unreviewed',
      'edited',
      'done',
    ])
  })
})

describe('AI fix instructions', () => {
  it('folds findings by severity, word overage, and the author note into the instruction, capped for the engine', () => {
    const content = Array.from({ length: 900 }, (_, index) => `word${index}`).join(' ')
    const instructions = buildAiFixInstructions({
      section: { label: 'Problem & Need', wordBudget: 800, characterLimit: null, content },
      report: makeAiReview({
        findings: [
          {
            severity: 'critical',
            rule: 'No unsupported claims',
            issue: 'Claims a 40% reduction with no source.',
            fix: 'Cite the pilot evaluation or soften the claim to "reported reductions".',
          },
          {
            severity: 'polish',
            rule: null,
            issue: 'Opening sentence is passive.',
            fix: 'Rewrite the opening sentence in active voice.',
          },
        ],
      }),
      userNote: 'Keep the One Health framing.',
    })
    expect(instructions).toContain('REVISION PASS')
    expect(instructions).toContain('CRITICAL FINDINGS')
    expect(instructions).toContain('Claims a 40% reduction with no source.')
    expect(instructions).toContain('POLISH')
    expect(instructions).toContain('the agency limit is 800')
    expect(instructions).toContain('Keep the One Health framing.')
    expect(instructions.length).toBeLessThanOrEqual(4900)
  })

  it('carries the grant reviewer remarks, highest priority first', () => {
    const instructions = buildAiFixInstructions({
      section: { label: 'Methodology', wordBudget: null, characterLimit: null, content: 'draft' },
      report: null,
      reviewerRecommendations: [
        {
          priority: 'low',
          issue: 'Sampling interval is not stated.',
          recommendation: 'State the sampling interval in weeks.',
          reviewerSectionTitle: 'Methodology',
        },
        {
          priority: 'high',
          issue: 'No control arm is described.',
          recommendation: 'Describe the control arm and how participants are allocated.',
          reviewerSectionTitle: 'Methodology',
        },
      ],
    })

    expect(instructions).toContain('GRANT REVIEWER REMARKS')
    const high = instructions.indexOf('No control arm')
    const low = instructions.indexOf('Sampling interval')
    expect(high).toBeGreaterThan(-1)
    expect(low).toBeGreaterThan(high)
    expect(instructions).toContain('(HIGH)')
    expect(instructions).toContain('[from: Methodology]')
  })

  it('works from reviewer remarks alone when the drafting review has not run', () => {
    const instructions = buildAiFixInstructions({
      section: { label: 'Budget', wordBudget: null, characterLimit: null, content: 'draft' },
      reviewerRecommendations: [{ priority: 'high', recommendation: 'Justify the equipment line.' }],
    })
    expect(instructions).toContain('Justify the equipment line.')
  })

  it('returns nothing to act on when there is neither a report nor a remark', () => {
    expect(
      buildAiFixInstructions({
        section: { label: 'Budget', wordBudget: null, characterLimit: null, content: 'draft' },
        reviewerRecommendations: [],
      })
    ).toBe('')
  })
})

describe('summary + words', () => {
  it('summarizes drafting state across sections', () => {
    const sections = [
      normalizeDraftOneSection(
        makeRawSection({ sectionKey: 'a', content: 'Text', grantAiReviewReport: makeAiReview({ verdict: 'ready', findings: [] }) })
      ),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'b', content: 'Text', grantAiReviewReport: makeAiReview() })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'c', content: 'Text' })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'd' })),
      normalizeDraftOneSection(makeRawSection({ sectionKey: 'attachments', workflowMode: 'team_manual' })),
    ]
    const summary = summarizeDraftOneSections(sections)
    expect(summary).toMatchObject({
      total: 5,
      draftable: 4,
      drafted: 3,
      ready: 1,
      withIssues: 1,
      unreviewed: 1,
      manual: 1,
    })
  })

  it('counts words robustly', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  one   two\nthree ')).toBe(3)
  })
})
