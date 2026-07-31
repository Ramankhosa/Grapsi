import { describe, expect, it } from 'vitest'

import {
  buildProposalTargets,
  matchSegmentsToTargets,
  splitProposalIntoSegments,
} from '@/lib/reviewer/proposalSplit'
import { buildReviewerPromptScope } from '@/lib/reviewer/promptScope'

const PROPOSAL = `Grant Application Form
Applicant: Dr A. Researcher

1. Executive Summary
This project builds a low-cost sensor network for canal water quality.
It targets three districts in the first year.

2. Statement of the Problem
Existing monitoring is manual and monthly, so contamination is detected late.

3. Objectives
O1: Deploy 40 nodes.
O2: Validate against lab assays.

4. Methodology
Phase 1 designs the node. Phase 2 runs a field trial across two canals.

5. Budget Justification
Equipment costs INR 12,00,000, covering nodes and gateways.

Annexure I: Institutional Endorsement Letter
Attached separately.`

describe('splitProposalIntoSegments', () => {
  it('cuts numbered headings into separate segments and keeps a preamble', () => {
    const segments = splitProposalIntoSegments(PROPOSAL)
    const headings = segments.map((segment) => segment.heading)

    expect(headings).toContain('1. Executive Summary')
    expect(headings).toContain('4. Methodology')
    expect(headings).toContain('Annexure I: Institutional Endorsement Letter')

    const methodology = segments.find((segment) => segment.heading === '4. Methodology')
    expect(methodology?.body).toContain('Phase 1 designs the node')
    // Body must stop at the next heading.
    expect(methodology?.body).not.toContain('Equipment costs')
  })

  it('does not treat bullet lines or page furniture as headings', () => {
    const segments = splitProposalIntoSegments(
      ['1. Objectives', '- Deploy nodes', '- Validate results', 'Page 2 of 8', '2. Methodology', 'Design work.'].join('\n')
    )

    expect(segments.map((segment) => segment.heading)).toEqual(['1. Objectives', '2. Methodology'])
    expect(segments[0].body).toContain('- Deploy nodes')
    expect(segments[0].body).not.toContain('Page 2 of 8')
  })
})

describe('matchSegmentsToTargets', () => {
  const workspaceSections = [
    { section_title: 'Summary / Abstract', reviewerBucketKey: 'summary' },
    { section_title: 'Problem, Need & Call Fit', reviewerBucketKey: 'problem_need' },
    { section_title: 'Objectives & Specific Aims', reviewerBucketKey: 'objectives' },
    { section_title: 'Methodology / Approach', reviewerBucketKey: 'methodology' },
    { section_title: 'Budget & Justification', reviewerBucketKey: 'budget' },
  ]

  const templateSections = [
    { label: 'Executive Summary', bucketKey: 'summary', wordLimit: 300 },
    { label: 'Statement of the Problem', bucketKey: 'problem_need' },
    { label: 'Budget Justification', bucketKey: 'budget' },
  ]

  it('aliases the call template labels onto the workspace sections', () => {
    const targets = buildProposalTargets(workspaceSections, templateSections)
    const summary = targets.find((target) => target.title === 'Summary / Abstract')

    expect(summary?.aliases).toContain('Executive Summary')
    expect(summary?.wordLimit).toBe(300)
  })

  it('places proposal headings written in the call template wording', () => {
    const targets = buildProposalTargets(workspaceSections, templateSections)
    const matches = matchSegmentsToTargets(splitProposalIntoSegments(PROPOSAL), targets)
    const byHeading = new Map(matches.map((match) => [match.heading, match]))

    expect(byHeading.get('1. Executive Summary')?.targetTitle).toBe('Summary / Abstract')
    expect(byHeading.get('2. Statement of the Problem')?.targetTitle).toBe('Problem, Need & Call Fit')
    expect(byHeading.get('3. Objectives')?.targetTitle).toBe('Objectives & Specific Aims')
    expect(byHeading.get('4. Methodology')?.targetTitle).toBe('Methodology / Approach')
    expect(byHeading.get('5. Budget Justification')?.targetTitle).toBe('Budget & Justification')
  })

  it('leaves material it cannot place unassigned rather than guessing', () => {
    const targets = buildProposalTargets(workspaceSections, templateSections)
    const matches = matchSegmentsToTargets(splitProposalIntoSegments(PROPOSAL), targets)

    // An annexure is recognised as submission material and excluded outright,
    // rather than being left as an ambiguous unmatched block.
    const annexure = matches.find((match) => match.heading.startsWith('Annexure I'))
    expect(annexure?.targetTitle).toBeNull()
    expect(annexure?.matchedBy).toBe('excluded')

    const preamble = matches.find((match) => match.heading === '')
    expect(preamble?.targetTitle).toBeNull()
  })
})

describe('buildReviewerPromptScope', () => {
  const callData = {
    template_sections: [
      {
        key: 'methodology',
        label: 'Methodology',
        bucketKey: 'methodology',
        type: 'section',
        workflowMode: 'app_draft',
        guidanceText: ['State the sampling plan'],
        requiredFacts: [],
        forbiddenMoves: [],
      },
      {
        key: 'budget_form',
        label: 'Budget Form Upload',
        bucketKey: 'attachments_submission',
        type: 'attachment',
        workflowMode: 'external',
        guidanceText: ['Upload the signed budget workbook'],
        requiredFacts: [],
        forbiddenMoves: [],
      },
      {
        key: 'impact_criterion',
        label: 'Societal Impact',
        bucketKey: 'impact_outcomes',
        type: 'rubric',
        guidanceText: ['Weighted 30 percent'],
        requiredFacts: [],
        forbiddenMoves: [],
      },
    ],
    evaluation_criteria: ['Feasibility of the workplan'],
    budget_cap: 'INR 5000000',
  }

  it('scopes a section to its own rules and keeps submission items non-scoring', () => {
    const scope = buildReviewerPromptScope(
      { section_title: 'Methodology / Approach', reviewerBucketKey: 'methodology' },
      callData
    )

    expect(scope.sectionRules.join(' ')).toContain('State the sampling plan')
    // The attachment rule must never appear as a scoring rule.
    expect(scope.sectionRules.join(' ')).not.toContain('budget workbook')
    expect(scope.supplementaryRules.join(' ')).toContain('budget workbook')
    // Rubric and call-wide items land in the global pool.
    expect(scope.globalRules.join(' ')).toContain('Societal Impact')
    expect(scope.globalRules.join(' ')).toContain('Feasibility of the workplan')
    expect(scope.globalRules.join(' ')).toContain('INR 5000000')
  })

  it('does not leak one section\'s rules into another section', () => {
    const scope = buildReviewerPromptScope(
      { section_title: 'Summary / Abstract', reviewerBucketKey: 'summary' },
      callData
    )

    expect(scope.sectionRules.join(' ')).not.toContain('State the sampling plan')
  })
})
