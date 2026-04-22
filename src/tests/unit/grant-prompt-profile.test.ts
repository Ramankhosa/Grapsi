import { describe, expect, it } from 'vitest'

import {
  buildGrantBackedBasePrompt,
  buildGrantPromptOverlay,
} from '@/lib/grants/promptOverlay'

describe('grant prompt profile', () => {
  it('renders template-intent-specific tasking and short-answer rules for draftable team sections', () => {
    const basePrompt = buildGrantBackedBasePrompt('team_plan', {
      displayLabel: 'Team Plan',
      sectionType: 'short_answer',
      templateIntent: 'team',
      reviewerIntent: 'Show delivery capability and role fit.',
      citationMode: 'direct_draft',
      grantSemantic: null,
    })
    const overlay = buildGrantPromptOverlay({
      sectionType: 'short_answer',
      templateIntent: 'team',
      citationMode: 'direct_draft',
      grantSemantic: null,
      grantContextSummary: {
        freezeSummary: ['Project: Cyber Centre of Excellence'],
      },
    })

    expect(basePrompt).toContain(
      'Section task: Describe the team roles, expertise, governance, and partnership contributions needed to deliver the proposal.'
    )
    expect(basePrompt).toContain('Template intent: team')
    expect(overlay).toContain('GRANT SECTION PROFILE:')
    expect(overlay).toContain('Template intent: team')
    expect(overlay).toContain('Lead with the direct answer in the first sentence.')
  })

  it('renders eligibility-specific tasking without requiring a drafting semantic', () => {
    const basePrompt = buildGrantBackedBasePrompt('eligibility_fit', {
      displayLabel: 'Eligibility Fit',
      sectionType: 'short_answer',
      templateIntent: 'eligibility',
      grantSemantic: null,
    })

    expect(basePrompt).toContain(
      'Section task: Show applicant and institutional fit with the call scope and eligibility constraints without overstating compliance.'
    )
  })
})
