import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireFundingActor: vi.fn(),
  buildFundingCallAccessWhere: vi.fn(),
  enforceServiceAccess: vi.fn(),
  createOrReuseGrantPrepSession: vi.fn(),
  fundingCallFindFirst: vi.fn(),
  projectCreate: vi.fn(),
  projectDelete: vi.fn(),
}))

vi.mock('@/lib/funding/access', () => ({
  requireFundingActor: mocks.requireFundingActor,
}))

vi.mock('@/lib/fundingIntake/routeAuth', () => ({
  buildFundingCallAccessWhere: mocks.buildFundingCallAccessWhere,
}))

vi.mock('@/lib/service-access-middleware', () => ({
  enforceServiceAccess: mocks.enforceServiceAccess,
}))

vi.mock('@/lib/grantPrep/server', () => ({
  createOrReuseGrantPrepSession: mocks.createOrReuseGrantPrepSession,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fundingCall: {
      findFirst: mocks.fundingCallFindFirst,
    },
    project: {
      create: mocks.projectCreate,
      delete: mocks.projectDelete,
    },
  },
}))

describe('funding call start-grant-prep route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.requireFundingActor.mockResolvedValue({
      actor: {
        id: 'user-1',
        email: 'user@example.org',
        tenantId: 'tenant-1',
      },
    })
    mocks.buildFundingCallAccessWhere.mockReturnValue({})
    mocks.enforceServiceAccess.mockResolvedValue({ allowed: true })
    mocks.fundingCallFindFirst.mockResolvedValue({
      id: 'call-1',
      scheme_title: 'Economic Transition Call',
      title: null,
    })
    mocks.projectCreate.mockResolvedValue({
      id: 'project-1',
      name: 'Grant: Economic Transition Call',
      projectType: 'GRANT',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    mocks.projectDelete.mockResolvedValue({})
    mocks.createOrReuseGrantPrepSession.mockResolvedValue({
      session: { id: 'prep-1' },
      grantSessionId: 'grant-1',
      launchUrl: '/projects/project-1/grants/grant-1/workspace?stage=GRANTMENTOR',
      prepUrl: '/projects/project-1/grants/prep-1/prep',
    })
  })

  it('persists selected priority areas through the existing storage field', async () => {
    const { POST } = await import('@/app/api/funding/calls/[callId]/start-grant-prep/route')
    const request = new NextRequest('http://localhost/api/funding/calls/call-1/start-grant-prep', {
      method: 'POST',
      body: JSON.stringify({
        engagementMode: 'expert',
        selectedPriorityAreas: ['Economic', 'Sustainability'],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, {
      params: Promise.resolve({ callId: 'call-1' }),
    })

    expect(response.status).toBe(201)
    expect(mocks.createOrReuseGrantPrepSession).toHaveBeenCalledWith(
      expect.objectContaining({
        fundingCallId: 'call-1',
        selectedThrustAreaRuleKeys: ['Economic', 'Sustainability'],
      })
    )
  })
})
