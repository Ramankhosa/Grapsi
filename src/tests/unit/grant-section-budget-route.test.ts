import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireProjectGrantActorMock = vi.fn()
const generateGrantSectionDraftMock = vi.fn()
const saveGrantSectionDraftMock = vi.fn()
const getGrantWorkspaceMock = vi.fn()
const reserveServiceUsageMock = vi.fn()
const trackServiceUsageMock = vi.fn()
const releaseReservedServiceUsageMock = vi.fn()

vi.mock('@/lib/grants/access', () => ({
  requireProjectGrantActor: requireProjectGrantActorMock,
}))

vi.mock('@/lib/grants/drafting', () => ({
  generateGrantSectionDraft: generateGrantSectionDraftMock,
  saveGrantSectionDraft: saveGrantSectionDraftMock,
}))

vi.mock('@/lib/grants/workspace', () => ({
  getGrantWorkspace: getGrantWorkspaceMock,
}))

vi.mock('@/lib/service-usage-tracker', () => ({
  reserveServiceUsage: reserveServiceUsageMock,
  trackServiceUsage: trackServiceUsageMock,
  releaseReservedServiceUsage: releaseReservedServiceUsageMock,
  ServiceQuotaExceededError: class ServiceQuotaExceededError extends Error {},
}))

describe('grant section budget generation route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    requireProjectGrantActorMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      roles: [],
      tenantId: 'tenant-1',
    })
    reserveServiceUsageMock.mockResolvedValue(undefined)
    trackServiceUsageMock.mockResolvedValue(undefined)
    releaseReservedServiceUsageMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates structured budget sections through POST', async () => {
    generateGrantSectionDraftMock.mockResolvedValue({
      sectionKey: 'budget',
      sectionType: 'budget_rows',
    })

    const { POST } = await import('@/app/api/projects/[projectId]/grants/[grantId]/sections/[sectionKey]/route')
    const request = new NextRequest('http://localhost/api/projects/project-1/grants/grant-1/sections/budget', {
      method: 'POST',
      body: JSON.stringify({
        action: 'generate',
        userInstructions: 'Use entered costs only.',
        allowInstructionAmounts: true,
        overwriteAmounts: false,
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, {
      params: Promise.resolve({ projectId: 'project-1', grantId: 'grant-1', sectionKey: 'budget' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.section).toMatchObject({ sectionKey: 'budget', sectionType: 'budget_rows' })
    expect(generateGrantSectionDraftMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      grantSessionId: 'grant-1',
      tenantId: 'tenant-1',
      sectionKey: 'budget',
      userId: 'user-1',
      userInstructions: 'Use entered costs only.',
      allowInstructionAmounts: true,
      overwriteAmounts: false,
    })
  })

  it('keeps app-draft section generation blocked for the linked literature workspace', async () => {
    generateGrantSectionDraftMock.mockRejectedValue(
      new Error('App draft sections are generated in the linked literature workspace.')
    )

    const { POST } = await import('@/app/api/projects/[projectId]/grants/[grantId]/sections/[sectionKey]/route')
    const request = new NextRequest('http://localhost/api/projects/project-1/grants/grant-1/sections/objectives', {
      method: 'POST',
      body: JSON.stringify({ action: 'generate' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, {
      params: Promise.resolve({ projectId: 'project-1', grantId: 'grant-1', sectionKey: 'objectives' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.message).toContain('linked literature workspace')
  })

  it('returns 404 when POST generation crosses the project boundary', async () => {
    generateGrantSectionDraftMock.mockRejectedValue(new Error('Grant workspace not found'))

    const { POST } = await import('@/app/api/projects/[projectId]/grants/[grantId]/sections/[sectionKey]/route')
    const request = new NextRequest('http://localhost/api/projects/project-1/grants/grant-1/sections/budget', {
      method: 'POST',
      body: JSON.stringify({ action: 'generate' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, {
      params: Promise.resolve({ projectId: 'project-1', grantId: 'grant-1', sectionKey: 'budget' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.message).toContain('Grant workspace not found')
  })

  it('passes projectId into PATCH saves and returns 404 for boundary mismatches', async () => {
    saveGrantSectionDraftMock.mockResolvedValueOnce({
      sectionKey: 'budget',
      sectionType: 'budget_rows',
    })

    const { PATCH } = await import('@/app/api/projects/[projectId]/grants/[grantId]/sections/[sectionKey]/route')
    const saveRequest = new NextRequest('http://localhost/api/projects/project-1/grants/grant-1/sections/budget', {
      method: 'PATCH',
      body: JSON.stringify({ structuredData: { rows: [] }, markReviewed: false }),
      headers: { 'content-type': 'application/json' },
    })
    const saveResponse = await PATCH(saveRequest, {
      params: Promise.resolve({ projectId: 'project-1', grantId: 'grant-1', sectionKey: 'budget' }),
    })

    expect(saveResponse.status).toBe(200)
    expect(saveGrantSectionDraftMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      grantSessionId: 'grant-1',
      tenantId: 'tenant-1',
      sectionKey: 'budget',
      userId: 'user-1',
      content: undefined,
      structuredData: { rows: [] },
      markReviewed: false,
    })

    saveGrantSectionDraftMock.mockRejectedValueOnce(new Error('Grant workspace not found'))
    const mismatchRequest = new NextRequest('http://localhost/api/projects/project-1/grants/grant-other/sections/budget', {
      method: 'PATCH',
      body: JSON.stringify({ structuredData: { rows: [] } }),
      headers: { 'content-type': 'application/json' },
    })
    const mismatchResponse = await PATCH(mismatchRequest, {
      params: Promise.resolve({ projectId: 'project-1', grantId: 'grant-other', sectionKey: 'budget' }),
    })
    const payload = await mismatchResponse.json()

    expect(mismatchResponse.status).toBe(404)
    expect(payload.message).toContain('Grant workspace not found')
  })
})
