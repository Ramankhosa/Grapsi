import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    post: postMock,
  },
}))

import { createPapsiGrantSession } from '@/lib/grantPrep/handoff/papsiClient'

describe('grant prep papsi client', () => {
  beforeEach(() => {
    postMock.mockReset()
    postMock.mockResolvedValue({
      data: {
        grant_session_id: 'grant_session_1',
        launch_token: 'launch_token',
        launch_url: 'https://example.org/workspace',
        status: 'created',
      },
    })
    process.env.PAPSI_BASE_URL = 'https://example.org'
    process.env.PAPSI_GRANT_INTEGRATION_SECRET = 'secret'
  })

  it('omits engagementMode from the outbound guideline snapshot', async () => {
    await createPapsiGrantSession({
      externalSessionId: 'prep_session_1',
      externalProjectId: 'project_1',
      externalUser: {
        external_user_id: 'user_1',
        email: 'user@example.org',
        name: 'User',
      },
      payload: {
        version: 'grant_handoff_v1',
        frozenAt: '2026-04-22T00:00:00.000Z',
        project: {
          id: 'project_1',
          title: 'Reviewer Ready Proposal',
          description: null,
        },
        fundingCall: {
          id: 'call_1',
          title: 'National Health Translation Call',
          agencyName: 'ICMR',
          deadline: '2026-08-15',
          funding: 'INR 500 lakh',
          projectDuration: '36 months',
          eligibility: 'Academic and clinical institutions',
          deliverables: 'Pilot outputs',
          focusAreas: ['public health'],
          officialUrls: ['https://example.org/call'],
          warning: null,
        },
        guidance: {
          mode: 'template_driven',
          engagementMode: 'expert',
          guidelineRevisionId: 'guideline_rev_1',
          templateRevisionId: 'template_rev_1',
          selectedThrustAreaRuleKeys: [],
        },
        stageMapping: {} as any,
        stageStates: {} as any,
        globalKeywords: [],
        globalCaptureSummary: [],
        prepEvidence: [],
        prepEvidenceBySection: {},
        blockers: [],
      },
      payloadHash: 'hash_1',
    })

    const requestBody = postMock.mock.calls[0]?.[1]
    expect(requestBody.guideline_snapshot.mode).toBe('template_driven')
    expect(requestBody.guideline_snapshot.engagementMode).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(requestBody.guideline_snapshot, 'engagementMode')).toBe(false)
  })
})
