import { describe, expect, it } from 'vitest'

import { buildGrantDraftingPrompt } from '@/lib/grants/draftingPromptComposer'
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

  it('builds a grant-native pass1 prompt with authoritative and awareness prep bundles', async () => {
    const prompt = await buildGrantDraftingPrompt({
      pass: 'pass1',
      outputMode: 'markdown',
      sectionKey: 'methodology',
      displayLabel: 'Methodology',
      sectionType: 'narrative',
      reviewerIntent: 'Show execution credibility and delivery control.',
      citationMode: 'mapped_evidence',
      grantSemantic: 'methodology',
      authoritativePrepBundle: {
        stageKeys: ['methodology'],
        bullets: ['Technical approach | federated cyber range ; threat emulation labs'],
        keywords: ['federated cyber range', 'threat emulation labs'],
      },
      relatedPrepAwareness: {
        stageKeys: ['evaluation'],
        bullets: ['Validation metrics | benchmark exercises'],
        keywords: ['benchmark exercises'],
      },
      mustCover: ['Execution model', 'Validation plan'],
      mustAvoid: ['Generic claims'],
      keyContributions: ['National cyber range', 'Training network'],
      purpose: 'Explain the execution methodology and validation plan.',
    })

    expect(prompt).toContain('TASK: GRANT SECTION DRAFT')
    expect(prompt).toContain('AUTHORITATIVE SECTION PREP POINTS:')
    expect(prompt).toContain('RELATED SECTION AWARENESS:')
    expect(prompt).not.toContain('Q1 journal')
    expect(prompt).not.toContain('publication quality')
    expect(prompt).not.toContain('paper blueprint')
  })

  it('builds a reviewer-polish pass2 prompt without paper-type publication guidance', async () => {
    const prompt = await buildGrantDraftingPrompt({
      pass: 'pass2',
      sectionKey: 'summary',
      displayLabel: 'Summary',
      sectionType: 'short_answer',
      grantSemantic: 'summary',
      grantContextSummary: {
        freezeSummary: ['Project: Cyber Centre of Excellence'],
      },
      baseContent: 'The proposal builds a national cyber range network. [CITE:alpha]',
      pass1Memory: {
        sectionIntent: 'Establish the proposal snapshot and funding fit.',
        openingStrategy: 'Lead with the need and the intervention.',
      },
      requiredCitationKeys: ['alpha'],
    })

    expect(prompt).toContain('TASK: REVIEWER POLISH')
    expect(prompt).toContain('PASS 1 MEMORY:')
    expect(prompt).toContain('[CITE:alpha]')
    expect(prompt).not.toContain('PUBLICATION TYPE GUIDANCE')
    expect(prompt).not.toContain('Q1 journal')
  })
})
