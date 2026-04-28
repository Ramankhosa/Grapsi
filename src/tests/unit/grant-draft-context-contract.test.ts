import { describe, expect, it } from 'vitest'

import {
  buildGrantDraftContextContract,
  buildGrantPostGenerationValidation,
  validateGrantFinalExportReadiness,
} from '@/lib/grants/draftContextContract'
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
          workflowMode: 'app_support',
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
})
