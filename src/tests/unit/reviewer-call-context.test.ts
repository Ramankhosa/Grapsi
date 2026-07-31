import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  default: {},
  prisma: {},
}))

import {
  DEFAULT_REVIEWER_BUCKETS,
  mapRulesOntoDefaultSections,
  normalizeReviewerCallContext,
  normalizeScoringCriteria,
  normalizeTemplateSectionRule,
} from '@/lib/reviewer/callContext'
import { selectReviewerSourceText } from '@/lib/reviewer/sourceText'
import { buildDeterministicSummary, countWords, renderDeterministicBriefing } from '@/lib/reviewer/finalReport'

describe('reviewer call context normalization', () => {
  it('routes an extracted section to a reviewer bucket and keeps stated limits', () => {
    const rule = normalizeTemplateSectionRule(
      {
        label: 'Detailed Work Plan and Milestones',
        required: true,
        wordLimit: '1500',
        reviewerGoal: 'Show the plan is deliverable in the funded period',
        guidance: 'Give quarter-wise milestones',
        forbiddenMoves: ['Vague timelines'],
      },
      0
    )

    expect(rule).toMatchObject({
      label: 'Detailed Work Plan and Milestones',
      bucketKey: 'workplan',
      bucketLabel: 'Workplan & Timeline',
      required: true,
      wordLimit: 1500,
    })
    expect(rule?.key).toBe('detailed_work_plan_and_milestones')
    expect(rule?.forbiddenMoves).toEqual(['Vague timelines'])
  })

  it('drops section entries with no usable label', () => {
    expect(normalizeTemplateSectionRule({ wordLimit: 100 }, 0)).toBeNull()
  })

  it('marks narrative sections app_draft and attachments external so rules scope correctly', () => {
    // Without a workflowMode the reviewer prompt treats a rule as global and
    // shows it while scoring every other section.
    expect(normalizeTemplateSectionRule({ label: 'Methodology' }, 0)?.workflowMode).toBe('app_draft')
    expect(
      normalizeTemplateSectionRule({ label: 'Annexure III: Endorsement form' }, 0)?.workflowMode
    ).toBe('external')
    expect(normalizeTemplateSectionRule({ label: 'Methodology', workflowMode: 'external' }, 0)?.workflowMode).toBe(
      'external'
    )
  })

  it('parses weighted scoring criteria and dedupes repeats', () => {
    const criteria = normalizeScoringCriteria([
      { label: 'Scientific merit', weight: '40', description: 'Rigour of the approach' },
      { criterion: 'Scientific merit', weight: 40 },
      'Team capability',
    ])

    expect(criteria).toHaveLength(2)
    expect(criteria[0]).toMatchObject({ label: 'Scientific merit', weight: 40 })
    expect(criteria[1]).toMatchObject({ label: 'Team capability', weight: null })
  })

  it('folds the manual rubric into the call rules and builds reviewer context text', () => {
    const context = normalizeReviewerCallContext({
      title: 'Green Hydrogen Mission',
      agency_name: 'MNRE',
      rules_source: 'url_extracted',
      template_sections: [{ label: 'Objectives', bucketKey: 'objectives', required: true }],
      scoring_criteria: [{ label: 'Innovation', weight: 25 }],
      dos: ['State the TRL at entry'],
      manual_rubric: {
        mustAddress: ['Name the industry partner'],
        avoid: ['Generic sustainability claims'],
      },
      submission_rules: ['Upload the signed endorsement form on the portal'],
    })

    expect(context.rules_source).toBe('url_extracted')
    expect(context.dos).toEqual(expect.arrayContaining(['State the TRL at entry', 'Name the industry partner']))
    expect(context.donts).toContain('Generic sustainability claims')
    expect(context.evaluation_criteria).toContain('Innovation (weight 25)')
    expect(context.reviewer_context_text).toContain('Funding call: Green Hydrogen Mission')
    expect(context.reviewer_context_text).toContain('Upload the signed endorsement form on the portal')
  })

  it('falls back to url_extracted for an unrecognised rules source', () => {
    expect(normalizeReviewerCallContext({ rules_source: 'nonsense' }).rules_source).toBe('url_extracted')
  })
})

describe('default section fallback when a call has no template', () => {
  const packSection = (
    bucketKey: string,
    parts: { guidanceText?: string[]; requiredFacts?: string[]; forbiddenMoves?: string[] }
  ) => ({
    key: bucketKey,
    label: bucketKey,
    bucketKey,
    bucketLabel: bucketKey,
    type: 'narrative',
    workflowMode: 'app_draft',
    required: true,
    wordLimit: null,
    charLimit: null,
    reviewerGoal: null,
    guidanceText: parts.guidanceText || [],
    requiredFacts: parts.requiredFacts || [],
    forbiddenMoves: parts.forbiddenMoves || [],
  })

  it('always produces the standard proposal sections, even with no rules at all', () => {
    const mapped = mapRulesOntoDefaultSections([])

    expect(mapped.sections.map((section) => section.bucketKey)).toEqual(DEFAULT_REVIEWER_BUCKETS)
    expect(mapped.matchedSectionCount).toBe(0)
    // Nothing may be claimed as a call requirement when the call said nothing.
    expect(mapped.sections.every((section) => section.required === false)).toBe(true)
  })

  it('attaches the call rules to the matching default section', () => {
    const mapped = mapRulesOntoDefaultSections([
      packSection('methodology', { guidanceText: ['Describe the sampling strategy'] }),
    ])

    const methodology = mapped.sections.find((section) => section.bucketKey === 'methodology')
    expect(methodology?.guidanceText).toContain('Describe the sampling strategy')
    // An evidenced section is a real call requirement.
    expect(methodology?.required).toBe(true)
    expect(mapped.matchedSectionCount).toBe(1)

    // Untouched defaults are still present so the user has somewhere to paste.
    expect(mapped.sections.map((section) => section.bucketKey)).toEqual(
      expect.arrayContaining(DEFAULT_REVIEWER_BUCKETS)
    )
  })

  it('adds a non-default section when the call actually asks for one', () => {
    const mapped = mapRulesOntoDefaultSections([
      packSection('evaluation', { guidanceText: ['State the M&E indicators'] }),
    ])

    const keys = mapped.sections.map((section) => section.bucketKey)
    expect(keys).toContain('evaluation')
    // Order still follows the canonical bucket order.
    expect(keys.indexOf('evaluation')).toBeGreaterThan(keys.indexOf('budget'))
  })

  it('turns unplaceable rules into call-wide obligations instead of a junk section', () => {
    const mapped = mapRulesOntoDefaultSections([
      packSection('other', {
        requiredFacts: ['Objectives must be measurable and time-bound'],
        forbiddenMoves: ['Do not reuse text from an earlier application'],
      }),
    ])

    expect(mapped.sections.map((section) => section.bucketKey)).not.toContain('other')
    expect(mapped.unplaceable.mustAddress).toContain('Objectives must be measurable and time-bound')
    expect(mapped.unplaceable.avoid).toContain('Do not reuse text from an earlier application')
  })

  it('keeps attachment rules as non-scoring reminders rather than a section', () => {
    const mapped = mapRulesOntoDefaultSections([
      packSection('attachments_submission', { guidanceText: ['Upload the signed endorsement form'] }),
    ])

    expect(mapped.sections.map((section) => section.bucketKey)).not.toContain('attachments_submission')
    expect(mapped.submissionReminders).toContain('Upload the signed endorsement form')
  })
})

describe('reviewer source text compaction', () => {
  it('leaves short sources untouched', () => {
    const source = 'Applicants must submit a 2000 word proposal.'
    expect(selectReviewerSourceText(source, 5000)).toBe(source)
  })

  it('keeps rule-dense passages when it has to truncate', () => {
    const filler = 'The agency was founded long ago and has a proud history of collaboration. '.repeat(80)
    const rules =
      'Applicants must submit within 5000 words. The budget cap is ₹50 lakhs. Proposals that miss the deadline are disqualified. '.repeat(
        6
      )
    const source = `${filler}\n${rules}\n${filler}`

    const selected = selectReviewerSourceText(source, 4000)

    expect(selected.length).toBeLessThanOrEqual(4000)
    expect(selected).toMatch(/5000 words|budget cap|disqualified/)
  })
})

describe('deterministic final-report facts', () => {
  const context = {
    mandatory_sections: ['Objectives', 'Methodology', 'Budget'],
    template_sections: [
      {
        key: 'objectives',
        label: 'Objectives',
        bucketKey: 'objectives',
        bucketLabel: 'Objectives & Specific Aims',
        type: 'narrative',
        required: true,
        wordLimit: 5,
        charLimit: null,
        reviewerGoal: null,
        guidanceText: [],
        requiredFacts: [],
        forbiddenMoves: [],
      },
    ],
    scoring_criteria: [
      { key: 'merit', label: 'Scientific merit', weight: 60, description: null },
      { key: 'impact', label: 'Impact', weight: 40, description: null },
    ],
    submission_deadline: null,
  } as any

  const sections = [
    {
      title: 'Objectives',
      version: 1,
      content: 'One two three four five six seven eight',
      review: {
        score: 8,
        criterion_scores: [{ criterion: 'Scientific merit', score: 8, evidence: 'clear aims' }],
        section_recommendations: [{ priority: 'high', issue: 'No baseline', recommendation: 'State the baseline' }],
      },
    },
    {
      title: 'Methodology',
      version: 1,
      content: 'A detailed method.',
      review: {
        score: 6,
        criterion_scores: [{ criterion: 'Scientific merit', score: 6, evidence: 'thin controls' }],
        compliance_flags: [{ rule: 'Ethics approval stated', status: 'missing', detail: 'not mentioned' }],
      },
    },
  ]

  it('counts words the way a limit check needs', () => {
    expect(countWords('One two three')).toBe(3)
    expect(countWords('   ')).toBe(0)
  })

  it('reports missing required sections and blown word limits exactly', () => {
    const summary = buildDeterministicSummary(sections, context)

    expect(summary.compliance.requiredSections.covered).toEqual(['Objectives', 'Methodology'])
    expect(summary.compliance.requiredSections.missing).toEqual(['Budget'])
    expect(summary.compliance.requiredSections.coveragePercent).toBe(67)

    const limit = summary.compliance.limits.find((check) => check.section === 'Objectives')
    expect(limit).toMatchObject({ limit: 5, unit: 'words', actual: 8, overBy: 3, status: 'over' })
  })

  it('rolls criterion scores up and weights the anchor score', () => {
    const summary = buildDeterministicSummary(sections, context)

    const merit = summary.criterionRollup.find((entry) => entry.criterion === 'Scientific merit')
    expect(merit).toMatchObject({ weight: 60, score: 7, sectionCount: 2 })
    expect(merit?.evidenceSections).toEqual(['Objectives', 'Methodology'])

    // Impact was never evidenced, so it must stay null rather than score zero.
    const impact = summary.criterionRollup.find((entry) => entry.criterion === 'Impact')
    expect(impact?.score).toBeNull()

    // Only weighted criteria with scores contribute, so the anchor is merit alone.
    expect(summary.weightedScore).toBe(7)
    expect(summary.meanSectionScore).toBe(7)
  })

  it('surfaces high-priority section actions and compliance flag counts', () => {
    const summary = buildDeterministicSummary(sections, context)

    expect(summary.openHighPriorityActions).toEqual([
      { section: 'Objectives', issue: 'No baseline', recommendation: 'State the baseline' },
    ])
    expect(summary.complianceFlagCounts.missing).toBe(1)
  })

  it('renders a briefing that states the facts the model must not re-derive', () => {
    const briefing = renderDeterministicBriefing(buildDeterministicSummary(sections, context))

    expect(briefing).toContain('VERIFIED FACTS')
    expect(briefing).toContain('Missing required sections: Budget')
    expect(briefing).toContain('Objectives is 8 words against a 5 words limit')
    expect(briefing).toContain('Criteria no section evidenced: Impact')
    expect(briefing).toContain('Criterion-weighted score')
  })
})
