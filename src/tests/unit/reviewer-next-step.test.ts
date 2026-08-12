import { describe, expect, it } from 'vitest'
import { resolveNextStep } from '@/components/reviewer/ReviewerNextStep'

/**
 * The workspace's next action is derived, not stored, so it has to stay in
 * agreement with the counts and the freshness badge shown beside it. These
 * cases pin the priority order: an out-of-date draft outranks unreviewed work,
 * and neither is allowed to be reported as "complete".
 */

function section(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    section_title: 'Objectives',
    status: 'draft',
    version: 1,
    ai_review_json: {},
    last_reviewed_at: '2026-08-01T00:00:00.000Z',
    sourceStale: false,
    ...overrides,
  }
}

function reviewed(title: string, version = 1) {
  return section({
    section_title: title,
    status: 'reviewed',
    version,
    ai_review_json: { score: 7 },
  })
}

function report(scoredVersions: Record<string, number>) {
  return { overall_score: 7, score_basis: { scoredVersions } }
}

describe('reviewer next step', () => {
  it('asks for a proposal before anything else', () => {
    expect(resolveNextStep([], null).kind).toBe('add_sections')
  })

  it('asks for the review while sections are unreviewed', () => {
    const sections = [reviewed('Summary / Abstract'), section({ section_title: 'Methodology' })]
    expect(resolveNextStep(sections, null).kind).toBe('review_remaining')
  })

  it('counts only the remaining sections, not the versions', () => {
    // Two versions of one title is one section of work, not two.
    const sections = [
      reviewed('Summary / Abstract', 1),
      reviewed('Summary / Abstract', 2),
      section({ section_title: 'Methodology' }),
    ]
    expect(resolveNextStep(sections, null).title).toContain('1 section')
  })

  it('puts edited-since-reviewed ahead of unreviewed work', () => {
    // An edited section carries remarks that describe text that no longer
    // exists — more misleading than a section with no remarks at all.
    const sections = [
      section({ section_title: 'Summary / Abstract', sourceStale: true, ai_review_json: { score: 6 } }),
      section({ section_title: 'Methodology' }),
    ]
    expect(resolveNextStep(sections, null).kind).toBe('review_stale')
  })

  it('asks for the report once every section is reviewed', () => {
    const sections = [reviewed('Summary / Abstract'), reviewed('Methodology')]
    expect(resolveNextStep(sections, null).kind).toBe('generate_report')
    expect(resolveNextStep(sections, {}).kind).toBe('generate_report')
  })

  it('reports completion only when the report covers the current drafts', () => {
    const sections = [reviewed('Summary / Abstract', 2), reviewed('Methodology', 1)]

    expect(
      resolveNextStep(sections, report({ 'Summary / Abstract': 2, Methodology: 1 })).kind
    ).toBe('complete')

    // The report scored v1 of a section that is now on v2.
    expect(
      resolveNextStep(sections, report({ 'Summary / Abstract': 1, Methodology: 1 })).kind
    ).toBe('regenerate_report')
  })
})
