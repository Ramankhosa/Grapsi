import { describe, expect, it } from 'vitest'

import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  bucketFromText,
  resolveBucketKey,
} from '@/lib/reviewer/buckets'
import { DEFAULT_REVIEWER_BUCKETS } from '@/lib/reviewer/callContext'
import { compareSectionTitles } from '@/lib/reviewer/sectionGrouping'

/**
 * Reviewer sections are named from three unrelated vocabularies: the labels the
 * seeder writes (`BUCKET_LABELS`), the titles the picker offers, and whatever
 * free text a user types. Nothing forced them to agree, and they did not — none
 * of the seeded labels matched the ordering list, so every seeded section
 * sorted alphabetically and the whole review ran out of order.
 *
 * The fix is that titles stop being the identity: `resolveBucketKey` folds all
 * three vocabularies onto the same closed set of buckets. These tests pin that
 * down, so a future title change cannot silently detach a section from its
 * rules again.
 */

/** The titles `components/SectionSelector.tsx` offers. */
const PICKER_TITLES = [
  'Abstract',
  'Introduction',
  'Objectives',
  'Literature Review',
  'Methodology',
  'Project Timeline',
  'Budget Justification',
  'Team Expertise',
  'Expected Outcomes',
  'Societal Impact',
  'Sustainability',
  'Risk & Mitigation',
  'IP & Commercialization Plan',
  'Conclusion',
]

describe('reviewer section identity', () => {
  it('resolves every seeded bucket label back to its own bucket', () => {
    // The regression that started all of this: these are the titles the seeder
    // actually creates, so a miss here detaches a real section from its rules.
    const resolved = Object.entries(BUCKET_LABELS).map(([key, label]) => [label, resolveBucketKey(label), key])
    const wrong = resolved.filter(([, got, want]) => got !== want)
    expect(wrong).toEqual([])
  })

  it('resolves the picker vocabulary onto the same buckets', () => {
    expect(PICKER_TITLES.map((title) => resolveBucketKey(title))).toEqual([
      'summary',              // Abstract
      'problem_need',         // Introduction
      'objectives',           // Objectives
      'problem_need',         // Literature Review
      'methodology',          // Methodology
      'workplan',             // Project Timeline
      'budget',               // Budget Justification
      'team',                 // Team Expertise
      'impact_outcomes',      // Expected Outcomes
      'impact_outcomes',      // Societal Impact
      'sustainability_risk',  // Sustainability
      'sustainability_risk',  // Risk & Mitigation
      'other',                // IP & Commercialization Plan — no bucket exists
      'other',                // Conclusion — no bucket exists
    ])
  })

  it('agrees across vocabularies for the same concept', () => {
    // Same section, three ways of naming it.
    for (const group of [
      ['Abstract', 'Summary / Abstract', 'Executive Summary'],
      ['Methodology', 'Methodology / Approach', 'Proposed Methodology'],
      ['Budget Justification', 'Budget & Justification', 'Detailed Budget'],
      ['Project Timeline', 'Workplan & Timeline', 'Plan of Work'],
    ]) {
      const keys = group.map((title) => resolveBucketKey(title))
      expect(new Set(keys).size, `${group.join(' | ')} -> ${keys.join(', ')}`).toBe(1)
    }
  })

  it('handles plurals and word forms', () => {
    // Every one of these returned `other` before: the keyword arms were
    // `\b`-terminated singulars.
    const plurals: Record<string, string> = {
      Objectives: 'objectives',
      Aims: 'objectives',
      Goals: 'objectives',
      Methodology: 'methodology',
      Methods: 'methodology',
      Milestones: 'workplan',
      Outcomes: 'impact_outcomes',
      Risks: 'sustainability_risk',
      Summaries: 'summary',
      Hypotheses: 'objectives',
    }
    for (const [title, expected] of Object.entries(plurals)) {
      expect(resolveBucketKey(title), title).toBe(expected)
    }
    // Routed somewhere real, though reasonable people could argue the bucket.
    expect(resolveBucketKey('Deliverables')).not.toBe('other')
  })

  it('does not let a bare keyword steal a phrase that names another section', () => {
    // "justification" used to be a budget keyword, so this read as a budget rule.
    expect(bucketFromText('Justification for the project')).toBe('problem_need')
    expect(bucketFromText('Budget Justification')).toBe('budget')
  })

  it('prefers the stored key, then mappingJson, then the title', () => {
    expect(
      resolveBucketKey({ reviewerBucketKey: 'budget', section_title: 'Methodology' })
    ).toBe('budget')

    expect(
      resolveBucketKey({
        reviewerBucketKey: null,
        mappingJson: { bucketKey: 'team' },
        section_title: 'Methodology',
      })
    ).toBe('team')

    expect(
      resolveBucketKey({ reviewerBucketKey: null, mappingJson: null, section_title: 'Abstract' })
    ).toBe('summary')
  })

  it('falls through to the title when the stored key is not a real bucket', () => {
    // `normalizeBucketKey` collapses anything unrecognised to `other`, so a
    // stale value like this must not be trusted over a title that still says
    // exactly what the section is.
    expect(
      resolveBucketKey({ reviewerBucketKey: 'timeline', section_title: 'Project Timeline' })
    ).toBe('workplan')
  })

  it('reviews a seeded workspace in proposal order, not alphabetically', () => {
    // The measured regression. These are the eight titles a workspace with no
    // approved template is actually seeded with. Sorting them used to give
    // Budget first and Summary sixth, because none of them appeared in the
    // fourteen-title ordering list, so every one scored indexOf -1 and fell
    // back to alphabetical. The auto-run reviews in this order, so the Budget
    // was scored before the Methodology and Workplan it should be checked
    // against.
    const seeded = DEFAULT_REVIEWER_BUCKETS.map((key) => BUCKET_LABELS[key])

    const alphabetical = [...seeded].sort((a, b) => a.localeCompare(b))
    expect(alphabetical[0]).toBe('Budget & Justification') // the old behaviour

    expect([...seeded].sort(compareSectionTitles)).toEqual([
      'Summary / Abstract',
      'Problem, Need & Call Fit',
      'Objectives & Specific Aims',
      'Methodology / Approach',
      'Workplan & Timeline',
      'Budget & Justification',
      'Impact & Outcomes',
      'Team & Capability',
    ])
  })

  it('always returns a bucket that exists', () => {
    for (const title of [...PICKER_TITLES, ...Object.values(BUCKET_LABELS), '', 'Ερωτήσεις', '???']) {
      expect(BUCKET_ORDER).toContain(resolveBucketKey(title))
    }
    expect(resolveBucketKey(null)).toBe('other')
    expect(resolveBucketKey(undefined)).toBe('other')
  })
})
