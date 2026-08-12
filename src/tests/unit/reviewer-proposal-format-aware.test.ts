import { describe, expect, it } from 'vitest'

import {
  buildFormatInstructionIndex,
  buildProposalTargets,
  scrubFormatLines,
  splitProposalWithFormat,
} from '@/lib/reviewer/proposalSplit'

/**
 * Agencies distribute a fixed proposal format; applicants type into it and
 * submit the whole document. The splitter must separate the applicant's text
 * from the format's own furniture using only what the workspace knows about
 * the call — no agency-specific rules. This fixture reproduces the failure
 * shapes observed in a real filled format: word limits glued to headings,
 * instruction lines under headings, a budget table flattened to one line per
 * cell, empty table skeletons, and cover-page furniture.
 */

const WORKSPACE_SECTIONS = [
  { section_title: 'Summary / Abstract', reviewerBucketKey: 'summary' },
  { section_title: 'Problem, Need & Call Fit', reviewerBucketKey: 'problem_need' },
  { section_title: 'Objectives & Specific Aims', reviewerBucketKey: 'objectives' },
  { section_title: 'Methodology / Approach', reviewerBucketKey: 'methodology' },
  { section_title: 'Workplan & Timeline', reviewerBucketKey: 'workplan' },
  { section_title: 'Budget & Justification', reviewerBucketKey: 'budget' },
  { section_title: 'Impact & Outcomes', reviewerBucketKey: 'impact_outcomes' },
  // Present so the "4. Contingency" table row could mis-anchor to it.
  { section_title: 'Sustainability, Risk & Mitigation', reviewerBucketKey: 'sustainability_risk' },
]

const METHODOLOGY_GUIDANCE =
  'Including, if applicable, justification of research sites, sampling, sample size, data collection methods, and data analysis methods.'
const OUTPUT_GUIDANCE =
  'Journal publication, books, edited books, policy papers, dataset etc. Include publication timelines and places of publication.'

const TEMPLATE_SECTIONS = [
  { label: 'Abstract', bucketKey: 'summary', wordLimit: 500 },
  { label: 'Introduction and Scope of the Proposed Research', bucketKey: 'problem_need', wordLimit: 700 },
  { label: 'Objectives of the Proposed Research', bucketKey: 'objectives', wordLimit: 300 },
  {
    label: 'Proposed Methodology for the Research Work',
    bucketKey: 'methodology',
    wordLimit: 800,
    guidanceText: [METHODOLOGY_GUIDANCE],
  },
  {
    label: 'Expected Output and Relevance of the Proposed Research for Policy/Society',
    bucketKey: 'impact_outcomes',
    wordLimit: 500,
    guidanceText: [OUTPUT_GUIDANCE],
  },
  { label: 'Milestones for the Proposed Research', bucketKey: 'workplan' },
  { label: 'Budget', bucketKey: 'budget' },
]

const TARGETS = buildProposalTargets(WORKSPACE_SECTIONS, TEMPLATE_SECTIONS)

const FILLED_FORMAT = `NATIONAL RESEARCH COUNCIL
Research Grants Division

Format for Full Research Proposals (2026-27)

Title of the Research Proposal (same as in the online application)
A Study of Sensor Networks for Canal Water Quality

Abstract
Up to 500 words.
Canal water quality is monitored manually today. This project builds a sensor network that reports contamination within hours instead of weeks.

Introduction and Scope of the Proposed Research   Up to 700 words
Water quality failures are detected late because sampling is monthly. The scope covers three districts in the first year of the study.

Objectives of the Proposed Research
Up to 300 words
The project pursues three aims.
1. Deploy forty sensor nodes
2. Validate readings against laboratory assays
3. Publish an open dataset

Proposed Methodology for the Research Work
${METHODOLOGY_GUIDANCE}
Up to 800 words
Phase one designs the node. Phase two runs a field trial across two canals with stratified sampling.

Expected Output and Relevance of the Proposed Research for Policy/Society
${OUTPUT_GUIDANCE}
Up to 500 words.
Two journal articles and an open dataset are planned, with a policy brief for the irrigation department.

Relevance of the Proposed Research for Society
Farmers along both canals receive contamination alerts within hours, protecting drinking water for forty villages.

Milestones for the Proposed Research
| Timeline | Milestones / Activities | Deliverables ||------------|-----------------|-----------------|| 6 months | | |
Node design and lab validation        1-6 Months
Field deployment and analysis         7-12 Months
| 12 months | | |

Budget
Total Grant expected under the scheme (In Rs.)

Heads of Expenditure
Number
Months
Rate
Amount
1. Research Staff (See Point No. 5.3 of the Guidelines)
7,20,000
(a) Research Associate
2. Field work
2,00,000
3. Research Equipment and study material
1,80,000
4. Contingency
1,00,000
Total
12,00,000

Budget Justification for Different Heads
Research Staff
A full-time research associate coordinates deployment, data collection and analysis for the whole project.

References
Gal A. et al. Trace-based compilation. 2009.`

function importFilled() {
  return splitProposalWithFormat(FILLED_FORMAT, TARGETS, { templateSections: TEMPLATE_SECTIONS })
}

function mergedByTarget(matches: ReturnType<typeof importFilled>['matches']) {
  const placed = new Map<string, string>()
  for (const match of matches) {
    if (!match.targetTitle) continue
    const existing = placed.get(match.targetTitle)
    placed.set(match.targetTitle, existing ? `${existing}\n\n${match.body}` : match.body)
  }
  return placed
}

describe('splitProposalWithFormat on a filled agency format', () => {
  it('recognises the format and cuts only at the call structure', () => {
    const { splitMode, matches } = importFilled()
    expect(splitMode).toBe('format')

    // Every format heading lands on its section.
    const byHeading = new Map(matches.map((match) => [match.heading, match]))
    expect(byHeading.get('Abstract')?.targetTitle).toBe('Summary / Abstract')
    expect(byHeading.get('Objectives of the Proposed Research')?.targetTitle).toBe('Objectives & Specific Aims')
    expect(byHeading.get('Proposed Methodology for the Research Work')?.targetTitle).toBe('Methodology / Approach')
    expect(byHeading.get('Milestones for the Proposed Research')?.targetTitle).toBe('Workplan & Timeline')
    expect(byHeading.get('Budget')?.targetTitle).toBe('Budget & Justification')
  })

  it('matches a heading with the word limit glued onto the same line', () => {
    const { matches } = importFilled()
    const introduction = matches.find((match) => match.heading.startsWith('Introduction and Scope'))
    expect(introduction?.targetTitle).toBe('Problem, Need & Call Fit')
  })

  it('keeps the flattened budget table inside the budget section', () => {
    const { matches } = importFilled()
    const budget = mergedByTarget(matches).get('Budget & Justification') || ''

    expect(budget).toContain('Field work')
    expect(budget).toContain('Contingency')
    expect(budget).toContain('7,20,000')
    expect(budget).toContain('full-time research associate')

    // The table rows must not become sections of their own — "4. Contingency"
    // names a risk section by synonym but its neighbours are table cells.
    expect(matches.every((match) => match.targetTitle !== 'Sustainability, Risk & Mitigation')).toBe(true)
    expect(matches.some((match) => match.heading === '2. Field work')).toBe(false)
  })

  it('subtracts the format instruction lines from every body', () => {
    const { matches, formatLinesRemoved } = importFilled()
    const allBodies = matches.map((match) => match.body).join('\n')

    expect(allBodies).not.toMatch(/up to \d+ words/i)
    expect(allBodies).not.toContain('See Point No. 5.3')
    expect(allBodies).not.toContain(METHODOLOGY_GUIDANCE)
    expect(allBodies).not.toContain(OUTPUT_GUIDANCE)
    expect(allBodies).not.toContain('| 6 months | | |')
    expect(formatLinesRemoved).toBeGreaterThan(0)

    // While keeping the user's actual words.
    const abstract = matches.find((match) => match.heading === 'Abstract')
    expect(abstract?.body).toContain('reports contamination within hours')
    const milestones = matches.find((match) => match.heading.startsWith('Milestones'))
    expect(milestones?.body).toContain('Node design and lab validation')
  })

  it('keeps a renamed variant heading with its section', () => {
    // "Relevance … for Society" is a variant of the format's own
    // "Expected Output and Relevance … for Policy/Society" heading, which
    // already anchored — so the variant is treated as part of that section
    // rather than a competing cut point.
    const { matches } = importFilled()
    const impact = mergedByTarget(matches).get('Impact & Outcomes') || ''
    expect(impact).toContain('forty villages')
    expect(impact).toContain('policy brief for the irrigation department')
  })

  it('keeps cover-page furniture in an unassigned preamble and excludes references', () => {
    const { matches } = importFilled()

    const preamble = matches.find((match) => match.heading === '')
    expect(preamble?.targetTitle).toBeNull()
    expect(preamble?.body).toContain('Sensor Networks for Canal Water Quality')

    const references = matches.find((match) => match.heading === 'References')
    expect(references?.matchedBy).toBe('excluded')
    expect(references?.targetTitle).toBeNull()
  })
})

describe('splitProposalWithFormat fallback', () => {
  it('uses the heuristic splitter when the document does not follow the format', () => {
    const { splitMode, matches } = splitProposalWithFormat(
      ['Executive Summary', 'A sensor network for canal water quality.', 'Budget', 'Total outlay is INR 48 lakh.'].join('\n'),
      TARGETS,
      { templateSections: TEMPLATE_SECTIONS }
    )

    expect(splitMode).toBe('heuristic')
    expect(matches.find((match) => match.heading === 'Executive Summary')?.targetTitle).toBe('Summary / Abstract')
    expect(matches.find((match) => match.heading === 'Budget')?.targetTitle).toBe('Budget & Justification')
  })

  it('still scrubs instruction lines in heuristic mode', () => {
    const { matches } = splitProposalWithFormat(
      ['Executive Summary', 'Up to 500 words.', 'A sensor network for canal water quality.'].join('\n'),
      TARGETS,
      { templateSections: TEMPLATE_SECTIONS }
    )

    const summary = matches.find((match) => match.heading === 'Executive Summary')
    expect(summary?.body).not.toMatch(/up to 500 words/i)
    expect(summary?.body).toContain('sensor network')
  })

  it('survives empty input and empty targets', () => {
    expect(splitProposalWithFormat('', TARGETS).matches).toEqual([])
    const free = splitProposalWithFormat('1. Objectives\nDeploy forty nodes.', [])
    expect(free.splitMode).toBe('heuristic')
    expect(free.matches).toHaveLength(1)
  })
})

describe('scrubFormatLines', () => {
  it('removes limit lines, instruction parentheticals and skeleton rows only', () => {
    const index = buildFormatInstructionIndex(TEMPLATE_SECTIONS)
    const { text, removed } = scrubFormatLines(
      [
        'Up to 300 words',
        '(copy from your online application)',
        '| Timeline | Milestones | Deliverables ||----|----|----|| | |',
        METHODOLOGY_GUIDANCE,
        'The user wrote this sentence about sampling 120 households.',
      ].join('\n'),
      index
    )

    expect(text).toBe('The user wrote this sentence about sampling 120 households.')
    expect(removed).toBe(4)
  })

  it('keeps content parentheticals and real table rows', () => {
    const { text } = scrubFormatLines(
      ['The framework (CLF) is validated in phase two (2027).', '| MBA Students | 500 |'].join('\n'),
      []
    )
    expect(text).toContain('(CLF)')
    expect(text).toContain('| MBA Students | 500 |')
  })
})
