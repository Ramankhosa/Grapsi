import { describe, expect, it } from 'vitest'

import { buildGrantPrepFreezePayload } from '@/lib/grantPrep/handoff/handoffBuilder'
import {
  buildProposalGrantComplianceReport,
  buildProposalReviewerReadinessReport,
  buildReviewerReadinessReport,
} from '@/lib/grants/compliance'
import type { GrantPrepSessionContext } from '@/lib/grantPrep/types'
import type { GrantComplianceReport, ReviewerReadinessReport } from '@/types/grant'

function makeSectionReport(overrides?: Partial<GrantComplianceReport>): GrantComplianceReport {
  return {
    stage: 'pass2',
    passed: true,
    coveredRequiredPoints: ['Explain the national capability gap.'],
    unmetRequiredPoints: [],
    violatedAvoidRules: [],
    missingEvidence: [],
    hardFailures: [],
    softWarnings: [],
    usedPrepEvidence: ['problem_definition:national_gap'],
    generatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  }
}

function makeReviewerReport(overrides?: Partial<ReviewerReadinessReport>): ReviewerReadinessReport {
  return {
    score: 84,
    strengths: ['Clear reviewer-facing framing.'],
    risks: [],
    missingSignals: [],
    recommendedActions: ['Keep the execution logic concrete.'],
    generatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('grant prep freeze payload', () => {
  const fundingContext = {
    id: 'call_1',
    source: 'linked_funding_call',
    isLinkedCall: true,
    isLegacyFallback: false,
    isPrivateDraft: false,
    verificationStatus: 'approved',
    title: 'MeitY Cyber CoE Call',
    agencyName: 'MeitY',
    description: 'Cyber CoE funding call',
    deadline: '2026-05-15',
    funding: 'INR 500 lakh',
    budgetLimits: 'Up to INR 500 lakh',
    projectDuration: '36 months',
    eligibility: 'Academic institutions',
    deliverables: 'Milestones and training outputs',
    focusAreas: ['cybersecurity'],
    disciplines: [],
    fundingKinds: [],
    officialUrls: ['https://example.org/call'],
    sourceUrl: null,
    guidelineStatus: 'approved',
    templateStatus: 'approved',
    approvedGuidelineRevision: null,
    approvedTemplate: null,
    warning: null,
    legacyCallAnalysis: null,
  } as any

  it('preserves prep evidence by section and builds a global capture summary', () => {
    const session = {
      mode: 'template_driven',
      engagementMode: 'expert',
      selectedThrustAreaRuleKeys: [],
      stageMapping: {},
      globalKeywords: ['cyber resilience'],
      stageStates: {
        problem_definition: {
          stageKey: 'problem_definition',
          title: 'Problem Definition',
          enabled: true,
          pickable: true,
          readiness: 1,
          status: 'completed',
          steeringEvents: [],
          lastUpdatedAt: '2026-04-21T00:00:00.000Z',
          points: [
            {
              key: 'national_gap',
              label: 'National capability gap',
              priority: 'P1',
              status: 'covered',
              sourceTemplatePointer: 'sections.summary',
              capture: {
                keywords: ['state CERT readiness'],
                thrustLinkage: ['national cybersecurity mission'],
                factBullets: ['State CERT readiness is fragmented across regions.'],
                ruleNotes: ['Tie the gap to measurable institutional outcomes.'],
                confidence: 0.9,
                ruleCompliance: { status: 'ok' },
                captureBasis: ['user_confirmed'],
                sourceTemplatePointer: 'sections.summary',
                updatedAt: '2026-04-21T00:00:00.000Z',
              },
            },
          ],
        },
      },
    } as unknown as GrantPrepSessionContext

    const result = buildGrantPrepFreezePayload({
      project: {
        id: 'project_1',
        title: 'Cyber Centre of Excellence',
        description: 'National cyber readiness infrastructure',
      },
      fundingContext,
      session,
      guidelineRevisionId: 'guideline_rev_1',
      templateRevisionId: 'template_rev_1',
      compiledSections: [
        {
          sectionKey: 'summary',
          sourceTemplatePointer: 'sections.summary',
        },
      ],
    })

    expect(result.blockers).toEqual([])
    expect(result.payload.prepEvidence).toHaveLength(1)
    expect(result.payload.prepEvidenceBySection.summary).toHaveLength(1)
    expect(result.payload.prepEvidenceBySection.summary[0]?.factBullets).toContain(
      'State CERT readiness is fragmented across regions.'
    )
    expect(result.payload.globalCaptureSummary[0]).toContain('National capability gap')
    expect(result.payload.globalCaptureSummary[0]).toContain('Rule note')
  })

  it('blocks launch when required-stage P2 detail keeps readiness below threshold', () => {
    const session = {
      mode: 'template_driven',
      engagementMode: 'expert',
      selectedThrustAreaRuleKeys: [],
      stageMapping: {},
      globalKeywords: [],
      stageStates: {
        methodology: {
          stageKey: 'methodology',
          title: 'Methodology',
          enabled: true,
          pickable: true,
          readiness: 0.5,
          status: 'in_progress',
          steeringEvents: [],
          lastUpdatedAt: '2026-04-21T00:00:00.000Z',
          points: [
            {
              key: 'approach',
              label: 'Core approach',
              priority: 'P1',
              status: 'covered',
              sourceTemplatePointer: null,
              conversationRole: 'user_required',
              capture: {
                keywords: ['phased pilot'],
                thrustLinkage: [],
                factBullets: ['The project will run as a phased pilot.'],
                ruleNotes: [],
                confidence: 0.9,
                ruleCompliance: { status: 'ok' },
                captureBasis: ['user_confirmed'],
                sourceTemplatePointer: null,
                updatedAt: '2026-04-21T00:00:00.000Z',
              },
            },
            {
              key: 'evidence_generation',
              label: 'Data, validation, or evidence plan',
              priority: 'P2',
              status: 'pending',
              sourceTemplatePointer: null,
              conversationRole: 'user_required',
              capture: null,
            },
          ],
        },
      },
    } as unknown as GrantPrepSessionContext

    const result = buildGrantPrepFreezePayload({
      project: { id: 'project_1', title: 'Cyber Centre of Excellence', description: null },
      fundingContext,
      session,
      guidelineRevisionId: null,
      templateRevisionId: null,
    })

    expect(result.blockers).toEqual([
      {
        stageKey: 'methodology',
        pointKey: 'evidence_generation',
        message: 'Methodology: Data, validation, or evidence plan is still incomplete.',
      },
    ])
  })

  it('still blocks launch when a core P1 fact is missing', () => {
    const session = {
      mode: 'template_driven',
      engagementMode: 'expert',
      selectedThrustAreaRuleKeys: [],
      stageMapping: {},
      globalKeywords: [],
      stageStates: {
        methodology: {
          stageKey: 'methodology',
          title: 'Methodology',
          enabled: true,
          pickable: true,
          readiness: 0,
          status: 'not_started',
          steeringEvents: [],
          lastUpdatedAt: null,
          points: [
            {
              key: 'approach',
              label: 'Core approach',
              priority: 'P1',
              status: 'pending',
              sourceTemplatePointer: null,
              conversationRole: 'user_required',
              capture: null,
            },
          ],
        },
      },
    } as unknown as GrantPrepSessionContext

    const result = buildGrantPrepFreezePayload({
      project: { id: 'project_1', title: 'Cyber Centre of Excellence', description: null },
      fundingContext,
      session,
      guidelineRevisionId: null,
      templateRevisionId: null,
    })

    expect(result.blockers).toEqual([
      {
        stageKey: 'methodology',
        pointKey: 'approach',
        message: 'Methodology: Core approach is still incomplete.',
      },
    ])
  })
})

describe('proposal-level grant compliance', () => {
  it('fails when a required draftable section is missing and exposes reviewer actions', () => {
    const sections = [
      {
        sectionKey: 'summary',
        label: 'Summary',
        required: true,
        workflowMode: 'app_draft' as const,
        grantSemantic: 'summary' as const,
        content: 'We will build a national cyber range to improve state CERT readiness.',
        grantComplianceReport: makeSectionReport(),
        reviewerReadinessReport: makeReviewerReport(),
      },
      {
        sectionKey: 'methodology',
        label: 'Methodology',
        required: true,
        workflowMode: 'app_draft' as const,
        grantSemantic: 'methodology' as const,
        content: '',
        grantComplianceReport: null,
        reviewerReadinessReport: null,
      },
      {
        sectionKey: 'outcomes',
        label: 'Outcomes',
        required: true,
        workflowMode: 'app_draft' as const,
        grantSemantic: 'impact_outcomes' as const,
        content: 'The proposal will strengthen institutional readiness and shared training infrastructure.',
        grantComplianceReport: makeSectionReport({
          usedPrepEvidence: ['outcomes:expected_outcomes'],
        }),
        reviewerReadinessReport: makeReviewerReport({
          strengths: ['Outcomes are concrete and reviewer-facing.'],
        }),
      },
    ]

    const report = buildProposalGrantComplianceReport({
      sections,
      foundation: {
        thesisStatement: 'Build a national cyber range for state CERT readiness.',
        centralObjective: 'Build a national cyber range for state CERT readiness.',
        keyContributions: ['State CERT training network'],
      },
    })
    const readiness = buildProposalReviewerReadinessReport({ report, sections })

    expect(report.stage).toBe('proposal')
    expect(report.passed).toBe(false)
    expect(report.hardFailures.some((item) => item.message.includes('Methodology'))).toBe(true)
    expect(readiness.score).toBeLessThan(100)
    expect(readiness.recommendedActions.length).toBeGreaterThan(0)
  })

  it('passes when required sections are drafted and prep evidence survives proposal-wide', () => {
    const sections = [
      {
        sectionKey: 'summary',
        label: 'Summary',
        required: true,
        workflowMode: 'app_draft' as const,
        grantSemantic: 'summary' as const,
        content: 'Build a national cyber range for state CERT readiness and measurable institutional outcomes.',
        grantComplianceReport: makeSectionReport(),
        reviewerReadinessReport: makeReviewerReport(),
      },
      {
        sectionKey: 'methodology',
        label: 'Methodology',
        required: true,
        workflowMode: 'app_draft' as const,
        grantSemantic: 'methodology' as const,
        content: 'The methodology builds the national cyber range through phased lab deployment, validation drills, and training operations.',
        grantComplianceReport: makeSectionReport({
          coveredRequiredPoints: ['Explain the execution methodology and validation plan.'],
          usedPrepEvidence: ['methodology:technical_approach'],
        }),
        reviewerReadinessReport: makeReviewerReport({
          strengths: ['Execution path is concrete.'],
        }),
      },
      {
        sectionKey: 'outcomes',
        label: 'Outcomes',
        required: true,
        workflowMode: 'app_draft' as const,
        grantSemantic: 'impact_outcomes' as const,
        content: 'Expected outcomes include a State CERT training network, validated readiness drills, and a shared cyber range infrastructure.',
        grantComplianceReport: makeSectionReport({
          coveredRequiredPoints: ['Show measurable outcomes for beneficiary institutions.'],
          usedPrepEvidence: ['outcomes:expected_outcomes'],
        }),
        reviewerReadinessReport: makeReviewerReport({
          strengths: ['Promised contributions are visible in the outcomes case.'],
        }),
      },
    ]

    const report = buildProposalGrantComplianceReport({
      sections,
      foundation: {
        thesisStatement: 'Build a national cyber range for state CERT readiness.',
        centralObjective: 'Build a national cyber range for state CERT readiness.',
        keyContributions: ['State CERT training network'],
      },
    })

    expect(report.passed).toBe(true)
    expect(report.usedPrepEvidence.length).toBeGreaterThan(0)
    expect(report.hardFailures).toEqual([])
  })

  it('flags missing statistics, comparisons, and feasibility evidence in reviewer readiness heuristics', () => {
    const readiness = buildReviewerReadinessReport({
      contract: {
        requiredPoints: ['State the burden clearly.'],
        evaluationFocus: [],
        reviewerSignals: ['Use concrete evidence.'],
        avoidRules: [],
        formatConstraints: [],
        narrativeConstraints: [],
        prepEvidence: [],
        templateGuidance: null,
        fundingCallSummary: [],
        submissionChecklist: [],
        hardChecks: [],
        softChecks: [],
      },
      report: makeSectionReport(),
      content: 'The issue is important and our team is well positioned to address it.',
    })

    expect(readiness.missingSignals).toContain('Specific statistics are missing.')
    expect(readiness.missingSignals).toContain('Named comparisons are missing.')
    expect(readiness.missingSignals).toContain('Feasibility evidence is missing.')
    expect(readiness.recommendedActions).toContain('Add at least one concrete burden, prevalence, cost, or baseline statistic.')
  })
})
