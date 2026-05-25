import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildInitialStageStates, buildGrantPrepSessionContext } from '@/lib/grantPrep/sessionState'
import { buildGrantPrepStageMapping } from '@/lib/grantPrep/templateMapper'

const mocks = vi.hoisted(() => ({
  requireGrantPrepActor: vi.fn(),
  assertGrantPrepProjectCapability: vi.fn(),
  generateGrantPrepText: vi.fn(),
  resolveGrantPrepTenantContext: vi.fn(),
  loadGrantPrepSession: vi.fn(),
  resolveGrantPrepContext: vi.fn(),
  grantPrepMessageCreate: vi.fn(),
  grantPrepSessionUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    grantPrepMessage: {
      create: mocks.grantPrepMessageCreate,
    },
    grantPrepSession: {
      update: mocks.grantPrepSessionUpdate,
    },
  },
}))

vi.mock('@/lib/grantPrep/access', () => ({
  requireGrantPrepActor: mocks.requireGrantPrepActor,
  assertGrantPrepProjectCapability: mocks.assertGrantPrepProjectCapability,
}))

vi.mock('@/lib/grantPrep/llm', () => ({
  generateGrantPrepText: mocks.generateGrantPrepText,
  resolveGrantPrepTenantContext: mocks.resolveGrantPrepTenantContext,
}))

vi.mock('@/lib/grantPrep/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/grantPrep/server')>('@/lib/grantPrep/server')
  return {
    ...actual,
    loadGrantPrepSession: mocks.loadGrantPrepSession,
    resolveGrantPrepContext: mocks.resolveGrantPrepContext,
  }
})

function makeGrantPrepSessionRecord() {
  const stageMapping = buildGrantPrepStageMapping(null)
  const stageStates = buildInitialStageStates(stageMapping)
  const context = buildGrantPrepSessionContext({
    mode: 'template_driven',
    engagementMode: 'expert',
    stageMapping,
    stageStates,
  })

  return {
    id: 'prep-session-1',
    project_id: 'project-1',
    grant_session_id: 'grant-session-1',
    funding_call_id: 'funding-call-1',
    status: 'active',
    template_revision_id: 'template-rev-1',
    guideline_revision_id: 'guideline-rev-1',
    messages: [],
    project: {
      name: 'Rural Diabetes Adherence',
    },
    overall_readiness: 0,
    mode: context.mode,
    engagement_mode: context.engagementMode,
    stage_selection_version: context.stageSelectionVersion,
    auto_enabled_stage_keys: context.autoEnabledStageKeys,
    manual_enabled_stage_keys: context.manualEnabledStageKeys,
    manual_disabled_stage_keys: context.manualDisabledStageKeys,
    active_stage_key: context.activeStageKey,
    selected_thrust_area_rule_keys: context.selectedThrustAreaRuleKeys,
    enabled_stage_keys: context.enabledStageKeys,
    disabled_stage_keys: context.disabledStageKeys,
    stage_mapping_json: context.stageMapping,
    stage_states_json: context.stageStates,
    global_keywords_json: context.globalKeywords,
  }
}

describe('grant prep message route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.requireGrantPrepActor.mockResolvedValue({
      actor: {
        id: 'user-1',
        tenantId: 'tenant-1',
      },
    })
    mocks.assertGrantPrepProjectCapability.mockResolvedValue(null)
    mocks.resolveGrantPrepTenantContext.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    mocks.loadGrantPrepSession.mockResolvedValue(makeGrantPrepSessionRecord())
    mocks.resolveGrantPrepContext.mockResolvedValue({
      mode: 'template_driven',
      templateRevisionId: 'template-rev-1',
      guidelineRevisionId: 'guideline-rev-1',
      fundingContext: {
        title: 'National Health Translation Call',
        agencyName: 'ICMR',
        deadline: '2026-08-15',
        funding: 'INR 500 lakh',
        projectDuration: '36 months',
        eligibility: 'Academic and clinical institutions',
        focusAreas: ['public health'],
        warning: null,
        budgetLimits: null,
      },
      draftingContext: {
        approvedTemplate: null,
        approvedGuidelineRevision: null,
      },
    })
    mocks.grantPrepSessionUpdate.mockResolvedValue({})
    mocks.grantPrepMessageCreate.mockImplementation(async ({ data }) => ({
      id: `${data.role}-message-1`,
      ...data,
    }))
  })

  it('returns option C when the marker only included A and B but prose included C', async () => {
    mocks.generateGrantPrepText.mockResolvedValue([
      'This narrows the implementation choice and keeps the reviewer focused.',
      '',
      'Which implementation bundle should I use?',
      'A. Use the community clinic delivery model.',
      'B. Use the mobile outreach delivery model.',
      'C. Use a hybrid model with clinic anchors and scheduled outreach camps.',
      '<grant_prep_marker>{"version":"brainstorm_marker_v1","stageKey":"problem_definition","pointsCovered":[],"currentPoint":"problem_core","suggestedAnswers":[{"label":"A","text":"Use the community clinic delivery model.","coverageSummary":"Implementation model","covers":[{"stageKey":"problem_definition","pointKey":"problem_core","label":"Core problem statement"}]},{"label":"B","text":"Use the mobile outreach delivery model.","coverageSummary":"Implementation model","covers":[{"stageKey":"problem_definition","pointKey":"problem_core","label":"Core problem statement"}]}],"qualityAssessment":"adequate","steeringEvents":[]}</grant_prep_marker>',
    ].join('\n'))

    const { POST } = await import('@/app/api/grant-prep/sessions/[id]/message/route')
    const request = new NextRequest('http://localhost/api/grant-prep/sessions/prep-session-1/message', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Help me decide the implementation model.',
        clientMessageId: 'client-message-1',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: 'prep-session-1' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.message.suggested_answers.map((answer: { label: string }) => answer.label)).toEqual(['A', 'B', 'C'])
    expect(payload.message.suggested_answers[2].text).toBe(
      'Use a hybrid model with clinic anchors and scheduled outreach camps.'
    )
  })
})
