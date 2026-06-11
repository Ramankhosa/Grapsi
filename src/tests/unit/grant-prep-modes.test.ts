import { describe, expect, it } from 'vitest'

import { buildGrantPrepPrompt, buildIdeationPrompt } from '@/lib/grantPrep/promptComposer'
import {
  deriveGrantPrepPriorityAreaOptions,
  normalizeGrantPrepPriorityAreaSelection,
} from '@/lib/grantPrep/priorityAreas'
import { parseGrantPrepResponse } from '@/lib/grantPrep/marker'
import {
  buildGrantPrepConversationBundle,
  getGrantPrepCrossStageAllowedPointKeys,
} from '@/lib/grantPrep/proactivePlanner'
import { mergeGrantPrepSuggestedAnswersWithInline } from '@/lib/grantPrep/suggestedAnswers'
import {
  applyCrossStageMarkerToStageStates,
  applyMarkerToStageStates,
  buildGrantPrepSessionContext,
  buildInitialStageStates,
  canAutoAdvanceGrantPrepStage,
  computeStageReadiness,
  isGrantPrepSessionReady,
  propagateDependentNeedsReview,
} from '@/lib/grantPrep/sessionState'
import { buildGrantPrepStageMapping } from '@/lib/grantPrep/templateMapper'
import { refreshGrantPrepSessionContext } from '@/lib/grantPrep/server'
import { runGrantPrepStageTidyPass } from '@/lib/grantPrep/tidyPass'

function makeSession(engagementMode: 'expert' | 'express') {
  const stageMapping = buildGrantPrepStageMapping(null)
  const stageStates = buildInitialStageStates(stageMapping)

  return buildGrantPrepSessionContext({
    mode: 'template_driven',
    engagementMode,
    stageMapping,
    stageStates,
  })
}

function makeFundingContext() {
  return {
    title: 'National Health Translation Call',
    agencyName: 'ICMR',
    deadline: '2026-08-15',
    funding: 'INR 500 lakh',
    projectDuration: '36 months',
    eligibility: 'Academic and clinical institutions',
    focusAreas: ['public health', 'implementation science'],
    disciplines: ['public health', 'implementation science'],
    fundingKinds: ['research grant'],
    warning: null,
  } as any
}

describe('grant prep prompt modes', () => {
  it('starts new sessions on ideation before problem definition', () => {
    const session = makeSession('expert')

    expect(session.enabledStageKeys[0]).toBe('ideation')
    expect(session.activeStageKey).toBe('ideation')
  })

  it('builds a stricter expert prompt for framing stages', () => {
    const session = makeSession('expert')

    const prompt = buildGrantPrepPrompt({
      session,
      stageKey: 'problem_definition',
      project: {
        title: 'Rural Diabetes Adherence',
        description: 'Improving medication adherence in heat-vulnerable districts',
      },
      fundingContext: makeFundingContext(),
      guidelinePack: null,
      conversation: [],
      userMessage: 'We want to address diabetes adherence in rural areas.',
    })

    expect(prompt).toContain('reviewed hundreds of funding proposals')
    expect(prompt).toContain('Treat them as active reviewer constraints, not optional background.')
    expect(prompt).toContain('COMPETITIVE PROBING:')
    expect(prompt).toContain('Concrete reviewer-useful facts to capture for this stage:')
    expect(prompt).toContain('problem scale, burden, cost, prevalence, or baseline')
    expect(prompt).toContain('captureBasis to include "generic_placeholder"')
    expect(prompt).toContain('Coverage objective for this turn:')
    expect(prompt).toContain('exactly three approval bundle options labeled A, B, C')
    expect(prompt).toContain('Related stage opportunity:')
    expect(prompt).not.toContain(`I approve this ${'bundle'}:`)
  })

  it('keeps the express prompt on the fast extraction path', () => {
    const session = makeSession('express')

    const prompt = buildGrantPrepPrompt({
      session,
      stageKey: 'problem_definition',
      project: {
        title: 'Rural Diabetes Adherence',
        description: null,
      },
      fundingContext: makeFundingContext(),
      guidelinePack: null,
      conversation: [],
      userMessage: 'Here is our concept note and short pitch.',
    })

    expect(prompt).toContain('The user is in Express mode.')
    expect(prompt).not.toContain('COMPETITIVE PROBING:')
    expect(prompt).not.toContain('Treat them as active reviewer constraints, not optional background.')
  })

  it('uses stage memory instead of completed-stage raw history and fallback fact blocks', () => {
    const session = makeSession('expert')
    session.stageStates.problem_definition = {
      ...session.stageStates.problem_definition,
      readiness: 0.85,
      status: 'completed',
      memory: {
        version: 'stage_memory_v1',
        updatedAt: '2026-06-11T00:00:00.000Z',
        confirmedFacts: ['Memory says rural diabetes adherence is the confirmed problem.'],
        openGaps: ['Memory says prevalence still needs a cited baseline.'],
        reviewerRisks: ['Memory says generic rural framing is a reviewer risk.'],
        keywords: ['rural diabetes adherence'],
        source: 'deterministic',
      },
      points: session.stageStates.problem_definition.points.map((point) =>
        point.key === 'problem_core'
          ? {
              ...point,
              status: 'covered',
              capture: {
                keywords: ['fallback keyword'],
                thrustLinkage: [],
                factBullets: ['Fallback fact should not appear when memory exists.'],
                ruleNotes: ['Fallback rule note should not appear when memory exists.'],
                confidence: 0.9,
                captureBasis: ['user_confirmed'],
                sourceTemplatePointer: null,
                ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
                updatedAt: '2026-06-11T00:00:00.000Z',
              },
            }
          : point
      ),
    } as any

    const prompt = buildGrantPrepPrompt({
      session,
      stageKey: 'methodology',
      project: {
        title: 'Rural Diabetes Adherence',
        description: null,
      },
      fundingContext: makeFundingContext(),
      guidelinePack: null,
      conversation: [
        {
          role: 'assistant',
          stageKey: 'problem_definition',
          content: 'Old completed-stage option bundle should not appear.',
        },
        {
          role: 'user',
          stageKey: 'methodology',
          content: 'Now help with the method.',
        },
      ],
      userMessage: 'Now help with the method.',
    })

    expect(prompt).toContain('Memory says rural diabetes adherence is the confirmed problem.')
    expect(prompt).toContain('Memory says prevalence still needs a cited baseline.')
    expect(prompt).toContain('Memory says generic rural framing is a reviewer risk.')
    expect(prompt).not.toContain('Fallback fact should not appear')
    expect(prompt).not.toContain('Old completed-stage option bundle should not appear.')
  })

  it('keeps latest suggested answers available across stage boundaries', () => {
    const session = makeSession('expert')

    const prompt = buildGrantPrepPrompt({
      session,
      stageKey: 'methodology',
      project: {
        title: 'Rural Diabetes Adherence',
        description: null,
      },
      fundingContext: makeFundingContext(),
      guidelinePack: null,
      conversation: [
        {
          role: 'assistant',
          stageKey: 'problem_definition',
          content: 'A. Clinic anchor model.\nB. Mobile outreach model.\nC. Hybrid model.',
          suggestedAnswers: [
            { label: 'A', text: 'Clinic anchor model.' },
            { label: 'B', text: 'Mobile outreach model.' },
            { label: 'C', text: 'Hybrid model.' },
          ],
        },
        {
          role: 'user',
          stageKey: 'methodology',
          content: 'I choose B.',
        },
      ],
      userMessage: 'I choose B.',
    })

    expect(prompt).toContain('A. Clinic anchor model.')
    expect(prompt).toContain('B. Mobile outreach model.')
    expect(prompt).toContain('I choose B.')
  })

  it('preserves stage memory during template refresh merges', () => {
    const session = makeSession('expert')
    session.stageStates.problem_definition.memory = {
      version: 'stage_memory_v1',
      updatedAt: '2026-06-11T00:00:00.000Z',
      confirmedFacts: ['Problem memory survives refresh.'],
      openGaps: [],
      reviewerRisks: [],
      keywords: ['problem memory'],
      source: 'deterministic',
    }

    const refreshed = refreshGrantPrepSessionContext({
      sessionContext: {
        ...session,
        stageSelectionVersion: 'v3',
      },
      templateJson: null,
      guidelinePack: null,
      fundingContext: makeFundingContext(),
      warning: null,
    })

    expect(refreshed.stageStates.problem_definition.memory?.confirmedFacts).toContain('Problem memory survives refresh.')
  })

  it('marks downstream stage memory stale when upstream stages change', () => {
    const session = makeSession('expert')
    session.stageStates.root_cause.memory = {
      version: 'stage_memory_v1',
      updatedAt: '2026-06-11T00:00:00.000Z',
      confirmedFacts: ['Root cause memory depends on the old problem framing.'],
      openGaps: [],
      reviewerRisks: [],
      keywords: ['old root cause'],
      source: 'deterministic',
    }
    session.stageStates.root_cause.points = session.stageStates.root_cause.points.map((point) =>
      point.key === 'root_drivers'
        ? {
            ...point,
            status: 'covered',
            capture: {
              keywords: [],
              thrustLinkage: [],
              factBullets: ['The old root cause depends on the old problem framing.'],
              ruleNotes: [],
              confidence: 0.9,
              captureBasis: ['user_confirmed'],
              sourceTemplatePointer: null,
              ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
              updatedAt: '2026-06-11T00:00:00.000Z',
            },
          }
        : point
    ) as any

    const nextStates = propagateDependentNeedsReview(
      session.stageStates,
      'problem_definition',
      'Problem Definition changed. Review downstream assumptions before handoff.'
    )

    expect(nextStates.root_cause.memory?.staleReason).toContain('Problem Definition changed')
    expect(nextStates.root_cause.points.find((point) => point.key === 'root_drivers')?.status).toBe('needs_review')
  })

  it('backfills sentence facts from keyword-only captures during tidy fallback', async () => {
    const session = makeSession('expert')
    const stageState = {
      ...session.stageStates.problem_definition,
      points: session.stageStates.problem_definition.points.map((point) =>
        point.key === 'problem_core'
          ? {
              ...point,
              status: 'covered',
              capture: {
                keywords: ['rural diabetes adherence', 'missed follow-up'],
                thrustLinkage: [],
                factBullets: [],
                ruleNotes: [],
                confidence: 0.9,
                captureBasis: ['user_confirmed'],
                sourceTemplatePointer: null,
                ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
                updatedAt: '2026-06-11T00:00:00.000Z',
              },
            }
          : point
      ),
    } as any

    const tidied = await runGrantPrepStageTidyPass({
      stageKey: 'problem_definition',
      stageState,
      tenantContext: null,
    })
    const tidiedPoint = tidied.points.find((point) => point.key === 'problem_core')

    expect(tidiedPoint?.capture?.factBullets?.[0]).toContain('Core problem statement includes rural diabetes adherence')
    expect(tidiedPoint?.capture?.factBullets?.[0]).toMatch(/\.$/)
    expect(tidied.memory?.confirmedFacts.join(' ')).toContain('Core problem statement includes rural diabetes adherence')
  })
})

describe('grant prep progression by mode', () => {
  it('keeps generic placeholder captures in review for expert mode', () => {
    const session = makeSession('expert')

    const nextStates = applyMarkerToStageStates(
      session.stageStates,
      'problem_definition',
      {
        version: 'brainstorm_marker_v1',
        stageKey: 'problem_definition',
        qualityAssessment: 'adequate',
        pointsCovered: [
          {
            pointKey: 'problem_core',
            keywords: ['health burden'],
            factBullets: ['The problem is important.'],
            captureBasis: ['generic_placeholder'],
            ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
          },
        ],
        steeringEvents: [],
      },
      {
        engagementMode: 'expert',
        selectedThrustAreaRuleKeys: [],
        availableFocusAreas: [],
      }
    )

    const point = nextStates.problem_definition.points.find((entry) => entry.key === 'problem_core')
    expect(point?.status).toBe('needs_review')
  })

  it('keeps express behavior unchanged for generic placeholder captures', () => {
    const session = makeSession('express')

    const nextStates = applyMarkerToStageStates(
      session.stageStates,
      'problem_definition',
      {
        version: 'brainstorm_marker_v1',
        stageKey: 'problem_definition',
        qualityAssessment: 'adequate',
        pointsCovered: [
          {
            pointKey: 'problem_core',
            keywords: ['health burden'],
            factBullets: ['The problem is important.'],
            captureBasis: ['generic_placeholder'],
            ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
          },
        ],
        steeringEvents: [],
      },
      {
        engagementMode: 'express',
        selectedThrustAreaRuleKeys: [],
        availableFocusAreas: [],
      }
    )

    const point = nextStates.problem_definition.points.find((entry) => entry.key === 'problem_core')
    expect(point?.status).toBe('covered')
  })

  it('keeps newly updated priority captures in review when expert marks the stage weak', () => {
    const session = makeSession('expert')

    const nextStates = applyMarkerToStageStates(
      session.stageStates,
      'problem_definition',
      {
        version: 'brainstorm_marker_v1',
        stageKey: 'problem_definition',
        qualityAssessment: 'weak',
        pointsCovered: [
          {
            pointKey: 'problem_scale',
            keywords: ['high disease burden'],
            factBullets: ['The burden is significant in the target districts.'],
            captureBasis: ['user_confirmed'],
            ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
          },
        ],
        steeringEvents: [],
      },
      {
        engagementMode: 'expert',
        selectedThrustAreaRuleKeys: [],
        availableFocusAreas: [],
      }
    )

    const point = nextStates.problem_definition.points.find((entry) => entry.key === 'problem_scale')
    expect(point?.status).toBe('needs_review')
    expect(nextStates.problem_definition.status).toBe('needs_review')
  })

  it('blocks expert auto-advance and ready state when a stage needs review', () => {
    const reviewStage = {
      stageKey: 'problem_definition',
      title: 'Problem Definition',
      enabled: true,
      pickable: true,
      readiness: 0.8,
      status: 'needs_review',
      steeringEvents: [],
      points: [],
      lastUpdatedAt: null,
    } as any

    const stageStates = {
      problem_definition: reviewStage,
    } as any

    expect(canAutoAdvanceGrantPrepStage(reviewStage, 'express')).toBe(true)
    expect(canAutoAdvanceGrantPrepStage(reviewStage, 'expert')).toBe(false)
    expect(isGrantPrepSessionReady(stageStates, 'express')).toBe(true)
    expect(isGrantPrepSessionReady(stageStates, 'expert')).toBe(false)
  })

  it('ignores context-only template points when computing user-facing readiness', () => {
    const stage = {
      stageKey: 'root_cause',
      title: 'Root Cause',
      enabled: true,
      pickable: true,
      readiness: 0,
      status: 'in_progress',
      steeringEvents: [],
      lastUpdatedAt: null,
      points: [
        { key: 'root_drivers', label: 'Underlying drivers', priority: 'P1', conversationRole: 'user_required', status: 'covered', sourceTemplatePointer: null, capture: null },
        { key: 'current_failure', label: 'Why current approaches fall short', priority: 'P2', conversationRole: 'user_required', status: 'covered', sourceTemplatePointer: null, capture: null },
        { key: 'template_context_1', label: 'Template context 1', priority: 'P2', conversationRole: 'context_only', status: 'pending', sourceTemplatePointer: 'sections.problem', capture: null },
        { key: 'template_context_2', label: 'Template context 2', priority: 'P2', conversationRole: 'context_only', status: 'pending', sourceTemplatePointer: 'questions.background', capture: null },
      ],
    } as any

    expect(computeStageReadiness(stage)).toBeCloseTo(0.85)
  })

  it('parses cross-stage captures and coverage metadata from the marker', () => {
    const parsed = parseGrantPrepResponse([
      'Assistant prose.',
      '<grant_prep_marker>{"version":"brainstorm_marker_v1","stageKey":"problem_definition","pointsCovered":[],"crossStagePointsCovered":[{"stageKey":"beneficiaries","pointKey":"direct_beneficiaries","keywords":["rural patients"],"factBullets":["Rural patients are the direct beneficiary group."],"confidence":0.9,"captureBasis":["user_confirmed"],"ruleCompliance":{"status":"ok","reason":null,"rescopeNeeded":false}}],"suggestedAnswers":[{"label":"A","text":"We focus on rural patients.","coverageSummary":"Problem + Beneficiaries","covers":[{"stageKey":"beneficiaries","pointKey":"direct_beneficiaries","label":"Direct beneficiaries"}]}],"steeringEvents":[]}</grant_prep_marker>',
    ].join('\n'))

    expect(parsed.marker?.crossStagePointsCovered?.[0]?.stageKey).toBe('beneficiaries')
    expect(parsed.marker?.suggestedAnswers?.[0]?.coverageSummary).toBe('Problem + Beneficiaries')
    expect(parsed.marker?.suggestedAnswers?.[0]?.covers?.[0]?.label).toBe('Direct beneficiaries')
  })

  it('preserves inline option C when the structured marker only has A and B', () => {
    const repeatedPrefix = `I approve this ${'bundle'}:`;
    const merged = mergeGrantPrepSuggestedAnswersWithInline(
      [
        { label: 'A', text: `${repeatedPrefix} Use the community clinic delivery model.`, rationale: null },
        { label: 'B', text: 'Use the mobile outreach delivery model.', rationale: null },
      ],
      [
        'Which implementation bundle should I use?',
        '',
        'A. Use the community clinic delivery model.',
        'B. Use the mobile outreach delivery model.',
        'C. Use a hybrid model with clinic anchors and scheduled outreach camps.',
      ].join('\n')
    )

    expect(merged.map((answer) => answer.label)).toEqual(['A', 'B', 'C'])
    expect(merged[0].text).toBe('Use the community clinic delivery model.')
    expect(merged[2].text).toBe('Use a hybrid model with clinic anchors and scheduled outreach camps.')
  })

  it('uses fuller inline direction text when structured ideation answers are shorter', () => {
    const merged = mergeGrantPrepSuggestedAnswersWithInline(
      [
        { label: 'A', text: 'Short marker privacy direction.', rationale: 'Increases ethical appeal.' },
        { label: 'B', text: 'Short marker precision health direction.', rationale: 'Enhances clinical value.' },
        { label: 'C', text: 'Short marker caregiver direction.', rationale: 'Improves support utility.' },
      ],
      [
        'Here are three exploratory directions to refine the strategic angle:',
        'Direction A: The "Privacy-First" Angle. Focus the project on edge computing, where the AI processes environmental data locally on the smartphone without uploading audio or sensitive data to the cloud. This addresses a major ethical hurdle in health tech.',
        'Direction B: The "Precision Health" Angle. Focus the 12-month project on building personal sensory profiles. Instead of a universal alert, the AI learns which specific noise frequencies or light patterns trigger a specific individual.',
        'Direction C: The "Caregiver Dashboard" Angle. Focus on the visualization of correlated data for clinicians or parents, helping caregivers understand the why behind a meltdown by showing environmental triggers alongside heart rate spikes.',
        'Would you like to explore one of these directions further, or are you ready to lock in this angle?',
      ].join('\n')
    )

    expect(merged.map((answer) => answer.label)).toEqual(['A', 'B', 'C'])
    expect(merged[0].text).toContain('processes environmental data locally')
    expect(merged[0].text).not.toContain('Short marker privacy direction')
    expect(merged[0].rationale).toBe('Increases ethical appeal.')
    expect(merged[2].text).toContain('helping caregivers understand the why')
    expect(merged[2].text).not.toContain('Would you like')
  })

  it('parses three inline options across common label formats', () => {
    const cases = [
      'A) Use clinic delivery.\nB) Use outreach delivery.\nC) Use a hybrid delivery model.',
      'Option A: Use clinic delivery.\nOption B: Use outreach delivery.\nOption C: Use a hybrid delivery model.',
      'Direction A: Use clinic delivery.\nDirection B: Use outreach delivery.\nDirection C: Use a hybrid delivery model.',
      'A - Use clinic delivery.\nB - Use outreach delivery.\nC - Use a hybrid delivery model.',
      'Which model fits? A. Use clinic delivery. B. Use outreach delivery. C. Use a hybrid delivery model.',
    ]

    for (const content of cases) {
      const merged = mergeGrantPrepSuggestedAnswersWithInline([], content)
      expect(merged.map((answer) => answer.label)).toEqual(['A', 'B', 'C'])
      expect(merged[2].text).toBe('Use a hybrid delivery model.')
    }
  })

  it('applies high-confidence cross-stage captures as covered', () => {
    const session = makeSession('express')

    const nextStates = applyCrossStageMarkerToStageStates(
      session.stageStates,
      {
        version: 'brainstorm_marker_v1',
        stageKey: 'problem_definition',
        pointsCovered: [],
        crossStagePointsCovered: [
          {
            stageKey: 'beneficiaries',
            pointKey: 'direct_beneficiaries',
            keywords: ['rural patients'],
            factBullets: ['Rural patients are the direct beneficiary group.'],
            confidence: 0.9,
            captureBasis: ['user_confirmed'],
            ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
          },
        ],
        steeringEvents: [],
      },
      {
        engagementMode: 'express',
        selectedThrustAreaRuleKeys: [],
        availableFocusAreas: [],
      }
    )

    const point = nextStates.beneficiaries.points.find((entry) => entry.key === 'direct_beneficiaries')
    expect(point?.status).toBe('covered')
  })

  it('keeps low-confidence cross-stage captures in review', () => {
    const session = makeSession('express')

    const nextStates = applyCrossStageMarkerToStageStates(
      session.stageStates,
      {
        version: 'brainstorm_marker_v1',
        stageKey: 'problem_definition',
        pointsCovered: [],
        crossStagePointsCovered: [
          {
            stageKey: 'beneficiaries',
            pointKey: 'direct_beneficiaries',
            keywords: ['community'],
            factBullets: ['The community may benefit.'],
            confidence: 0.6,
            captureBasis: ['inferred_from_call'],
            ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
          },
        ],
        steeringEvents: [],
      },
      {
        engagementMode: 'express',
        selectedThrustAreaRuleKeys: [],
        availableFocusAreas: [],
      }
    )

    const point = nextStates.beneficiaries.points.find((entry) => entry.key === 'direct_beneficiaries')
    expect(point?.status).toBe('needs_review')
  })

  it('ignores cross-stage captures outside the planned lookahead allow-list', () => {
    const session = makeSession('express')

    const nextStates = applyCrossStageMarkerToStageStates(
      session.stageStates,
      {
        version: 'brainstorm_marker_v1',
        stageKey: 'problem_definition',
        pointsCovered: [],
        crossStagePointsCovered: [
          {
            stageKey: 'beneficiaries',
            pointKey: 'direct_beneficiaries',
            keywords: ['rural patients'],
            factBullets: ['Rural patients are the direct beneficiary group.'],
            confidence: 0.95,
            captureBasis: ['user_confirmed'],
            ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
          },
        ],
        steeringEvents: [],
      },
      {
        engagementMode: 'express',
        selectedThrustAreaRuleKeys: [],
        availableFocusAreas: [],
        allowedCrossStagePointKeys: ['methodology.approach_summary'],
      }
    )

    const point = nextStates.beneficiaries.points.find((entry) => entry.key === 'direct_beneficiaries')
    expect(point?.status).toBe('pending')
    expect(point?.capture).toBeNull()
  })

  it('builds a dedicated ideation prompt with selected priority areas and existing marker fields', () => {
    const session = {
      ...makeSession('expert'),
      selectedThrustAreaRuleKeys: ['implementation science'],
    }

    const prompt = buildIdeationPrompt({
      session,
      stageKey: 'ideation',
      project: {
        title: 'Rural Diabetes Adherence',
        description: null,
      },
      fundingContext: makeFundingContext(),
      guidelinePack: null,
      conversation: [],
      userMessage: 'We want to design a rural clinic adherence project.',
    })

    expect(prompt).toContain('Available call priority areas: public health, implementation science')
    expect(prompt).toContain('User-selected target priority areas: implementation science')
    expect(prompt).toContain('Funding agency alignment rules:')
    expect(prompt).toContain('Return exactly 3 directions with labels A, B, and C.')
    expect(prompt).toContain('Fits this call because')
    expect(prompt).toContain('"suggestedAnswers"')
    expect(prompt).toContain('"pointsCovered"')
    expect(prompt).not.toMatch(/approval[- ]bundle/i)
    expect(prompt).not.toMatch(/crossStagePointsCovered|cross-stage/i)
    expect(prompt).not.toMatch(/template/i)
    expect(prompt).not.toMatch(/"directions"|"ideaDiagnostic"/)
  })
})

describe('grant prep priority areas', () => {
  it('dedupes options and prefers disciplines over focus areas', () => {
    const options = deriveGrantPrepPriorityAreaOptions({
      disciplines: ['Economic', 'economic', 'Sustainability'],
      focusAreas: ['Health', 'Research Grant'],
    })

    expect(options).toEqual(['Economic', 'Sustainability'])
  })

  it('normalizes selected priority areas to available call labels', () => {
    const result = normalizeGrantPrepPriorityAreaSelection({
      selectedPriorityAreas: ['economic', 'unknown'],
      availablePriorityAreas: ['Economic', 'Sustainability'],
    })

    expect(result.selectedPriorityAreas).toEqual(['Economic'])
    expect(result.invalidPriorityAreas).toEqual(['unknown'])
  })
})

describe('grant prep conversation bundle planning', () => {
  it('prioritizes paired-stage targets before generic lookahead', () => {
    const session = makeSession('expert')
    const bundle = buildGrantPrepConversationBundle({
      session,
      stageKey: 'problem_definition',
      latestUserMessage: 'The problem is medication adherence in rural clinics.',
    })

    expect(bundle.primary?.stageKey).toBe('problem_definition')
    expect(bundle.paired.map((point) => point.stageKey)).toContain('root_cause')
    expect(bundle.lookahead.map((point) => point.stageKey)).not.toContain('root_cause')
    expect(getGrantPrepCrossStageAllowedPointKeys(bundle)).toContain('root_cause.root_drivers')
  })

  it('only pairs budget with sustainability when the user gives a relevant signal', () => {
    const session = makeSession('expert')
    const withoutSignal = buildGrantPrepConversationBundle({
      session,
      stageKey: 'budget_strategy',
      latestUserMessage: 'The main cost categories are staff and field travel.',
    })
    const withSignal = buildGrantPrepConversationBundle({
      session,
      stageKey: 'budget_strategy',
      latestUserMessage: 'We need a future funding and continuity plan after the grant.',
    })

    expect(withoutSignal.paired.map((point) => point.stageKey)).not.toContain('innovation')
    expect(withSignal.paired.map((point) => point.stageKey)).toContain('innovation')
  })
})
