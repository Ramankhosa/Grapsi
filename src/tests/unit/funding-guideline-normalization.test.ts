import { describe, expect, it } from 'vitest'

import { normalizeGuidelinePack } from '@/lib/fundingGuidelines/utils'

describe('funding guideline normalization', () => {
  it('enriches compact extracted rules for Grant Prep routing', () => {
    const pack = normalizeGuidelinePack({
      priorities: [{
        key: 'priority-1',
        text: 'The proposal should align with the funder mission and priority themes.',
        importance: 'high',
      }],
      budgetRules: [{
        key: 'budget-1',
        text: 'The total project budget must not exceed USD 250,000.',
        importance: 'high',
      }],
      submissionRules: [{
        key: 'submission-1',
        text: 'Upload the signed application form before the deadline.',
        importance: 'high',
      }],
    })

    expect(pack.priorities[0]).toMatchObject({
      ruleClass: 'priority',
      enforcementLevel: 'soft',
      appliesTo: ['alignment'],
      draftingStage: ['fit_and_scope'],
      draftingVsSubmission: 'drafting',
    })
    expect(pack.budgetRules[0]).toMatchObject({
      ruleClass: 'budget',
      enforcementLevel: 'hard',
      draftingStage: ['budget_strategy'],
      draftingVsSubmission: 'both',
    })
    expect(pack.submissionRules[0]).toMatchObject({
      ruleClass: 'submission',
      enforcementLevel: 'hard',
      draftingVsSubmission: 'submission',
    })
    expect(pack.submissionRules[0].detectorHints).toContain('submission_checklist')
  })
})
