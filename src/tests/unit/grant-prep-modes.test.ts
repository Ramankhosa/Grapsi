import { describe, expect, it } from 'vitest'

import { buildGrantPrepPrompt } from '@/lib/grantPrep/promptComposer'
import {
  applyMarkerToStageStates,
  buildGrantPrepSessionContext,
  buildInitialStageStates,
  canAutoAdvanceGrantPrepStage,
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
})
