import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authenticateUserMock = vi.fn()
const getDraftingSessionForUserMock = vi.fn()
const getBackgroundGenStatusMock = vi.fn()
const getPass1SectionEligibilityMock = vi.fn()
const runParallelPass1Mock = vi.fn()
const extractTenantContextFromRequestMock = vi.fn()

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: authenticateUserMock,
}))

vi.mock('@/lib/grants/shadowSessionAccess', () => ({
  getDraftingSessionForUser: getDraftingSessionForUserMock,
}))

vi.mock('@/lib/services/paper-section-service', () => ({
  paperSectionService: {
    getBackgroundGenStatus: getBackgroundGenStatusMock,
    getPass1SectionEligibility: getPass1SectionEligibilityMock,
    runParallelPass1: runParallelPass1Mock,
  },
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: () => true,
}))

vi.mock('@/lib/metering/auth-bridge', () => ({
  extractTenantContextFromRequest: extractTenantContextFromRequestMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
    },
  },
}))

describe('grant sections prepare route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    authenticateUserMock.mockResolvedValue({
      user: { id: 'user-1', tenantId: 'tenant-1' },
      error: null,
    })
    getDraftingSessionForUserMock.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      bgGenStatus: 'IDLE',
      paperType: { code: 'GRANT_TEMPLATE::rev1' },
      paperBlueprint: { paperTypeCode: 'GRANT_TEMPLATE::rev1' },
    })
    extractTenantContextFromRequestMock.mockResolvedValue({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      tenantStatus: 'ACTIVE',
      userId: 'user-1',
    })
    runParallelPass1Mock.mockResolvedValue({
      success: false,
      progress: { total: 0, completed: 0, failed: 0, sections: {} },
      error: 'No sections in blueprint are eligible for Generate Draft',
    })
  })

  it('returns success for POST when a grant session has zero eligible background sections', async () => {
    getPass1SectionEligibilityMock.mockResolvedValue({
      paperTypeCode: 'GRANT_TEMPLATE::rev1',
      eligibleSections: [],
      skippedSections: [{ sectionKey: 'methodology', displayLabel: 'Methodology', mode: 'one_pass', reason: 'single-pass' }],
    })

    const { POST } = await import('@/app/api/papers/[paperId]/sections/prepare/route')
    const request = new NextRequest('http://localhost/api/papers/session-1/sections/prepare', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: { paperId: 'session-1' } })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.status).toBe('COMPLETED')
    expect(payload.eligibleSections).toEqual([])
    expect(payload.hint).toContain('single-pass')
    expect(runParallelPass1Mock).not.toHaveBeenCalled()
  })

  it('returns success for GET when a grant session has zero eligible background sections', async () => {
    getBackgroundGenStatusMock.mockResolvedValue({
      status: 'IDLE',
      progress: null,
      startedAt: null,
      completedAt: null,
      eligibleSections: [],
      skippedSections: [{ sectionKey: 'methodology', displayLabel: 'Methodology', mode: 'one_pass', reason: 'single-pass' }],
      paperTypeCode: 'GRANT_TEMPLATE::rev1',
    })

    const { GET } = await import('@/app/api/papers/[paperId]/sections/prepare/route')
    const request = new NextRequest('http://localhost/api/papers/session-1/sections/prepare', {
      method: 'GET',
      headers: { authorization: 'Bearer test-token' },
    })

    const response = await GET(request, { params: { paperId: 'session-1' } })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.status).toBe('COMPLETED')
    expect(payload.eligibleSections).toEqual([])
  })
})
