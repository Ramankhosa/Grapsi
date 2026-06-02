import { describe, expect, it } from 'vitest'

import {
  buildGrantDraftContextContract,
  buildGrantPostGenerationValidation,
  validateGrantFinalExportReadiness,
} from '@/lib/grants/draftContextContract'
import {
  buildGrantComplianceReport,
  buildReviewerReadinessReport,
} from '@/lib/grants/compliance'
import type { GrantSectionComplianceContract } from '@/types/grant'

function makeContract(): GrantSectionComplianceContract {
  return {
    requiredPoints: ['Explain the national capability gap.'],
    evaluationFocus: ['Show measurable implementation feasibility.'],
    reviewerSignals: ['Connect the plan to institutional outcomes.'],
    avoidRules: ['Avoid generic claims without evidence.'],
    formatConstraints: ['Target approximately 500 words.'],
    narrativeConstraints: ['Use reviewer-facing proposal language.'],
    fundingCallSummary: ['Funding call: MeitY Cyber CoE Call', 'Agency: MeitY'],
    submissionChecklist: ['Upload signed institutional letter.'],
    templateGuidance: {
      pointer: 'technical_plan',
      guidanceText: ['Explain the execution methodology and validation plan.'],
      requiredFacts: ['Include measurable validation milestones.'],
      reviewerGoal: 'Show that the plan is feasible and fundable.',
      forbiddenMoves: ['Do not describe generic cybersecurity awareness.'],
      draftingVsSubmission: 'drafting',
    },
    prepEvidence: [
      {
        stageKey: 'problem_definition',
        pointKey: 'national_gap',
        label: 'National capability gap',
        keywords: ['state CERT readiness'],
        thrustLinkage: ['national cybersecurity mission'],
        factBullets: ['State CERT readiness is fragmented across regions.'],
        ruleNotes: ['Tie the gap to measurable institutional outcomes.'],
        confidence: 0.9,
        captureBasis: ['user_confirmed'],
        status: 'covered',
      },
    ],
    hardChecks: [],
    softChecks: [],
  }
}

describe('GrantDraftContextContract', () => {
  it('binds funding call rules, prep anchors, dimensions, and citation hints', () => {
    const contract = buildGrantDraftContextContract({
      section: {
        sectionKey: 'technical_plan',
        label: 'Technical Plan',
        workflowMode: 'app_draft',
        citationMode: 'mapped_evidence',
        mustCover: ['Describe the validated delivery model.'],
        dimensions: ['Implementation feasibility of federated cyber range networks'],
        grantSectionComplianceContract: makeContract(),
        grantRuleProfile: {
          requiredPoints: ['Explain the national capability gap.'],
          evaluationFocus: ['Show measurable implementation feasibility.'],
          reviewerSignals: ['Connect the plan to institutional outcomes.'],
          avoidRules: ['Avoid generic claims without evidence.'],
          formatConstraints: ['Target approximately 500 words.'],
          narrativeConstraints: ['Use reviewer-facing proposal language.'],
        },
        authoritativePrepBundle: {
          stageKeys: ['problem_definition'],
          bullets: ['State CERT readiness is fragmented across regions.'],
          keywords: ['state CERT readiness'],
        },
        relatedPrepAwareness: {
          stageKeys: ['evaluation'],
          bullets: ['Benchmark exercises will validate delivery readiness.'],
          keywords: ['benchmark exercises'],
        },
      },
      grantContextSummary: {
        freezeSummary: ['Funding call: MeitY Cyber CoE Call', 'Prep keywords: cyber resilience'],
      },
      evidence: {
        useMappedEvidence: true,
        allowedCitationKeys: ['Need2024'],
        dimensionEvidence: [
          {
            dimension: 'Implementation feasibility of federated cyber range networks',
            citations: [{ citationKey: 'Need2024' }],
          },
        ],
        evidenceDigest: { mustCiteKeys: ['Need2024'], optionalCiteKeys: [] },
      },
    })

    expect(contract.fundingCallSummary).toContain('Funding call: MeitY Cyber CoE Call')
    expect(contract.grantRuleProfile?.avoidRules).toContain('Avoid generic claims without evidence.')
    expect(contract.authoritativePrepBundle?.bullets).toContain('State CERT readiness is fragmented across regions.')
    expect(contract.mustCover).toEqual(['Describe the validated delivery model.'])
    expect(contract.dimensions).toEqual(['Implementation feasibility of federated cyber range networks'])
    expect(contract.evidence.allowedCitationKeys).toEqual(['Need2024'])
    expect(contract.readiness.issues).toEqual([])
    expect(contract.fingerprint).toHaveLength(16)
  })

  it('blocks mapped-evidence grant sections with dimensions but no mapped citations', () => {
    const contract = buildGrantDraftContextContract({
      section: {
        sectionKey: 'problem_need',
        workflowMode: 'app_draft',
        citationMode: 'mapped_evidence',
        dimensions: ['Burden and prevalence of child malnutrition in India'],
        grantSectionComplianceContract: makeContract(),
      },
      evidence: {
        useMappedEvidence: false,
        allowedCitationKeys: [],
        dimensionEvidence: [{ dimension: 'Burden and prevalence of child malnutrition in India', citations: [] }],
      },
    })

    expect(contract.readiness.issues.join(' ')).toMatch(/no mapped citation keys/i)
  })

  it('validates generated content against rules and Grant Prep evidence', () => {
    const context = buildGrantDraftContextContract({
      section: {
        sectionKey: 'technical_plan',
        workflowMode: 'app_draft',
        citationMode: 'mapped_evidence',
        grantSectionComplianceContract: makeContract(),
        dimensions: ['Implementation feasibility of federated cyber range networks'],
      },
      evidence: { useMappedEvidence: true, allowedCitationKeys: ['Need2024'] },
    })

    const validation = buildGrantPostGenerationValidation({
      contract: context,
      stage: 'pass2',
      content: [
        'The proposal explains the national capability gap: State CERT readiness is fragmented across regions.',
        'It includes measurable validation milestones and shows measurable implementation feasibility [CITE:Need2024].',
      ].join(' '),
      trace: { usedPrepEvidence: [], coveredRequiredPoints: [], unmetRequiredPoints: [], violatedAvoidRules: [], openQuestions: [] },
    })

    expect(validation.grantComplianceReport.usedPrepEvidence).toContain('problem_definition:national_gap')
    expect(validation.grantComplianceReport.passed).toBe(true)
    expect(validation.reviewerReadinessReport.strengths.join(' ')).toMatch(/Grant Prep evidence/i)
  })

  it('recommends measurable reviewer metrics when a draft lacks them', () => {
    const content = 'A 12-site pilot validated feasibility compared with current practice and showed delivery readiness.'
    const report = buildGrantComplianceReport({
      stage: 'pass2',
      content,
      contract: null,
    })
    const readiness = buildReviewerReadinessReport({
      report,
      content,
    })

    expect(readiness.recommendedActions.join(' ')).toMatch(/measurable success metric/i)
    expect(readiness.missingSignals.join(' ')).toMatch(/Measurable metrics or milestones are missing/i)
  })

  it('blocks final export when app draft sections are stale or unvalidated', () => {
    const readiness = validateGrantFinalExportReadiness({
      sections: [
        {
          sectionKey: 'technical_plan',
          label: 'Technical Plan',
          workflowMode: 'app_draft',
          required: true,
          content: 'Draft content',
          isStale: true,
        },
        {
          sectionKey: 'budget',
          label: 'Budget',
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          content: '',
        },
      ],
    })

    expect(readiness.ok).toBe(false)
    expect(readiness.issues.join(' ')).toMatch(/stale/i)
    expect(readiness.issues.join(' ')).toMatch(/not been validated/i)
    expect(readiness.issues.join(' ')).not.toMatch(/Budget has no final draft/)
  })

  it('blocks final export when a required budget has no structured rows', () => {
    const readiness = validateGrantFinalExportReadiness({
      sections: [
        {
          sectionKey: 'budget',
          label: 'Budget',
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          content: '',
          structuredResponses: [],
        },
      ],
    })

    expect(readiness.ok).toBe(false)
    expect(readiness.issues.join(' ')).toMatch(/Budget has no prepared budget rows/)
  })

  it('blocks final export when required budget rows only contain category labels', () => {
    const readiness = validateGrantFinalExportReadiness({
      sections: [
        {
          sectionKey: 'budget',
          label: 'Budget',
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          structuredResponses: [
            {
              fieldKey: 'structuredData',
              responseJson: {
                columns: [
                  { key: 'category', label: 'Category', kind: 'category' },
                  { key: 'amount', label: 'Amount', kind: 'amount' },
                  { key: 'justification', label: 'Justification', kind: 'justification' },
                ],
                rows: [{ category: 'Equipment', amount: null, justification: '' }],
              },
            },
          ],
        },
      ],
    })

    expect(readiness.ok).toBe(false)
    expect(readiness.issues.join(' ')).toMatch(/no prepared budget rows/)
    expect(readiness.issues.join(' ')).toMatch(/no confirmed numeric budget amounts/)
  })

  it('allows final export when a required budget has confirmed numeric values or justification', () => {
    const withAmount = validateGrantFinalExportReadiness({
      sections: [
        {
          sectionKey: 'budget',
          label: 'Budget',
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          structuredResponses: [
            {
              fieldKey: 'structuredData',
              responseJson: {
                columns: [
                  { key: 'category', label: 'Category', kind: 'category' },
                  { key: 'amount', label: 'Amount', kind: 'amount' },
                ],
                rows: [{ category: 'Equipment', amount: '1200' }],
              },
            },
          ],
        },
      ],
    })
    const withJustificationOnly = validateGrantFinalExportReadiness({
      sections: [
        {
          sectionKey: 'budget',
          label: 'Budget',
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          structuredResponses: [
            {
              fieldKey: 'structuredData',
              responseJson: {
                columns: [
                  { key: 'category', label: 'Category', kind: 'category' },
                  { key: 'justification', label: 'Justification', kind: 'justification' },
                ],
                rows: [{ category: 'Equipment', justification: 'Prototype hardware.' }],
              },
            },
          ],
        },
      ],
    })

    expect(withAmount).toEqual({ ok: true, issues: [] })
    expect(withJustificationOnly).toEqual({ ok: true, issues: [] })
  })

  it('blocks final export when a required budget has unresolved questions', () => {
    const readiness = validateGrantFinalExportReadiness({
      sections: [
        {
          sectionKey: 'budget',
          label: 'Budget',
          sectionType: 'budget_rows',
          workflowMode: 'app_draft',
          required: true,
          structuredResponses: [
            {
              fieldKey: 'structuredData',
              responseJson: {
                columns: [
                  { key: 'category', label: 'Category', kind: 'category' },
                  { key: 'amount', label: 'Amount', kind: 'amount' },
                ],
                rows: [{ category: 'Equipment', amount: '1200' }],
                openQuestions: ['Confirm equipment quote.'],
              },
            },
          ],
        },
      ],
    })

    expect(readiness.ok).toBe(false)
    expect(readiness.issues.join(' ')).toMatch(/unresolved budget questions/)
    expect(readiness.issues.join(' ')).toMatch(/Confirm equipment quote/)
  })
})
