import { describe, expect, it } from 'vitest'

import {
  buildProposalTargets,
  matchSegmentsToTargets,
  splitProposalIntoSegments,
} from '@/lib/reviewer/proposalSplit'

/**
 * Importing a full proposal against a funder template.
 *
 * Templates routinely define two sections in one bucket — Background plus
 * Literature Review, Budget Summary plus Budget Justification. Every rule in a
 * bucket used to attach to whichever workspace section came first
 * alphabetically, so the second section received no aliases, no limit, and no
 * content: two real sections merged into one and the other was left empty.
 */

const templateSections = [
  { label: 'Executive Summary', bucketKey: 'summary', wordLimit: 250, charLimit: null },
  { label: 'Background and Rationale', bucketKey: 'problem_need', wordLimit: 800, charLimit: null },
  { label: 'Review of Literature', bucketKey: 'problem_need', wordLimit: 1200, charLimit: null },
  { label: 'Aims and Objectives', bucketKey: 'objectives', wordLimit: null, charLimit: null },
  { label: 'Technical Approach', bucketKey: 'methodology', wordLimit: 2000, charLimit: null },
  { label: 'Budget Summary', bucketKey: 'budget', wordLimit: 200, charLimit: null },
  { label: 'Budget Justification', bucketKey: 'budget', wordLimit: 1500, charLimit: null },
]

const workspaceSections = [
  { section_title: 'Introduction', reviewerBucketKey: 'problem_need' },
  { section_title: 'Literature Review', reviewerBucketKey: 'problem_need' },
  { section_title: 'Summary / Abstract', reviewerBucketKey: 'summary' },
  { section_title: 'Objectives & Specific Aims', reviewerBucketKey: 'objectives' },
  { section_title: 'Methodology / Approach', reviewerBucketKey: 'methodology' },
  { section_title: 'Budget & Justification', reviewerBucketKey: 'budget' },
  { section_title: 'Detailed Budget', reviewerBucketKey: 'budget' },
]

const proposal = `
1. Executive Summary
We propose a two-year study of coastal erosion.

2. Background and Rationale
Coastal erosion has accelerated since 2015.

3. Review of Literature
Prior work by Sharma et al. established the baseline.

4. Aims and Objectives
To quantify sediment loss across twelve sites.

5. Technical Approach
Drone photogrammetry combined with in-situ sampling.

6. Budget Summary
Total requested: INR 48,00,000.

7. Budget Justification
Equipment accounts for 38% of the total.

8. References
Sharma et al., 2019.
`

const targetsFor = (sections = workspaceSections) =>
  buildProposalTargets(sections, templateSections as any)

const byTitle = (title: string, sections = workspaceSections) =>
  targetsFor(sections).find((target) => target.title === title)!

describe('proposal targets built from an uploaded template', () => {
  it('gives each template rule the section it actually names', () => {
    expect(byTitle('Literature Review').aliases).toContain('Review of Literature')
    expect(byTitle('Introduction').aliases).toContain('Background and Rationale')
    // and does not hand one section both
    expect(byTitle('Introduction').aliases).not.toContain('Review of Literature')
  })

  it('carries each rule its own limit rather than the tightest in the bucket', () => {
    // Budget Justification is a 1500-word section; it must not inherit the
    // 200-word cap that belongs to Budget Summary.
    expect(byTitle('Budget & Justification').wordLimit).toBe(1500)
    expect(byTitle('Detailed Budget').wordLimit).toBe(200)
    expect(byTitle('Literature Review').wordLimit).toBe(1200)
    expect(byTitle('Introduction').wordLimit).toBe(800)
  })

  it('offers a target for a template section the workspace has not seeded', () => {
    const sparse = [{ section_title: 'Summary / Abstract', reviewerBucketKey: 'summary' }]
    const titles = targetsFor(sparse).map((target) => target.title)
    // Without this the text has nowhere to go and the import silently drops it.
    expect(titles).toContain('Technical Approach')
    expect(titles).toContain('Aims and Objectives')
  })

  it('places every heading of an uploaded proposal on the right section', () => {
    const matches = matchSegmentsToTargets(splitProposalIntoSegments(proposal), targetsFor())
    const placed = Object.fromEntries(
      matches.map((match) => [String(match.heading).replace(/^\d+\.\s*/, ''), match.targetTitle])
    )

    expect(placed['Executive Summary']).toBe('Summary / Abstract')
    expect(placed['Background and Rationale']).toBe('Introduction')
    expect(placed['Review of Literature']).toBe('Literature Review')
    expect(placed['Aims and Objectives']).toBe('Objectives & Specific Aims')
    expect(placed['Technical Approach']).toBe('Methodology / Approach')
    expect(placed['Budget Summary']).toBe('Detailed Budget')
    expect(placed['Budget Justification']).toBe('Budget & Justification')
  })

  it('still excludes reference lists', () => {
    const matches = matchSegmentsToTargets(splitProposalIntoSegments(proposal), targetsFor())
    const references = matches.find((match) => String(match.heading).includes('References'))
    expect(references?.matchedBy).toBe('excluded')
    expect(references?.targetTitle).toBeNull()
  })

  it('leaves no template section starved of content', () => {
    const matches = matchSegmentsToTargets(splitProposalIntoSegments(proposal), targetsFor())
    const assigned = new Set(matches.map((match) => match.targetTitle).filter(Boolean))
    // Seven headings, seven distinct sections — nothing merged, nothing empty.
    expect(assigned.size).toBe(7)
  })
})
