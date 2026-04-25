import { describe, expect, it } from 'vitest'

import { buildGrantPrepStageMapping } from '@/lib/grantPrep/templateMapper'
import { buildGrantPrepSelectorResult } from '@/lib/grantPrep/selection'
import { resolveGrantBackedDraftingMode } from '@/lib/grants/paperSectionConfig'
import {
  MAX_TRUSTED_TEMPLATE_INTENT_ALTERNATES,
  shouldTrustTemplateIntent,
} from '@/lib/grants/templateIntent'
import { resolveGrantTemplateSectionType } from '@/lib/grants/templateSectionType'
import { buildPaperSectionPlanFromGrantSections } from '@/lib/grants/workspace'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import { generateDiffSummary, mergeGrantTemplates, normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'
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

  it('normalizes template intent metadata and treats intent changes as material diffs', () => {
    const previous = normalizeGrantTemplate({
      sections: [
        {
          key: 'technical_section',
          label: 'Technical Section',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'methodology',
          templateIntentAlternates: ['workplan'],
          templateIntentConfidence: 0.91,
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
          key: 'technical_section',
          label: 'Technical Section',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'innovation',
          templateIntentAlternates: ['methodology'],
          templateIntentConfidence: 0.88,
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
    })

    expect(previous.sections[0].templateIntent).toBe('methodology')
    expect(previous.sections[0].templateIntentAlternates).toEqual(['workplan'])
    expect(previous.sections[0].templateIntentConfidence).toBe(0.91)
    expect(generateDiffSummary(previous, next)).toContain('Sections: +0 / ~1 / -0')
  })

  it('surfaces merge conflicts when re-extraction changes template intent metadata', () => {
    const current = normalizeGrantTemplate({
      sections: [
        {
          key: 'technical_section',
          label: 'Technical Section',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'methodology',
          templateIntentConfidence: 0.9,
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
    })
    const incoming = normalizeGrantTemplate({
      sections: [
        {
          key: 'technical_section',
          label: 'Technical Section',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'innovation',
          templateIntentConfidence: 0.9,
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
    })

    const merged = mergeGrantTemplates(current, incoming, '11111111-1111-1111-1111-111111111111')

    expect(merged.conflicts).toHaveLength(1)
    expect(merged.mergedTemplate.sections[0].templateIntent).toBe('methodology')
    expect(merged.mergedTemplate.mergeConflicts[0]?.block).toBe('sections')
  })

  it('treats more than one alternate as ambiguous and does not trust template intent', () => {
    expect(MAX_TRUSTED_TEMPLATE_INTENT_ALTERNATES).toBe(1)
    expect(shouldTrustTemplateIntent({
      intent: 'methodology',
      confidence: 0.96,
      alternates: ['workplan'],
      workflowMode: 'app_draft',
      sectionType: 'narrative',
    })).toBe(true)
    expect(shouldTrustTemplateIntent({
      intent: 'methodology',
      confidence: 0.96,
      alternates: ['workplan', 'evaluation'],
      workflowMode: 'app_draft',
      sectionType: 'narrative',
    })).toBe(false)
  })

  it('uses one shared template section type resolver for concise sections', () => {
    expect(resolveGrantTemplateSectionType({
      key: 'capacity_statement',
      label: 'Capacity Statement',
      type: 'section',
      workflowMode: 'app_draft',
      required: true,
      repeatable: false,
      wordLimit: 120,
      charLimit: 900,
      guidance: 'State the institutional capacity in a concise response.',
      supportLevel: 'full',
      confidence: 1,
      sourceAnchors: [],
    })).toBe('short_answer')
  })

  it('routes dense narrative grant sections to two_pass and compact team sections to one_pass', () => {
    expect(resolveGrantBackedDraftingMode({
      sectionKey: 'methodology',
      mustCover: ['Execution model', 'Validation plan', 'Risk controls'],
      sectionType: 'narrative',
      grantSemantic: 'methodology',
      templateIntent: 'methodology',
      wordBudget: 600,
      suggestedCitationCount: 5,
      authoritativePrepPointCount: 3,
    })).toBe('two_pass')

    expect(resolveGrantBackedDraftingMode({
      sectionKey: 'team_plan',
      mustCover: ['Key personnel'],
      sectionType: 'short_answer',
      grantSemantic: null,
      templateIntent: 'team',
      wordBudget: 180,
      suggestedCitationCount: 0,
      authoritativePrepPointCount: 1,
    })).toBe('one_pass')
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
          templateIntent: 'team',
          templateIntentConfidence: 0.95,
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

  it('uses trusted template intent before keyword fallback for weak app_draft labels', () => {
    const mapping = buildGrantPrepStageMapping({
      sections: [
        {
          key: 'section_2',
          label: 'Section 2',
          type: 'section',
          workflowMode: 'app_draft',
          guidance: 'Provide the requested response.',
          templateIntent: 'methodology',
          templateIntentConfidence: 0.93,
          required: true,
          repeatable: false,
          supportLevel: 'full',
          confidence: 1,
          sourceAnchors: [],
        },
      ],
    })

    expect(mapping.methodology.templatePointers).toContain('sections.section_2')
    expect(mapping.innovation.secondaryPointers).toContain('sections.section_2')
    expect(mapping.evaluation.secondaryPointers).toContain('sections.section_2')
    expect(mapping.risk_and_ethics.secondaryPointers).toContain('sections.section_2')
    expect(mapping.methodology.discussionPoints.find((point) => point.sourceTemplatePointer === 'sections.section_2')?.conversationRole).toBe('can_infer_and_confirm')
    expect(mapping.innovation.discussionPoints.find((point) => point.sourceTemplatePointer === 'sections.section_2')?.conversationRole).toBe('context_only')
  })

  it('keeps secondary-only template matches optional instead of auto-enabling extra stages', () => {
    const selector = buildGrantPrepSelectorResult({
      mode: 'template_driven',
      templateJson: {
        sections: [
          {
            key: 'section_2',
            label: 'Section 2',
            type: 'section',
            workflowMode: 'app_draft',
            guidance: 'Provide the requested response.',
            templateIntent: 'methodology',
            templateIntentConfidence: 0.93,
            required: true,
            repeatable: false,
            supportLevel: 'full',
            confidence: 1,
            sourceAnchors: [],
          },
        ],
      },
      guidelinePack: null,
      selectedThrustAreaRuleKeys: [],
      fundingContext: null,
    })

    expect(selector.autoEnabledStageKeys).toContain('methodology')
    expect(selector.autoEnabledStageKeys).not.toContain('innovation')
    expect(selector.autoEnabledStageKeys).not.toContain('evaluation')
    expect(selector.autoOptionalStageKeys).toContain('innovation')
    expect(selector.selectionLevels.innovation).toBe('optional')
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
        templateIntent: 'objectives',
        templateIntentAlternates: ['alignment'],
        templateIntentConfidence: 0.92,
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
    expect(shadowPlan[0].templateIntent).toBe('objectives')
    expect(shadowPlan[0].templateIntentAlternates).toEqual(['alignment'])
    expect(shadowPlan[0].templateIntentConfidence).toBe(0.92)
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
    expect(shadowPlan[0].seededContext).toBe('')
    expect(isGrantSectionAutoDraftable({ sectionType: 'short_answer', workflowMode: 'app_draft' })).toBe(true)
    expect(isGrantSectionAutoDraftable({ sectionType: 'short_answer', workflowMode: 'team_manual' })).toBe(false)
  })
})
