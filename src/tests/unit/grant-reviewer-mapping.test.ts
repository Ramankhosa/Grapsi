import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    fundingCall: {
      findUnique: vi.fn(),
    },
    fundingCallTemplateRevision: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
  prisma: prismaMock,
}))

vi.mock('@/lib/grants/workspace', () => ({
  getGrantWorkspace: vi.fn(),
}))

describe('template-backed grant reviewer mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps multiple grant draft sections into one reviewer section', async () => {
    const { buildReviewerSectionMappings } = await import('@/lib/reviewer/template-bridge')

    const mappings = buildReviewerSectionMappings({
      sectionPlan: [
        {
          sectionKey: 'aim_1',
          label: 'Specific Aim 1',
          order: 1,
          sectionType: 'narrative',
          workflowMode: 'app_draft',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: null,
          dependencies: [],
          sourceTemplatePointer: null,
          seededContext: '',
          templateIntent: 'objectives',
          mustCover: [],
          mustAvoid: [],
        },
        {
          sectionKey: 'aim_2',
          label: 'Specific Aim 2',
          order: 2,
          sectionType: 'narrative',
          workflowMode: 'app_draft',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: null,
          dependencies: [],
          sourceTemplatePointer: null,
          seededContext: '',
          templateIntent: 'objectives',
          mustCover: [],
          mustAvoid: [],
        },
      ],
      sectionDrafts: [
        {
          id: 'draft-2',
          sectionKey: 'aim_2',
          label: 'Specific Aim 2',
          sectionOrder: 2,
          content: 'Second aim content.',
        },
        {
          id: 'draft-1',
          sectionKey: 'aim_1',
          label: 'Specific Aim 1',
          sectionOrder: 1,
          content: 'First aim content.',
        },
      ],
    } as any)

    expect(mappings).toHaveLength(1)
    expect(mappings[0].bucketKey).toBe('objectives')
    expect(mappings[0].linkedSections.map((link) => link.sectionKey)).toEqual(['aim_1', 'aim_2'])
    expect(mappings[0].aggregateContent).toContain('## Specific Aim 1 [aim_1]')
    expect(mappings[0].aggregateContent.indexOf('First aim content.')).toBeLessThan(
      mappings[0].aggregateContent.indexOf('Second aim content.')
    )
  })

  it('uses manual mapping overrides as the active reviewer bucket', async () => {
    const { buildReviewerSectionMappings } = await import('@/lib/reviewer/template-bridge')

    const mappings = buildReviewerSectionMappings({
      sectionPlan: [
        {
          sectionKey: 'summary',
          label: 'Project Summary',
          order: 1,
          sectionType: 'narrative',
          workflowMode: 'app_draft',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: null,
          dependencies: [],
          sourceTemplatePointer: null,
          seededContext: '',
          templateIntent: 'summary',
          mustCover: [],
          mustAvoid: [],
        },
      ],
      sectionDrafts: [
        {
          id: 'draft-1',
          sectionKey: 'summary',
          label: 'Project Summary',
          sectionOrder: 1,
          content: 'Summary content.',
        },
      ],
      manualRubric: {
        mappingOverrides: {
          summary: 'impact_outcomes',
        },
      },
    } as any)

    expect(mappings).toHaveLength(1)
    expect(mappings[0].bucketKey).toBe('impact_outcomes')
  })

  it('skips non-app-draft and empty app-draft sections', async () => {
    const { buildReviewerSectionMappings } = await import('@/lib/reviewer/template-bridge')

    const mappings = buildReviewerSectionMappings({
      sectionPlan: [
        {
          sectionKey: 'drafted',
          label: 'Drafted Narrative',
          order: 1,
          sectionType: 'narrative',
          workflowMode: 'app_draft',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: null,
          dependencies: [],
          sourceTemplatePointer: null,
          seededContext: '',
          templateIntent: 'methodology',
          mustCover: [],
          mustAvoid: [],
        },
        {
          sectionKey: 'empty',
          label: 'Empty Narrative',
          order: 2,
          sectionType: 'narrative',
          workflowMode: 'app_draft',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: null,
          dependencies: [],
          sourceTemplatePointer: null,
          seededContext: '',
          templateIntent: 'methodology',
          mustCover: [],
          mustAvoid: [],
        },
        {
          sectionKey: 'attachments',
          label: 'Attachments',
          order: 3,
          sectionType: 'checklist',
          workflowMode: 'team_manual',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: null,
          dependencies: [],
          sourceTemplatePointer: null,
          seededContext: '',
          templateIntent: 'attachments',
          mustCover: [],
          mustAvoid: [],
        },
      ],
      sectionDrafts: [
        {
          id: 'draft-1',
          sectionKey: 'drafted',
          label: 'Drafted Narrative',
          sectionOrder: 1,
          content: 'This is meaningful app draft content.',
        },
        {
          id: 'draft-2',
          sectionKey: 'empty',
          label: 'Empty Narrative',
          sectionOrder: 2,
          content: '<p><br></p>&nbsp;',
        },
        {
          id: 'draft-3',
          sectionKey: 'attachments',
          label: 'Attachments',
          sectionOrder: 3,
          content: 'Upload CVs and signatures.',
        },
      ],
    } as any)

    expect(mappings).toHaveLength(1)
    expect(mappings[0].linkedSections.map((link) => link.sectionKey)).toEqual(['drafted'])
    expect(mappings[0].aggregateContent).not.toContain('Upload CVs and signatures')
  })

  it('maps meaningful structured budget rows into the budget reviewer section', async () => {
    const { buildReviewerSectionMappings } = await import('@/lib/reviewer/template-bridge')

    const mappings = buildReviewerSectionMappings({
      sectionPlan: [
        {
          sectionKey: 'budget',
          label: 'Budget',
          order: 1,
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: 'Check whether the requested costs are justified.',
          dependencies: [],
          sourceTemplatePointer: 'budget',
          seededContext: '',
          templateIntent: 'budget',
          mustCover: [],
          mustAvoid: [],
        },
      ],
      sectionDrafts: [
        {
          id: 'draft-budget',
          sectionKey: 'budget',
          label: 'Budget',
          sectionOrder: 1,
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          content: null,
          structuredResponses: [
            {
              fieldKey: 'structuredData',
              responseJson: {
                columns: [
                  { key: 'category', label: 'Category', kind: 'category' },
                  { key: 'amount', label: 'Amount', kind: 'amount' },
                  { key: 'justification', label: 'Justification', kind: 'justification' },
                ],
                rows: [
                  {
                    category: 'Equipment',
                    amount: '1200',
                    justification: 'Prototype hardware.',
                  },
                ],
              },
            },
          ],
        },
      ],
    } as any)

    expect(mappings).toHaveLength(1)
    expect(mappings[0].bucketKey).toBe('budget')
    expect(mappings[0].linkedSections.map((link) => link.sectionKey)).toEqual(['budget'])
    expect(mappings[0].aggregateContent).toContain('## Budget [budget]')
    expect(mappings[0].aggregateContent).toContain('Prototype hardware.')
  })

  it('does not map blank budget scaffolds as reviewer-ready drafts', async () => {
    const { buildReviewerSectionMappings } = await import('@/lib/reviewer/template-bridge')

    const mappings = buildReviewerSectionMappings({
      sectionPlan: [
        {
          sectionKey: 'budget',
          label: 'Budget',
          order: 1,
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          wordBudget: null,
          characterLimit: null,
          purpose: '',
          reviewerIntent: null,
          dependencies: [],
          sourceTemplatePointer: 'budget',
          seededContext: '',
          templateIntent: 'budget',
          mustCover: [],
          mustAvoid: [],
        },
      ],
      sectionDrafts: [
        {
          id: 'draft-budget',
          sectionKey: 'budget',
          label: 'Budget',
          sectionOrder: 1,
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          content: null,
          structuredResponses: [
            {
              fieldKey: 'structuredData',
              responseJson: {
                columns: [
                  { key: 'category', label: 'Category', kind: 'category' },
                  { key: 'amount', label: 'Amount', kind: 'amount' },
                  { key: 'justification', label: 'Justification', kind: 'justification' },
                ],
                rows: [
                  {
                    category: 'Equipment',
                    amount: null,
                    justification: '',
                  },
                ],
              },
            },
          ],
        },
      ],
    } as any)

    expect(mappings).toHaveLength(0)
  })

  it('builds reviewer context from approved template and manual rubric only', async () => {
    const { buildReviewerContextFromFundingCall } = await import('@/lib/reviewer/template-bridge')

    prismaMock.fundingCall.findUnique.mockResolvedValue({
      id: 'funding-1',
      title: 'Template Call',
      scheme_title: 'Template Scheme',
      agency_name: 'Agency',
      description: 'Call description',
      summary: null,
      disciplines: ['health'],
      funding_kinds: [],
      close_date: new Date('2026-06-01T00:00:00.000Z'),
      deadlineAt: null,
      expiration_date: null,
      amount_min: null,
      amount_max: 100000,
      currency: 'USD',
      project_duration_text: null,
      project_duration_min_months: null,
      project_duration_max_months: 24,
      active_template: {
        id: 'template-1',
        status: 'approved',
        current_revision_no: 3,
        grant_template_json: {
          sections: [
            {
              key: 'approach',
              label: 'Approach',
              type: 'section',
              workflowMode: 'app_draft',
              required: true,
              repeatable: false,
              templateIntent: 'methodology',
              reviewerGoal: 'Show feasibility',
              requiredFacts: ['timeline'],
              forbiddenMoves: ['unsupported claims'],
              supportLevel: 'full',
              confidence: 1,
              sourceAnchors: [],
            },
          ],
          questions: [],
          attachments: [],
          evaluationCriteria: [],
          submissionRules: { items: [], sourceAnchors: [] },
          budget: null,
          sourceAnchors: [],
          mergeConflicts: [],
        },
        compiledGrantTemplateJson: null,
      },
      template: null,
    })
    prismaMock.fundingCallTemplateRevision.findFirst.mockResolvedValue({ id: 'revision-3' })

    const context = await buildReviewerContextFromFundingCall({
      fundingCallId: 'funding-1',
      manualRubric: {
        evaluationCriteria: ['Reviewer fit'],
        mustAddress: ['Equity plan'],
      },
    })

    expect(context.rules_source).toBe('template_manual')
    expect(context.template_sections[0]).toMatchObject({
      key: 'approach',
      bucketKey: 'methodology',
      reviewerGoal: 'Show feasibility',
    })
    expect(context.evaluation_criteria).toContain('Reviewer fit')
    expect(context.dos).toEqual(expect.arrayContaining(['timeline', 'Equity plan']))
    expect(prismaMock.fundingCall.findUnique).toHaveBeenCalledTimes(1)
    expect((prismaMock as any).fundingGuideline).toBeUndefined()
  })
})
