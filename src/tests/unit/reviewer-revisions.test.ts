import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }))
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
vi.mock('../../../lib/openaiService', () => ({ generateFromOpenAI: vi.fn() }))
vi.mock('../../../lib/geminiService', () => ({
  generateFromGemini: vi.fn(),
  generateFromGeminiWithFiles: vi.fn(),
  isGeminiRateLimitErrorLike: vi.fn(() => false),
  getGeminiRetryAfterMs: vi.fn(() => null),
}))

import { buildDeterministicSummary, resolveSectionVersions } from '@/lib/reviewer/finalReport'
import {
  normalizeAddressedPreviousPoints,
  summarizeAddressedPoints,
} from '../../../lib/reviewerService'
import { coerceReviewerText } from '@/components/reviewer/ReviewerText'

const versions = [
  { id: 'm1', section_title: 'Methodology', version: 1, ai_review_json: { score: 4 } },
  { id: 'm2', section_title: 'Methodology', version: 2, ai_review_json: { score: 8 } },
  { id: 'b1', section_title: 'Budget', version: 1, ai_review_json: { score: 6 } },
]

describe('report version resolution', () => {
  it('reports on the newest version of each section', () => {
    const { effective, superseded, chosenVersions } = resolveSectionVersions(versions)

    expect(effective.map((section) => section.id).sort()).toEqual(['b1', 'm2'])
    expect(superseded.map((section) => section.id)).toEqual(['m1'])
    expect(chosenVersions).toEqual({ Methodology: 2, Budget: 1 })
  })

  it('honours an explicit version selection from the report page', () => {
    const { effective, chosenVersions } = resolveSectionVersions(versions, { Methodology: 1 })

    expect(effective.find((section) => section.section_title === 'Methodology')?.id).toBe('m1')
    expect(chosenVersions.Methodology).toBe(1)
  })

  it('falls back to the newest version when the requested one does not exist', () => {
    const { chosenVersions } = resolveSectionVersions(versions, { Methodology: 99 })
    expect(chosenVersions.Methodology).toBe(2)
  })

  it('keeps a superseded score out of the report average', () => {
    const toInput = (section: any) => ({
      title: section.section_title,
      version: section.version,
      content: 'Drafted content.',
      review: section.ai_review_json,
    })

    // All versions: (4 + 8 + 6) / 3 = 6. Current versions only: (8 + 6) / 2 = 7.
    expect(buildDeterministicSummary(versions.map(toInput), null).meanSectionScore).toBe(6)

    const { effective } = resolveSectionVersions(versions)
    expect(buildDeterministicSummary(effective.map(toInput), null).meanSectionScore).toBe(7)
  })

  it('ignores sections with no title rather than grouping them together', () => {
    const { effective } = resolveSectionVersions([
      { id: 'x', section_title: '', version: 1 },
      { id: 'y', section_title: 'Objectives', version: 1 },
    ])
    expect(effective.map((section) => section.id)).toEqual(['y'])
  })
})

describe('previous-review point tracking', () => {
  it('normalizes each point and defaults an unknown status to partial credit', () => {
    const points = normalizeAddressedPreviousPoints([
      { point: 'No baseline data', status: 'addressed', evidence: 'Table 2 now gives 2024 baselines' },
      { point: 'Timeline too optimistic', status: 'NOT ADDRESSED' },
      { point: 'Budget unjustified', status: 'somewhat' },
      { point: 'No baseline data', status: 'not_addressed' },
      { status: 'addressed' },
    ])

    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({ status: 'addressed' })
    expect(points[1]).toMatchObject({ status: 'not_addressed' })
    // Unrecognised status is not silently counted as resolved.
    expect(points[2]).toMatchObject({ status: 'partially' })
  })

  it('tallies resolution so the UI can state progress', () => {
    const tally = summarizeAddressedPoints(
      normalizeAddressedPreviousPoints([
        { point: 'a', status: 'addressed' },
        { point: 'b', status: 'addressed' },
        { point: 'c', status: 'partially' },
        { point: 'd', status: 'not_addressed' },
      ])
    )

    expect(tally).toEqual({ total: 4, addressed: 2, partially: 1, notAddressed: 1 })
  })
})

describe('reviewer text coercion', () => {
  it('flattens the object shapes models return instead of showing [object Object]', () => {
    expect(coerceReviewerText({ point: 'Budget', detail: 'lacks equipment justification' })).toBe(
      '**Budget**: lacks equipment justification'
    )
    expect(coerceReviewerText({ text: 'Methodology is sound' })).toBe('Methodology is sound')
    expect(coerceReviewerText({ recommendation: 'Add a risk register' })).toBe('Add a risk register')
    expect(coerceReviewerText(['One', 'Two'])).toBe('One; Two')
  })

  it('reduces HTML to text so stored editor markup never renders as markup', () => {
    expect(coerceReviewerText('<p>Objectives are <b>clear</b></p>')).toBe('Objectives are clear')
    expect(coerceReviewerText('<img src=x onerror=alert(1)>')).toBe('')
  })

  it('passes plain and markdown text through unchanged', () => {
    expect(coerceReviewerText('**Strong** methodology')).toBe('**Strong** methodology')
    expect(coerceReviewerText(null)).toBe('')
  })

  it('preserves line breaks so markdown lists and paragraphs survive', () => {
    // Collapsing newlines here would flatten a bulleted executive summary into
    // one run-on paragraph.
    expect(coerceReviewerText('Overall strong.\n\n- Clear aims\n- Weak budget')).toBe(
      'Overall strong.\n\n- Clear aims\n- Weak budget'
    )
    expect(coerceReviewerText('<p>First</p><p>Second</p>')).toBe('First\nSecond')
    expect(coerceReviewerText('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two')
  })

  it('treats empty editor payloads as blank', () => {
    expect(coerceReviewerText('{}')).toBe('')
    expect(coerceReviewerText('<p></p>')).toBe('')
  })
})
