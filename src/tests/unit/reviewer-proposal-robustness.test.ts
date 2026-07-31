import { describe, expect, it } from 'vitest'

import {
  buildProposalTargets,
  matchSegmentsToTargets,
  splitProposalIntoSegments,
} from '@/lib/reviewer/proposalSplit'

const WORKSPACE_SECTIONS = [
  { section_title: 'Summary / Abstract', reviewerBucketKey: 'summary' },
  { section_title: 'Problem, Need & Call Fit', reviewerBucketKey: 'problem_need' },
  { section_title: 'Objectives & Specific Aims', reviewerBucketKey: 'objectives' },
  { section_title: 'Methodology / Approach', reviewerBucketKey: 'methodology' },
  { section_title: 'Workplan & Timeline', reviewerBucketKey: 'workplan' },
  { section_title: 'Budget & Justification', reviewerBucketKey: 'budget' },
  { section_title: 'Impact & Outcomes', reviewerBucketKey: 'impact_outcomes' },
  { section_title: 'Team & Capability', reviewerBucketKey: 'team' },
]

const TARGETS = buildProposalTargets(WORKSPACE_SECTIONS, [])

function place(text: string) {
  const matches = matchSegmentsToTargets(splitProposalIntoSegments(text), TARGETS)

  // Several blocks can land on one section (sub-headings, continuations), which
  // is exactly what the commit step merges, so collect them all rather than
  // letting a map keep only the last.
  const placed = new Map<string, string>()
  for (const match of matches) {
    if (!match.targetTitle) continue
    const existing = placed.get(match.targetTitle)
    placed.set(match.targetTitle, existing ? `${existing}\n\n${match.body}` : match.body)
  }

  return { matches, placed }
}

describe('numbering styles', () => {
  it.each([
    ['plain numeric', '1. Objectives\nDeploy forty sensor nodes.'],
    ['paren numeric', '1) Objectives\nDeploy forty sensor nodes.'],
    ['bracketed numeric', '(1) Objectives\nDeploy forty sensor nodes.'],
    ['numeric colon', '1: Objectives\nDeploy forty sensor nodes.'],
    ['dash separated', '1 - Objectives\nDeploy forty sensor nodes.'],
    ['roman upper', 'III. Objectives\nDeploy forty sensor nodes.'],
    ['roman lower paren', '(iii) Objectives\nDeploy forty sensor nodes.'],
    ['letter', 'B. Objectives\nDeploy forty sensor nodes.'],
    ['letter paren', '(b) Objectives\nDeploy forty sensor nodes.'],
    ['worded section', 'Section 3: Objectives\nDeploy forty sensor nodes.'],
    ['worded part', 'Part B - Objectives\nDeploy forty sensor nodes.'],
    ['markdown', '## Objectives\nDeploy forty sensor nodes.'],
    ['nested numeric', '2.1 Objectives\nDeploy forty sensor nodes.'],
    ['bare heading', 'Objectives\nDeploy forty sensor nodes.'],
    ['all caps', 'OBJECTIVES\nDeploy forty sensor nodes.'],
    ['trailing colon', 'Objectives:\nDeploy forty sensor nodes.'],
  ])('handles %s', (_name, text) => {
    const { placed } = place(text)
    expect(placed.get('Objectives & Specific Aims')).toContain('forty sensor nodes')
  })
})

describe('section name variations', () => {
  it.each([
    ['Executive Summary', 'Summary / Abstract'],
    ['Project Synopsis', 'Summary / Abstract'],
    ['Statement of the Problem', 'Problem, Need & Call Fit'],
    ['Background and Rationale', 'Problem, Need & Call Fit'],
    ['Aims and Objectives', 'Objectives & Specific Aims'],
    ['Objective of the Study', 'Objectives & Specific Aims'],
    ['Specific Aims', 'Objectives & Specific Aims'],
    ['Research Questions', 'Objectives & Specific Aims'],
    ['Proposed Methodology', 'Methodology / Approach'],
    ['Materials and Methods', 'Methodology / Approach'],
    ['Technical Approach', 'Methodology / Approach'],
    ['Plan of Work', 'Workplan & Timeline'],
    ['Milestones and Timeline', 'Workplan & Timeline'],
    ['Budget Justification', 'Budget & Justification'],
    ['Estimated Expenditure', 'Budget & Justification'],
    ['Expected Outcomes', 'Impact & Outcomes'],
    ['Societal Impact', 'Impact & Outcomes'],
    ['Key Personnel', 'Team & Capability'],
    ['Team Composition', 'Team & Capability'],
  ])('routes "%s" to %s', (heading, expected) => {
    const { placed } = place(`${heading}\nSubstantive content for this section of the proposal.`)
    expect(placed.get(expected)).toContain('Substantive content')
  })
})

describe('messy real-world documents', () => {
  it('does not split a section apart at its numbered list', () => {
    const { placed, matches } = place(
      [
        '3. Objectives',
        'The project pursues three aims.',
        '1. Deploy forty sensor nodes',
        '2. Validate readings against laboratory assays',
        '3. Publish an open dataset',
        '4. Methodology',
        'Phase one designs the node.',
      ].join('\n')
    )

    const objectives = placed.get('Objectives & Specific Aims')
    expect(objectives).toContain('Deploy forty sensor nodes')
    expect(objectives).toContain('Publish an open dataset')
    expect(placed.get('Methodology / Approach')).toContain('Phase one designs')
    expect(matches).toHaveLength(2)
  })

  it('keeps numbered sub-headings with their parent section', () => {
    const { placed } = place(
      [
        '4. Methodology',
        'The work proceeds in two phases.',
        '4.1 Study Design',
        'A stratified sampling design across two canals.',
        '4.2 Data Analysis',
        'Mixed effects models compare the sites.',
        '5. Budget Justification',
        'Equipment costs cover the nodes.',
      ].join('\n')
    )

    const methodology = placed.get('Methodology / Approach')
    expect(methodology).toContain('two phases')
    // The sub-sections must not be stranded as unassigned blocks.
    expect(placed.get('Budget & Justification')).toContain('Equipment costs')
  })

  it('assigns numbered sub-headings to the parent and flags why', () => {
    const { matches } = place(
      [
        '4. Methodology',
        'The work proceeds in two phases.',
        '4.1 Study Design',
        'A stratified sampling design across two canals.',
        '4.2 Sensor Placement',
        'Nodes sit at the head and tail of each canal reach.',
      ].join('\n')
    )

    // "Study Design" is itself a known methodology wording, so it is matched
    // directly rather than inherited.
    const design = matches.find((match) => match.heading.startsWith('4.1'))
    expect(design?.targetTitle).toBe('Methodology / Approach')
    expect(design?.matchedBy).toBe('synonym')

    // "Sensor Placement" means nothing on its own; it is kept with its parent.
    const placement = matches.find((match) => match.heading.startsWith('4.2'))
    expect(placement?.targetTitle).toBe('Methodology / Approach')
    expect(placement?.matchedBy).toBe('continuation')
  })

  it('never imports references or annexures, and stops continuation there', () => {
    const { matches } = place(
      [
        '5. Budget Justification',
        'Equipment costs cover the nodes and gateways.',
        'References',
        'Gal A. et al. Trace-based compilation. 2009.',
        'Annexure II: Endorsement Letter',
        'Attached separately for the institutional head to sign.',
      ].join('\n')
    )

    const references = matches.find((match) => match.heading === 'References')
    const annexure = matches.find((match) => match.heading.startsWith('Annexure'))

    expect(references?.targetTitle).toBeNull()
    expect(references?.matchedBy).toBe('excluded')
    expect(annexure?.targetTitle).toBeNull()
    // Critically, the annexure must not be swept into the budget section.
    expect(annexure?.matchedBy).toBe('excluded')
  })

  it('handles a proposal that is missing most sections', () => {
    const { placed, matches } = place(
      ['Executive Summary', 'A sensor network for canal water quality.', 'Budget', 'Total outlay is INR 48 lakh.'].join(
        '\n'
      )
    )

    expect(matches).toHaveLength(2)
    expect(placed.get('Summary / Abstract')).toBeTruthy()
    expect(placed.get('Budget & Justification')).toBeTruthy()
    // Absent sections simply have nothing assigned; nothing is invented.
    expect(placed.get('Methodology / Approach')).toBeUndefined()
    expect(placed.size).toBe(2)
  })

  it('carries an unlabelled block into the section it follows', () => {
    const { matches } = place(
      [
        'Methodology',
        'Phase one designs the sensor node.',
        'Calibration Protocol',
        'Each node is calibrated against a reference meter before deployment.',
      ].join('\n')
    )

    const continuation = matches.find((match) => match.heading === 'Calibration Protocol')
    expect(continuation?.targetTitle).toBe('Methodology / Approach')
    expect(continuation?.matchedBy).toBe('continuation')
  })

  it('survives an empty or whitespace-only document', () => {
    expect(splitProposalIntoSegments('')).toEqual([])
    expect(splitProposalIntoSegments('   \n\n  \t ')).toEqual([])
    expect(matchSegmentsToTargets([], TARGETS)).toEqual([])
  })

  it('still works when the workspace has no sections to match against', () => {
    const matches = matchSegmentsToTargets(
      splitProposalIntoSegments('1. Objectives\nDeploy forty nodes.'),
      []
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].targetTitle).toBeNull()
  })
})



