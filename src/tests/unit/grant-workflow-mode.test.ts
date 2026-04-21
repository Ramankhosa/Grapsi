import { describe, expect, it } from 'vitest'

import { buildGrantPrepStageMapping } from '@/lib/grantPrep/templateMapper'
import { buildPaperSectionPlanFromGrantSections } from '@/lib/grants/workspace'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import { generateDiffSummary, normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'
import type { GrantBlueprintPlanSection } from '@/types/grant'

describe('grant workflow mode extraction and runtime', () => {
  it('normalizes workflowMode and falls back safely', () => {
    const normalized = normalizeGrantTemplate({
      questions: [
        {
          key: 'proposal_summary',
          label: 'Proposal Summary',
          type: 'field',
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
      sections: [
        {
          key: 'objectives',
          label: 'Objectives',
          type: 'section',
          workflowMode: 'bad_value',
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
      budget: {
        required: true,
        yearWise: false,
        categories: [],
        supportLevel: 'partial',
        confidence: 1,
        sourceAnchors: [],
      },
    })

    expect(normalized.questions[0].workflowMode).toBe('team_manual')
    expect(normalized.sections[0].workflowMode).toBe('team_manual')
    expect(normalized.budget?.workflowMode).toBe('app_support')
  })

  it('treats workflowMode changes as material template diffs', () => {
    const previous = normalizeGrantTemplate({
      sections: [
        {
          key: 'objectives',
          label: 'Objectives',
          type: 'section',
          workflowMode: 'app_draft',
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
    })

    const next = normalizeGrantTemplate({
      sections: [
        {
          key: 'objectives',
          label: 'Objectives',
          type: 'section',
          workflowMode: 'team_manual',
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
    })

    expect(generateDiffSummary(previous, next)).toContain('Sections: +0 / ~1 / -0')
  })

  it('filters team-owned response items out of grant prep mapping while keeping budget guidance', () => {
    const mapping = buildGrantPrepStageMapping({
      sections: [
        {
          key: 'objectives',
          label: 'Objectives',
          type: 'section',
          workflowMode: 'app_draft',
          guidance: 'Explain the objectives, outcomes, and impact.',
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
        {
          key: 'pi_details',
          label: 'Principal Investigator Details',
          type: 'field',
          workflowMode: 'team_manual',
          guidance: 'Enter PI details.',
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
      budget: {
        required: true,
        yearWise: false,
        workflowMode: 'app_support',
        categories: [
          {
            key: 'capital',
            label: 'Capital Expenditure',
            sourceAnchors: [],
          },
        ],
        justificationNotes: 'Explain the budget categories and justification.',
        supportLevel: 'partial',
        confidence: 1,
        sourceAnchors: [],
      },
    })

    const allDiscussionLabels = Object.values(mapping).flatMap((entry) =>
      entry.discussionPoints.map((point) => point.label)
    )
    const budgetPointers = mapping.budget_strategy.templatePointers

    expect(allDiscussionLabels).toContain('Objectives')
    expect(allDiscussionLabels).not.toContain('Principal Investigator Details')
    expect(budgetPointers).toContain('budget.budget_overview')
  })

  it('keeps only app_draft narrative sections in the shadow paper blueprint', () => {
    const sectionPlan: GrantBlueprintPlanSection[] = [
      {
        sectionKey: 'objectives',
        label: 'Objectives',
        order: 1,
        sectionType: 'short_answer',
        workflowMode: 'app_draft',
        required: true,
        wordBudget: 250,
        characterLimit: null,
        purpose: 'Draft the proposal objectives.',
        reviewerIntent: null,
        dependencies: [],
        sourceTemplatePointer: 'objectives',
        mustCover: ['Problem statement', 'Expected outcomes'],
        mustAvoid: [],
        grantSemantic: 'objectives',
        prepContextBlock: {
          stageKeys: ['problem_definition', 'fit_and_scope', 'thrust_alignment', 'outcomes'],
          bullets: ['Problem statement: cyber resilience, measurable outcomes'],
          keywords: ['cyber resilience', 'measurable outcomes'],
        },
        grantRuleProfile: {
          requiredPoints: ['State measurable objectives.'],
          evaluationFocus: ['Link objectives to clear outcomes.'],
          reviewerSignals: ['Reviewers expect concise, specific goals.'],
          avoidRules: ['Avoid vague ambitions.'],
          formatConstraints: ['Do not exceed 250 words.'],
          narrativeConstraints: ['Keep the tone reviewer-facing.'],
        },
        suggestedCitationCount: 4,
        thematicBlueprint: {
          mustCover: ['Problem statement', 'Expected outcomes'],
          mustAvoid: [],
          mustCoverTyping: {
            'Problem statement': 'foundational',
            'Expected outcomes': 'empirical',
          },
          suggestedCitationCount: 4,
        },
        seededContext: '',
      },
      {
        sectionKey: 'pi_details',
        label: 'Principal Investigator Details',
        order: 2,
        sectionType: 'short_answer',
        workflowMode: 'team_manual',
        required: true,
        wordBudget: null,
        characterLimit: null,
        purpose: 'Enter PI details.',
        reviewerIntent: null,
        dependencies: [],
        sourceTemplatePointer: 'pi_details',
        mustCover: [],
        mustAvoid: [],
        seededContext: '',
      },
      {
        sectionKey: 'budget',
        label: 'Budget',
        order: 3,
        sectionType: 'budget_rows',
        workflowMode: 'app_support',
        required: true,
        wordBudget: null,
        characterLimit: null,
        purpose: 'Provide the budget.',
        reviewerIntent: null,
        dependencies: [],
        sourceTemplatePointer: 'budget',
        mustCover: [],
        mustAvoid: [],
        seededContext: '',
      },
    ]

    const shadowPlan = buildPaperSectionPlanFromGrantSections(sectionPlan, null)

    expect(shadowPlan).toHaveLength(1)
    expect(shadowPlan[0].sectionKey).toBe('objectives')
    expect(shadowPlan[0].displayLabel).toBe('Objectives')
    expect(shadowPlan[0].required).toBe(true)
    expect(shadowPlan[0].sectionType).toBe('short_answer')
    expect(shadowPlan[0].workflowMode).toBe('app_draft')
    expect(shadowPlan[0].grantSemantic).toBe('objectives')
    expect(shadowPlan[0].prepContextBlock?.stageKeys).toEqual([
      'problem_definition',
      'fit_and_scope',
      'thrust_alignment',
      'outcomes',
    ])
    expect(shadowPlan[0].grantRuleProfile?.requiredPoints).toContain('State measurable objectives.')
    expect(shadowPlan[0].suggestedCitationCount).toBe(4)
    expect(shadowPlan[0].thematicBlueprint?.mustCoverTyping).toEqual({
      'Problem statement': 'foundational',
      'Expected outcomes': 'empirical',
    })
    expect(isGrantSectionAutoDraftable({ sectionType: 'short_answer', workflowMode: 'app_draft' })).toBe(true)
    expect(isGrantSectionAutoDraftable({ sectionType: 'short_answer', workflowMode: 'team_manual' })).toBe(false)
  })
})
