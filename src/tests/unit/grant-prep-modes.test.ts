import { describe, expect, it } from 'vitest'

import { buildGrantPrepPrompt } from '@/lib/grantPrep/promptComposer'
import { parseGrantPrepResponse } from '@/lib/grantPrep/marker'
import {
  applyCrossStageMarkerToStageStates,
  applyMarkerToStageStates,
  buildGrantPrepSessionContext,
  buildInitialStageStates,
  canAutoAdvanceGrantPrepStage,
  computeStageReadiness,
  isGrantPrepSessionReady,
} from '@/lib/grantPrep/sessionState'
import { buildGrantPrepStageMapping } from '@/lib/grantPrep/templateMapper'

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
    warning: null,
  } as any
}

describe('grant prep prompt modes', () => {
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
})
