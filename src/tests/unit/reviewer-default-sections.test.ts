import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.fn()
const findFirstRevision = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    fundingCall: { findUnique: (...args: unknown[]) => findUnique(...args) },
    fundingCallTemplateRevision: { findFirst: (...args: unknown[]) => findFirstRevision(...args) },
  },
}))

import { buildReviewerContextFromStoredCall, DEFAULT_REVIEWER_BUCKETS } from '@/lib/reviewer/callContext'

const rule = (text: string, appliesTo?: string[]) => ({
  key: text.slice(0, 12),
  text,
  importance: 'high',
  confidence: 0.9,
  sourceAnchors: [],
  ...(appliesTo ? { appliesTo } : {}),
})

function storedCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call_1',
    scheme_title: 'Clean Water Innovation Grant',
    agency_name: 'Department of Science',
    description: 'Supports low-cost water quality monitoring.',
    raw_text: '',
    eligibility_text: 'Recognised research institutions only.',
    disciplines: ['Environmental Engineering'],
    funding_kinds: [],
    official_urls: [],
    amount_min: null,
    amount_max: 5000000,
    currency: 'INR',
    active_template: null,
    template: null,
    active_guideline: null,
    guideline: null,
    ...overrides,
  }
}

describe('stored-call context with no approved template', () => {
  beforeEach(() => {
    findUnique.mockReset()
    findFirstRevision.mockReset()
  })

  it('gives a bare catalogue record the standard proposal sections', async () => {
    findUnique.mockResolvedValue(storedCall())

    const { context, readiness } = await buildReviewerContextFromStoredCall({ fundingCallId: 'call_1' })

    expect(readiness).toBe('call_fields')
    expect(context.template_sections.map((section) => section.bucketKey)).toEqual(DEFAULT_REVIEWER_BUCKETS)
    // The call stated no required sections, so none may be claimed as required.
    expect(context.mandatory_sections).toEqual([])
    expect(context.reviewer_context_text).toContain('Methodology / Approach')
  })

  it('maps a guideline pack onto the default sections and keeps the rest call-wide', async () => {
    findUnique.mockResolvedValue(
      storedCall({
        active_guideline: {
          id: 'guide_1',
          status: 'approved',
          guideline_pack_json: {
            mustAddress: [
              // Explicit target: attaches to the methodology section.
              rule('Describe the sampling strategy for each site', ['methodology']),
              // No explicit target, but the wording names a section, so it must
              // be routed there rather than applied call-wide. This used to
              // land nowhere: the keyword router matched only the singular
              // "objective", so the plural sent it to `other`.
              rule('Objectives must be measurable and time-bound'),
              // Genuinely unplaceable: names no section, so it stays call-wide.
              rule('Use 12 point type with 2.5 cm page margins'),
            ],
            avoid: [rule('Do not reuse text from an earlier application')],
            evaluationCriteria: [rule('Scientific merit')],
            submissionRules: [rule('Upload the signed endorsement form on the portal')],
            priorities: [],
            budgetRules: [rule('Equipment may not exceed 40% of the budget')],
            durationRules: [],
            deliverableRules: [],
            reviewerSignals: [],
            sourceAnchors: [],
          },
        },
      })
    )

    const { context, readiness } = await buildReviewerContextFromStoredCall({ fundingCallId: 'call_1' })

    expect(readiness).toBe('guideline_manual')

    // Every default section is present, so the workspace structure is complete.
    expect(context.template_sections.map((section) => section.bucketKey)).toEqual(
      expect.arrayContaining(DEFAULT_REVIEWER_BUCKETS)
    )
    // No catch-all pseudo-section is created.
    expect(context.template_sections.map((section) => section.bucketKey)).not.toContain('other')

    // The placeable rule lands on its own section.
    const methodology = context.template_sections.find((section) => section.bucketKey === 'methodology')
    expect([...methodology!.requiredFacts, ...methodology!.guidanceText].join(' ')).toContain(
      'sampling strategy'
    )
    // A rule that names its section reaches that section.
    const objectives = context.template_sections.find((section) => section.bucketKey === 'objectives')
    expect([...objectives!.requiredFacts, ...objectives!.guidanceText].join(' ')).toContain(
      'measurable and time-bound'
    )

    // Only evidenced sections are reported as call requirements: objectives and
    // methodology from their own rules, budget because the budget rule routes
    // there too. Order follows BUCKET_ORDER, not the order the rules arrived in.
    expect(context.mandatory_sections).toEqual([
      'Objectives & Specific Aims',
      'Methodology / Approach',
      'Budget & Justification',
    ])

    // The unplaceable rule still reaches the reviewer, as a call-wide obligation.
    expect(context.dos).toContain('Use 12 point type with 2.5 cm page margins')
    expect(context.donts).toContain('Do not reuse text from an earlier application')
    expect(context.reviewer_context_text).toContain('Use 12 point type with 2.5 cm page margins')

    // Budget rules survive (the gap fixed earlier) and submission stays non-scoring.
    expect(context.dos).toContain('Equipment may not exceed 40% of the budget')
    expect(context.submission_rules).toContain('Upload the signed endorsement form on the portal')
  })

  it('still prefers an approved template over the default sections', async () => {
    findUnique.mockResolvedValue(
      storedCall({
        active_template: {
          id: 'tpl_1',
          status: 'approved',
          current_revision_no: 2,
          grant_template_json: {
            sections: [
              {
                key: 'concept_note',
                label: 'Concept Note',
                type: 'section',
                templateIntent: 'summary',
                workflowMode: 'app_draft',
                required: true,
                guidance: 'Two pages maximum',
              },
            ],
          },
        },
      })
    )
    findFirstRevision.mockResolvedValue({ id: 'rev_1' })

    const { context, readiness } = await buildReviewerContextFromStoredCall({ fundingCallId: 'call_1' })

    expect(readiness).toBe('template_manual')
    expect(context.template_sections.map((section) => section.label)).toContain('Concept Note')
    // The template is authoritative: the default skeleton must not be added.
    expect(context.template_sections).toHaveLength(1)
    expect(context.source_template_revision_id).toBe('rev_1')
  })
})
