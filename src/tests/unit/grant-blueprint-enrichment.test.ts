import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuidelinePackDocument } from '../../lib/fundingGuidelines/types';
import { llmGateway } from '@/lib/metering';
import type { GrantPrepStageStates } from '../../lib/grantPrep/types';
import { generateGrantBlueprintWithLlm } from '../../lib/grants/blueprintLlmGeneration';
import {
  buildGeneratedGrantProposalFoundation,
  enrichGrantBlueprintSections,
} from '../../lib/grants/blueprintEnrichment';
import type { GrantBlueprintPlanSection } from '../../types/grant';

vi.mock('@/lib/metering', () => ({
  llmGateway: {
    executeLLMOperation: vi.fn(),
  },
}));

afterEach(() => {
  vi.mocked(llmGateway.executeLLMOperation).mockReset();
});

function makeSection(
  overrides: Partial<GrantBlueprintPlanSection>
): GrantBlueprintPlanSection {
  return {
    sectionKey: 'section',
    label: 'Section',
    order: 1,
    sectionType: 'narrative',
    workflowMode: 'app_draft',
    required: true,
    wordBudget: 600,
    characterLimit: null,
    purpose: 'Explain the proposal and justify the approach.',
    reviewerIntent: null,
    dependencies: [],
    sourceTemplatePointer: null,
    mustCover: [],
    mustAvoid: [],
    suggestedCitationCount: null,
    thematicBlueprint: null,
    seededContext: '',
    ...overrides,
  };
}

function makeStageStates(): GrantPrepStageStates {
  return {
    problem_definition: {
      stageKey: 'problem_definition',
      title: 'Problem Definition',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [
        {
          key: 'national_gap',
          label: 'National capability gap',
          priority: 'P1',
          status: 'covered',
          sourceTemplatePointer: 'problem_definition',
          capture: {
            keywords: ['cyber resilience gap', 'sector readiness'],
            thrustLinkage: ['national cybersecurity mission'],
            ruleCompliance: { status: 'warning', reason: 'Tie the gap to measurable outcomes.' },
            captureBasis: ['user_confirmed'],
            sourceTemplatePointer: 'problem_definition',
            updatedAt: '2026-04-20T00:00:00.000Z',
          },
        },
      ],
    },
    root_cause: {
      stageKey: 'root_cause',
      title: 'Root Cause',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    beneficiaries: {
      stageKey: 'beneficiaries',
      title: 'Beneficiaries',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [
        {
          key: 'target_beneficiaries',
          label: 'Target beneficiaries',
          priority: 'P2',
          status: 'covered',
          sourceTemplatePointer: 'beneficiaries',
          capture: {
            keywords: ['state CERT teams', 'engineering colleges'],
            thrustLinkage: ['workforce development'],
            ruleCompliance: { status: 'ok' },
            captureBasis: ['user_confirmed'],
            sourceTemplatePointer: 'beneficiaries',
            updatedAt: '2026-04-20T00:00:00.000Z',
          },
        },
      ],
    },
    fit_and_scope: {
      stageKey: 'fit_and_scope',
      title: 'Fit and Scope',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    thrust_alignment: {
      stageKey: 'thrust_alignment',
      title: 'Thrust Alignment',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    methodology: {
      stageKey: 'methodology',
      title: 'Methodology',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [
        {
          key: 'technical_approach',
          label: 'Technical approach',
          priority: 'P1',
          status: 'covered',
          sourceTemplatePointer: 'methodology',
          capture: {
            keywords: ['federated cyber range', 'threat emulation labs'],
            thrustLinkage: ['capacity building'],
            ruleCompliance: { status: 'ok' },
            captureBasis: ['user_confirmed'],
            sourceTemplatePointer: 'methodology',
            updatedAt: '2026-04-20T00:00:00.000Z',
          },
        },
      ],
    },
    workplan: {
      stageKey: 'workplan',
      title: 'Workplan',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    team_and_partnerships: {
      stageKey: 'team_and_partnerships',
      title: 'Team and Partnerships',
      enabled: false,
      pickable: true,
      readiness: 0,
      status: 'disabled',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    innovation: {
      stageKey: 'innovation',
      title: 'Innovation',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    evaluation: {
      stageKey: 'evaluation',
      title: 'Evaluation',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [
        {
          key: 'validation_metrics',
          label: 'Validation metrics',
          priority: 'P2',
          status: 'covered',
          sourceTemplatePointer: 'evaluation',
          capture: {
            keywords: ['deployment readiness', 'benchmark exercises'],
            thrustLinkage: ['evidence-based evaluation'],
            ruleCompliance: { status: 'ok' },
            captureBasis: ['user_confirmed'],
            sourceTemplatePointer: 'evaluation',
            updatedAt: '2026-04-20T00:00:00.000Z',
          },
        },
      ],
    },
    outcomes: {
      stageKey: 'outcomes',
      title: 'Outcomes',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [
        {
          key: 'expected_outcomes',
          label: 'Expected outcomes',
          priority: 'P1',
          status: 'covered',
          sourceTemplatePointer: 'outcomes',
          capture: {
            keywords: ['trained practitioners', 'shared test infrastructure'],
            thrustLinkage: ['ecosystem strengthening'],
            ruleCompliance: { status: 'ok' },
            captureBasis: ['user_confirmed'],
            sourceTemplatePointer: 'outcomes',
            updatedAt: '2026-04-20T00:00:00.000Z',
          },
        },
      ],
    },
    risk_and_ethics: {
      stageKey: 'risk_and_ethics',
      title: 'Risk and Ethics',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    budget_strategy: {
      stageKey: 'budget_strategy',
      title: 'Budget Strategy',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    sustainability_and_scale: {
      stageKey: 'sustainability_and_scale',
      title: 'Sustainability and Scale',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    final_pitch: {
      stageKey: 'final_pitch',
      title: 'Final Pitch',
      enabled: true,
      pickable: true,
      readiness: 1,
      status: 'completed',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [
        {
          key: 'proposal_snapshot',
          label: 'Proposal snapshot',
          priority: 'P1',
          status: 'covered',
          sourceTemplatePointer: 'final_pitch',
          capture: {
            keywords: ['national cyber range', 'training network'],
            thrustLinkage: ['digital sovereignty'],
            ruleCompliance: { status: 'ok' },
            captureBasis: ['user_confirmed'],
            sourceTemplatePointer: 'final_pitch',
            updatedAt: '2026-04-20T00:00:00.000Z',
          },
        },
      ],
    },
    handoff_ready: {
      stageKey: 'handoff_ready',
      title: 'Handoff Ready',
      enabled: false,
      pickable: false,
      readiness: 0,
      status: 'disabled',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
    handoff_complete: {
      stageKey: 'handoff_complete',
      title: 'Handoff Complete',
      enabled: false,
      pickable: false,
      readiness: 0,
      status: 'disabled',
      steeringEvents: [],
      lastUpdatedAt: '2026-04-20T00:00:00.000Z',
      points: [],
    },
  };
}

function makeGuidelinePack(): GuidelinePackDocument {
  const makeRule = (key: string, text: string, importance: 'high' | 'medium' | 'low' = 'medium') => ({
    key,
    text,
    importance,
    confidence: 1,
    sourceAnchors: [],
  });

  return {
    priorities: [
      makeRule('priority_alignment', 'Show alignment with national cybersecurity capacity building priorities.', 'high'),
    ],
    mustAddress: [
      makeRule('must_gap', 'Clearly articulate the capability gap addressed by the proposal.', 'high'),
      makeRule('must_outcomes', 'Show measurable outcomes for beneficiary institutions.', 'high'),
      makeRule('must_method', 'Explain the execution methodology and validation plan.', 'high'),
    ],
    avoid: [
      makeRule('avoid_generic', 'Avoid generic claims without evidence.', 'high'),
      makeRule('avoid_upload', 'Upload signed letters before submission.', 'medium'),
    ],
    evaluationCriteria: [
      makeRule('eval_impact', 'Demonstrate feasibility and measurable impact.', 'high'),
    ],
    budgetRules: [],
    durationRules: [
      makeRule('duration', 'Keep the execution timeline realistic and milestone-based.', 'medium'),
    ],
    formatRules: [
      makeRule('format_concise', 'Use concise reviewer-facing language.', 'medium'),
    ],
    submissionRules: [
      makeRule('submission_portal', 'Submit the application through the portal before the deadline.', 'high'),
    ],
    deliverableRules: [
      makeRule('deliverables', 'Define milestones and deliverables clearly.', 'medium'),
    ],
    reviewerSignals: [
      makeRule('reviewer_readiness', 'Reviewers prioritize implementation readiness.', 'high'),
    ],
    sourceAnchors: [],
  };
}

describe('grant blueprint enrichment', () => {
  it('generates typed dimensions only for app_draft sections', () => {
    const sections: GrantBlueprintPlanSection[] = [
      makeSection({
        sectionKey: 'summary',
        label: 'Summary of the Proposal',
        purpose: 'Summarize the proposal, its need, delivery model, and expected impact.',
        sectionType: 'narrative',
      }),
      makeSection({
        sectionKey: 'objectives',
        label: 'Objectives',
        purpose: 'State the aims and measurable objectives of the CoE.',
        sectionType: 'short_answer',
      }),
      makeSection({
        sectionKey: 'budget',
        label: 'Budget',
        sectionType: 'budget_rows',
        workflowMode: 'app_support',
      }),
      makeSection({
        sectionKey: 'pi_details',
        label: 'Principal Investigator Details',
        sectionType: 'checklist',
        workflowMode: 'team_manual',
      }),
    ];

    const enriched = enrichGrantBlueprintSections(sections, {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      globalKeywords: ['cybersecurity', 'capacity building', 'cyber range'],
      focusAreas: ['cybersecurity'],
    });

    expect(enriched[0].mustCover.length).toBeGreaterThanOrEqual(2);
    expect(enriched[0].mustCover.length).toBeLessThanOrEqual(4);
    expect(enriched[0].mustCoverTyping).toBeTruthy();
    expect(enriched[0].suggestedCitationCount).toBeGreaterThanOrEqual(2);
    expect(enriched[0].thematicBlueprint?.mustCover).toEqual(enriched[0].mustCover);
    expect(enriched[0].grantSemantic).toBe('summary');
    expect(enriched[0].prepContextBlock).toBeNull();
    expect(enriched[0].grantRuleProfile?.formatConstraints).toContain('Target approximately 600 words.');

    expect(enriched[1].mustCover.length).toBe(0);
    expect(enriched[1].suggestedCitationCount).toBe(0);
    expect(enriched[1].grantSemantic).toBe('objectives');

    expect(enriched[2].suggestedCitationCount).toBeNull();
    expect(enriched[2].thematicBlueprint).toBeNull();
    expect(enriched[2].grantSemantic).toBeNull();
    expect(enriched[2].prepContextBlock).toBeNull();
    expect(enriched[2].grantRuleProfile).toBeNull();
    expect(enriched[3].suggestedCitationCount).toBeNull();
    expect(enriched[3].thematicBlueprint).toBeNull();
    expect(enriched[3].grantSemantic).toBeNull();
  });

  it('uses covered direct prep as authoritative and keeps cross-section prep as awareness only', () => {
    const sections: GrantBlueprintPlanSection[] = [
      makeSection({
        sectionKey: 'technical_plan',
        label: 'Technical Plan',
        purpose: 'Explain the execution methodology, validation approach, milestones, and delivery readiness.',
        reviewerIntent: 'Show implementation feasibility.',
      }),
    ];

    const enriched = enrichGrantBlueprintSections(sections, {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      prepEvidenceBySection: {
        technical_plan: [
          {
            stageKey: 'methodology',
            pointKey: 'technical_approach',
            label: 'Technical approach',
            sourceTemplatePointer: 'technical_plan',
            sectionKeys: ['technical_plan'],
            keywords: ['federated cyber range'],
            thrustLinkage: ['capacity building'],
            factBullets: ['Federated cyber range network with threat emulation labs'],
            ruleNotes: [],
            confidence: 0.9,
            captureBasis: ['user_confirmed'],
            status: 'covered',
          },
          {
            stageKey: 'methodology',
            pointKey: 'draft_placeholder',
            label: 'Unverified note',
            sourceTemplatePointer: 'technical_plan',
            sectionKeys: ['technical_plan'],
            keywords: ['needs review only'],
            thrustLinkage: [],
            factBullets: ['Do not use this yet'],
            ruleNotes: ['Needs review before drafting'],
            confidence: 0.3,
            captureBasis: ['assistant_guess'],
            status: 'needs_review',
          },
        ],
        evaluation_notes: [
          {
            stageKey: 'evaluation',
            pointKey: 'validation_metrics',
            label: 'Validation metrics',
            sourceTemplatePointer: 'evaluation',
            sectionKeys: ['evaluation_plan'],
            keywords: ['benchmark exercises'],
            thrustLinkage: ['evidence-based evaluation'],
            factBullets: ['Validation will use benchmark exercises and deployment readiness checks'],
            ruleNotes: [],
            confidence: 0.88,
            captureBasis: ['user_confirmed'],
            status: 'covered',
          },
        ],
      },
    });

    expect(enriched[0].grantSemantic).toBe('methodology');
    expect(enriched[0].prepContextBlock?.stageKeys).toEqual(['methodology']);
    expect(enriched[0].authoritativePrepBundle?.keywords).toContain('federated cyber range');
    expect(enriched[0].authoritativePrepBundle?.bullets.join(' ')).not.toContain('Do not use this yet');
    expect(enriched[0].relatedPrepAwareness?.stageKeys).toEqual(['evaluation']);
    expect(enriched[0].relatedPrepAwareness?.keywords).toContain('benchmark exercises');
    expect(enriched[0].grantSectionComplianceContract?.prepEvidence).toHaveLength(1);
    expect(enriched[0].grantSectionComplianceContract?.prepEvidence[0]?.status).toBe('covered');
  });

  it('sends enriched prep evidence and rule contracts into the LLM blueprint prompt', async () => {
    const mockedGateway = vi.mocked(llmGateway.executeLLMOperation);
    mockedGateway.mockResolvedValueOnce({
      success: false,
      response: { output: '' },
    } as any);

    await generateGrantBlueprintWithLlm({
      baseSectionPlan: [
        makeSection({
          sectionKey: 'technical_plan',
          label: 'Technical Plan',
          purpose: 'Explain the execution methodology, validation approach, milestones, and delivery readiness.',
          reviewerIntent: 'Show implementation feasibility.',
        }),
      ],
      context: {
        projectTitle: 'Cyber Centre of Excellence',
        fundingCallTitle: 'MeitY Cyber CoE Call',
        guidelinePack: makeGuidelinePack(),
        prepEvidenceBySection: {
          technical_plan: [
            {
              stageKey: 'methodology',
              pointKey: 'technical_approach',
              label: 'Technical approach',
              sourceTemplatePointer: 'technical_plan',
              sectionKeys: ['technical_plan'],
              keywords: ['federated cyber range'],
              thrustLinkage: ['capacity building'],
              factBullets: ['Federated cyber range network with threat emulation labs'],
              ruleNotes: [],
              confidence: 0.9,
              captureBasis: ['user_confirmed'],
              status: 'covered',
            },
          ],
        },
      },
      tenantContext: { tenantId: 'tenant_1' } as any,
      sessionId: 'prep_session_1',
    });

    expect(mockedGateway).toHaveBeenCalledTimes(1);
    const prompt = String(mockedGateway.mock.calls[0]?.[1]?.prompt || '');
    expect(prompt).toContain('"prepContextBlock"');
    expect(prompt).toContain('Federated cyber range network with threat emulation labs');
    expect(prompt).toContain('"grantRuleProfile"');
    expect(prompt).toContain('"grantSectionComplianceContract"');
    expect(prompt).toContain('Explain the execution methodology and validation plan.');
  });

  it('classifies ambiguous headings by meaning and carries prep and rule context into app_draft sections', () => {
    const sections: GrantBlueprintPlanSection[] = [
      makeSection({
        sectionKey: 'introduction',
        label: 'Introduction',
        purpose: 'Provide a concise overview of the proposed Cyber Centre, its delivery model, and expected impact.',
        reviewerIntent: 'Give reviewers a high-level snapshot of the proposal.',
      }),
      makeSection({
        sectionKey: 'rationale',
        label: 'Background and Rationale',
        purpose: 'Describe the unmet cybersecurity capability gaps, beneficiary needs, and strategic justification for the centre.',
        reviewerIntent: 'Convince reviewers that the need is urgent and well evidenced.',
      }),
      makeSection({
        sectionKey: 'technical_plan',
        label: 'Technical Plan',
        purpose: 'Explain the execution methodology, validation approach, milestones, and delivery readiness.',
        reviewerIntent: 'Show implementation feasibility.',
      }),
    ];

    const enriched = enrichGrantBlueprintSections(sections, {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      agencyName: 'MeitY',
      globalKeywords: ['cybersecurity', 'capacity building', 'cyber range'],
      focusAreas: ['cybersecurity'],
      capturedKeywords: ['resilience'],
      stageStates: makeStageStates(),
      guidelinePack: makeGuidelinePack(),
    });

    expect(enriched[0].grantSemantic).toBe('summary');
    expect(enriched[0].prepContextBlock).toBeNull();
    expect(enriched[0].authoritativePrepBundle).toBeNull();
    expect(enriched[0].relatedPrepAwareness).toBeNull();
    expect(enriched[0].grantRuleProfile?.formatConstraints).toContain('Target approximately 600 words.');

    expect(enriched[1].grantSemantic).toBe('problem_need');
    expect(enriched[1].prepContextBlock).toBeNull();
    expect(enriched[1].authoritativePrepBundle).toBeNull();
    expect(enriched[1].grantRuleProfile?.requiredPoints).toContain(
      'Clearly articulate the capability gap addressed by the proposal.'
    );
    expect(enriched[1].grantRuleProfile?.reviewerSignals).toContain(
      'Reviewers prioritize implementation readiness.'
    );
    expect(enriched[1].grantRuleProfile?.avoidRules).toContain('Avoid generic claims without evidence.');
    expect(enriched[1].grantRuleProfile?.avoidRules).not.toContain('Upload signed letters before submission.');
    expect(enriched[1].grantSectionComplianceContract?.requiredPoints).toContain(
      'Clearly articulate the capability gap addressed by the proposal.'
    );
    expect(enriched[1].grantSectionComplianceContract?.prepEvidence).toHaveLength(0);
    expect(enriched[1].grantSectionComplianceContract?.submissionChecklist).toContain(
      'Submit the application through the portal before the deadline.'
    );
    expect(enriched[1].grantComplianceReport?.stage).toBe('blueprint');
    expect(enriched[1].grantComplianceReport?.passed).toBe(true);
    expect(enriched[1].reviewerReadinessReport?.score).toBeGreaterThan(0);

    expect(enriched[2].grantSemantic).toBe('methodology');
    expect(enriched[2].prepContextBlock).toBeNull();
    expect(enriched[2].authoritativePrepBundle).toBeNull();
    expect(enriched[2].grantRuleProfile?.requiredPoints).toContain(
      'Explain the execution methodology and validation plan.'
    );
    expect(enriched[2].grantRuleProfile?.evaluationFocus).toContain(
      'Demonstrate feasibility and measurable impact.'
    );
  });

  it('can explicitly disable literature mapping for concise app_draft sections', () => {
    const sections: GrantBlueprintPlanSection[] = [
      makeSection({
        sectionKey: 'objectives',
        label: 'Objectives',
        sectionType: 'short_answer',
        wordBudget: 100,
        purpose: 'State the aims and measurable objectives of the project.',
      }),
      makeSection({
        sectionKey: 'alignment',
        label: 'Mission Alignment',
        sectionType: 'short_answer',
        wordBudget: 120,
        purpose: 'Show how the proposal aligns with the scheme priorities and mission.',
      }),
    ];

    const enriched = enrichGrantBlueprintSections(sections, {
      projectTitle: 'Climate Resilient Agriculture Platform',
      fundingCallTitle: 'Climate Resilient Agriculture Research Grant',
      globalKeywords: ['climate resilience', 'smallholder farming'],
      focusAreas: ['agriculture', 'climate change'],
    });

    expect(enriched[0].grantSemantic).toBe('objectives');
    expect(enriched[0].mustCover).toEqual([]);
    expect(enriched[0].suggestedCitationCount).toBe(0);
    expect(enriched[0].thematicBlueprint?.mustCover).toEqual([]);
    expect(enriched[0].thematicBlueprint?.suggestedCitationCount).toBe(0);

    expect(enriched[1].grantSemantic).toBe('alignment');
    expect(enriched[1].mustCover).toEqual([]);
    expect(enriched[1].suggestedCitationCount).toBe(0);
  });

  it('routes explicit guideline metadata before semantic fallback', () => {
    const methodologyRule = {
      key: 'method_hard',
      text: 'Explain the validation protocol and implementation feasibility evidence.',
      importance: 'high' as const,
      enforcementLevel: 'hard' as const,
      appliesTo: ['methodology'],
      draftingStage: ['methodology'],
      draftingVsSubmission: 'drafting' as const,
      confidence: 1,
      sourceAnchors: [],
    };
    const problemRule = {
      key: 'problem_hard',
      text: 'Quantify the unmet need and baseline capability gap.',
      importance: 'high' as const,
      enforcementLevel: 'hard' as const,
      appliesTo: ['problem_need'],
      draftingStage: ['problem_definition'],
      draftingVsSubmission: 'drafting' as const,
      confidence: 1,
      sourceAnchors: [],
    };
    const sections: GrantBlueprintPlanSection[] = [
      makeSection({
        sectionKey: 'rationale',
        label: 'Need and Rationale',
        purpose: 'Explain the unmet capability gap and baseline need.',
      }),
      makeSection({
        sectionKey: 'methodology',
        label: 'Methodology',
        purpose: 'Explain the technical approach, validation protocol, and implementation plan.',
      }),
    ];

    const enriched = enrichGrantBlueprintSections(sections, {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      guidelinePack: {
        ...makeGuidelinePack(),
        mustAddress: [methodologyRule, problemRule],
      },
    });

    expect(enriched[0].grantSemantic).toBe('problem_need');
    expect(enriched[0].grantRuleProfile?.requiredPoints).toContain(
      'Quantify the unmet need and baseline capability gap.'
    );
    expect(enriched[0].grantRuleProfile?.requiredPoints).not.toContain(
      'Explain the validation protocol and implementation feasibility evidence.'
    );
    expect(enriched[0].grantSectionComplianceContract?.hardChecks.map((item) => item.ruleText)).not.toContain(
      'Explain the validation protocol and implementation feasibility evidence.'
    );

    expect(enriched[1].grantSemantic).toBe('methodology');
    expect(enriched[1].grantRuleProfile?.requiredPoints).toContain(
      'Explain the validation protocol and implementation feasibility evidence.'
    );
    expect(enriched[1].grantRuleProfile?.requiredPoints).not.toContain(
      'Quantify the unmet need and baseline capability gap.'
    );
    expect(enriched[1].grantSectionComplianceContract?.hardChecks.map((item) => item.ruleText)).toContain(
      'Explain the validation protocol and implementation feasibility evidence.'
    );
  });

  it('treats literature review and state-of-the-art sections as evidence mapped grant narrative', () => {
    const enriched = enrichGrantBlueprintSections([
      makeSection({
        sectionKey: 'literature_review',
        label: 'Literature Review and State of the Art',
        wordBudget: 900,
        purpose: 'Synthesize prior work, evidence landscape, remaining gaps, and comparative benchmarks.',
      }),
    ], {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      globalKeywords: ['cybersecurity', 'capacity building'],
      focusAreas: ['cybersecurity'],
    });

    expect(enriched[0].grantSemantic).toBe('problem_need');
    expect(enriched[0].mustCover.length).toBeGreaterThanOrEqual(3);
    expect(enriched[0].suggestedCitationCount).toBeGreaterThanOrEqual(3);
    expect(enriched[0].thematicBlueprint?.mustCover).toEqual(enriched[0].mustCover);
  });

  it('generates searchable evidence pillars rather than final draft claims', () => {
    const enriched = enrichGrantBlueprintSections([
      makeSection({
        sectionKey: 'need_and_evidence',
        label: 'Need and Evidence Base',
        wordBudget: 900,
        purpose: 'Explain current state of malnutrition in India; role of nutrition in child physical development; role of nutrition in cognitive performance.',
      }),
    ], {
      projectTitle: 'Child Nutrition Improvement Proposal',
      fundingCallTitle: 'Child Health Grant',
      globalKeywords: ['child nutrition', 'malnutrition in India', 'child physical development', 'cognitive performance'],
      focusAreas: ['child health', 'nutrition'],
    });

    const pillars = enriched[0].mustCover;

    expect(pillars.some((item) => /current state of malnutrition in india/i.test(item))).toBe(true);
    expect(pillars.some((item) => /role of nutrition in child physical development|role of nutrition in cognitive performance/i.test(item))).toBe(true);
    expect(pillars.join(' ')).not.toMatch(/scale, burden, or urgency|reviewer-visible|evidence for the problem/i);
    expect(enriched[0].thematicBlueprint?.mustCover).toEqual(pillars);
  });

  it('uses trusted template intent as the semantic prior and falls back when alternates signal ambiguity', () => {
    const sections: GrantBlueprintPlanSection[] = [
      makeSection({
        sectionKey: 'weak_method_section',
        label: 'Section 2',
        purpose: 'Provide the requested response.',
        templateIntent: 'methodology',
        templateIntentConfidence: 0.94,
      }),
      makeSection({
        sectionKey: 'ambiguous_summary',
        label: 'Summary',
        purpose: 'Summarize the proposal, its need, and expected outcomes.',
        templateIntent: 'methodology',
        templateIntentAlternates: ['workplan', 'evaluation'],
        templateIntentConfidence: 0.95,
      }),
    ];

    const enriched = enrichGrantBlueprintSections(sections, {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      globalKeywords: ['cybersecurity', 'capacity building'],
      stageStates: makeStageStates(),
    });

    expect(enriched[0].grantSemantic).toBe('methodology');
    expect(enriched[0].prepContextBlock).toBeNull();
    expect(enriched[0].authoritativePrepBundle).toBeNull();

    expect(enriched[1].grantSemantic).toBe('summary');
    expect(enriched[1].prepContextBlock).toBeNull();
    expect(enriched[1].authoritativePrepBundle).toBeNull();
  });

  it('builds a usable proposal foundation from enriched sections', () => {
    const sections = enrichGrantBlueprintSections([
      makeSection({
        sectionKey: 'summary',
        label: 'Summary of the Proposal',
        purpose: 'Summarize the proposal, its need, delivery model, and expected impact.',
      }),
      makeSection({
        sectionKey: 'methodology',
        label: 'Detailed project plan, deliverables and timelines',
        purpose: 'Describe the execution model, milestones, evaluation, and implementation plan.',
      }),
    ], {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      globalKeywords: ['cybersecurity', 'capacity building', 'cyber range'],
      focusAreas: ['cybersecurity'],
    });

    const foundation = buildGeneratedGrantProposalFoundation(sections, {
      projectTitle: 'Cyber Centre of Excellence',
      fundingCallTitle: 'MeitY Cyber CoE Call',
      globalKeywords: ['cybersecurity', 'capacity building', 'cyber range'],
      focusAreas: ['cybersecurity'],
    });

    expect(foundation.thesisStatement.length).toBeGreaterThanOrEqual(20);
    expect(foundation.centralObjective.length).toBeGreaterThanOrEqual(20);
    expect(foundation.keyContributions.length).toBeGreaterThanOrEqual(2);
  });
});
