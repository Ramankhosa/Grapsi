import { describe, expect, it } from 'vitest'
import {
  compareSectionTitles,
  compareSections,
  countReviewerSections,
  groupReviewerSections,
  reportFreshness,
  sectionStatus,
} from '@/lib/reviewer/sectionGrouping'

function section(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    section_title: 'Objectives',
    status: 'draft',
    version: 1,
    ai_review_json: {},
    last_reviewed_at: '2026-07-01T00:00:00.000Z',
    sourceStale: false,
    ...overrides,
  }
}

describe('section ordering', () => {
  it('orders every naming vocabulary the same way', () => {
    // The old guard here asserted that the ordering list contained the exact
    // title the picker creates. That invariant was the bug: it only ever held
    // for one of the three vocabularies, and the titles the seeder actually
    // creates matched none of them, so real workspaces sorted alphabetically.
    // Ordering keys off the bucket now, so all three agree by construction.
    const picker = ['Budget Justification', 'Abstract', 'Methodology', 'Project Timeline']
    const seeded = ['Budget & Justification', 'Summary / Abstract', 'Methodology / Approach', 'Workplan & Timeline']
    const wild = ['Detailed Budget', 'Executive Summary', 'Proposed Methodology', 'Plan of Work']

    for (const list of [picker, seeded, wild]) {
      expect([...list].sort(compareSectionTitles), list.join(' | ')).toEqual([
        list[1], // summary
        list[2], // methodology
        list[3], // workplan
        list[0], // budget
      ])
    }
  })

  it('prefers a stored bucket key over the title', () => {
    // A renamed section must keep its place in the proposal.
    const sorted = [
      { section_title: 'Methodology' },
      { section_title: 'Zebra Annexe', reviewerBucketKey: 'summary' },
    ].sort(compareSections)
    expect(sorted.map((s) => s.section_title)).toEqual(['Zebra Annexe', 'Methodology'])
  })

  it('orders by the proposal, not alphabetically', () => {
    const sorted = ['Budget Justification', 'Abstract', 'Methodology'].sort(compareSectionTitles)
    expect(sorted).toEqual(['Abstract', 'Methodology', 'Budget Justification'])
  })

  it('puts sections it cannot place last, with recognised tail sections in order', () => {
    const sorted = ['Conclusion', 'Zebra Annexe', 'Abstract', 'Custom Block'].sort(compareSectionTitles)
    // Abstract is a real bucket, so it leads. The rest fall to `other`, where
    // an annexe and a conclusion have known positions and anything genuinely
    // unrecognised sits between them.
    expect(sorted).toEqual(['Abstract', 'Zebra Annexe', 'Custom Block', 'Conclusion'])
  })
})

describe('groupReviewerSections', () => {
  it('collapses every version of a title to one entry, newest current', () => {
    const groups = groupReviewerSections([
      section({ id: 'v1', version: 1, status: 'reviewed' }),
      section({ id: 'v3', version: 3 }),
      section({ id: 'v2', version: 2, status: 'reviewed' }),
      section({ id: 'abs', section_title: 'Abstract', status: 'reviewed' }),
    ])

    expect(groups.map(g => g.title)).toEqual(['Abstract', 'Objectives'])
    const objectives = groups.find(g => g.title === 'Objectives')!
    expect(objectives.current.id).toBe('v3')
    expect(objectives.versionCount).toBe(3)
    expect(objectives.history.map(s => s.id)).toEqual(['v3', 'v2', 'v1'])
  })

  it('reads the score off the current version only', () => {
    const [group] = groupReviewerSections([
      section({ id: 'v1', version: 1, status: 'reviewed', ai_review_json: { score: 4 } }),
      section({ id: 'v2', version: 2, status: 'reviewed', ai_review_json: { score: 7.5 } }),
    ])
    expect(group.score).toBe(7.5)
  })

  it('survives a missing version number rather than picking arbitrarily', () => {
    const groups = groupReviewerSections([
      section({ id: 'a', version: null, last_reviewed_at: '2026-07-01T00:00:00.000Z' }),
      section({ id: 'b', version: null, last_reviewed_at: '2026-07-09T00:00:00.000Z' }),
    ])
    expect(groups[0].current.id).toBe('b')
  })

  it('ignores rows with no title instead of creating a blank group', () => {
    expect(groupReviewerSections([section(), { id: 'x', section_title: '' } as any])).toHaveLength(1)
  })
})

describe('sectionStatus', () => {
  it('reports an edited-since-review draft as stale, not as unreviewed', () => {
    expect(sectionStatus(section({ status: 'draft', sourceStale: true, ai_review_json: { score: 6 } })))
      .toBe('stale')
  })

  it('does not call a never-reviewed draft stale just because the flag is set', () => {
    expect(sectionStatus(section({ status: 'draft', sourceStale: true, ai_review_json: {} })))
      .toBe('draft')
  })
})

describe('countReviewerSections', () => {
  it('counts titles, not rows — three versions of one section is one section', () => {
    const counts = countReviewerSections([
      section({ id: 'v1', version: 1, status: 'reviewed' }),
      section({ id: 'v2', version: 2, status: 'reviewed' }),
      section({ id: 'v3', version: 3, status: 'reviewed' }),
      section({ id: 'abs', section_title: 'Abstract', status: 'draft' }),
    ])
    expect(counts.total).toBe(2)
    expect(counts.reviewed).toBe(1)
    expect(counts.draft).toBe(1)
    expect(counts.versions).toBe(4)
  })
})

describe('reportFreshness', () => {
  const reviewed = (title: string, version: number, at = '2026-07-01T00:00:00.000Z') =>
    section({ id: `${title}-${version}`, section_title: title, version, status: 'reviewed', ai_review_json: { score: 7 }, last_reviewed_at: at })

  it('is missing when no report has been generated', () => {
    expect(reportFreshness(null, [reviewed('Abstract', 1)])).toBe('missing')
    expect(reportFreshness({}, [reviewed('Abstract', 1)])).toBe('missing')
  })

  it('is fresh when the scored versions match the current ones', () => {
    const report = { score_basis: { scoredVersions: { Abstract: 2 } } }
    expect(reportFreshness(report, [reviewed('Abstract', 1), reviewed('Abstract', 2)])).toBe('fresh')
  })

  it('goes stale when a section is revised past what was scored', () => {
    const report = { score_basis: { scoredVersions: { Abstract: 1 } } }
    expect(reportFreshness(report, [reviewed('Abstract', 1), reviewed('Abstract', 2)])).toBe('stale')
  })

  it('goes stale when a newly reviewed section was never in the report', () => {
    const report = { score_basis: { scoredVersions: { Abstract: 1 } } }
    expect(reportFreshness(report, [reviewed('Abstract', 1), reviewed('Methodology', 1)])).toBe('stale')
  })

  it('falls back to generated_at for reports written before scoredVersions existed', () => {
    const report = { generated_at: '2026-07-05T00:00:00.000Z', executive_summary: 'x' }
    expect(reportFreshness(report, [reviewed('Abstract', 1, '2026-07-09T00:00:00.000Z')])).toBe('stale')
    expect(reportFreshness(report, [reviewed('Abstract', 1, '2026-07-02T00:00:00.000Z')])).toBe('fresh')
  })
})
