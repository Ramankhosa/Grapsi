import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getReviewerSessionMock,
  requireReviewerCallAccessMock,
  createStandaloneReviewerCallMock,
  prismaMock,
  axiosMock,
} = vi.hoisted(() => ({
  getReviewerSessionMock: vi.fn(),
  requireReviewerCallAccessMock: vi.fn(),
  createStandaloneReviewerCallMock: vi.fn(),
  prismaMock: {
    fundingCall: {
      findFirst: vi.fn(),
    },
    reviewerCall: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    reviewerSection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    reviewAssetLink: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
  axiosMock: {
    get: vi.fn(),
    post: vi.fn(),
    head: vi.fn(),
    isAxiosError: vi.fn(),
  },
}))

vi.mock('@/lib/reviewer-auth-api', () => ({
  getReviewerSession: getReviewerSessionMock,
  requireReviewerCallAccess: requireReviewerCallAccessMock,
}))

vi.mock('@/lib/reviewer/template-bridge', () => ({
  createStandaloneReviewerCall: createStandaloneReviewerCallMock,
}))

vi.mock('../../../lib/prisma', () => ({
  default: prismaMock,
  prisma: prismaMock,
}))

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
  prisma: prismaMock,
}))

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
}))

function createMockRes() {
  const res: any = {
    headers: {},
    statusCode: undefined,
    body: undefined,
  }
  res.status = vi.fn((statusCode: number) => {
    res.statusCode = statusCode
    return res
  })
  res.json = vi.fn((body: unknown) => {
    res.body = body
    return res
  })
  res.setHeader = vi.fn((name: string, value: unknown) => {
    res.headers[name] = value
    return res
  })
  return res
}

describe('imported reviewer flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getReviewerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    requireReviewerCallAccessMock.mockResolvedValue({ id: 'call-1', user_id: 'user-1' })
  })

  it('creates standalone reviewer calls from an approved funding template', async () => {
    const { default: callsHandler } = await import(
      '../../../pages/api/reviewer/calls/index'
    )

    getReviewerSessionMock.mockResolvedValue({ user: { id: 'user-1', tenantId: 'tenant-1' } })
    prismaMock.fundingCall.findFirst.mockResolvedValue({ id: 'funding-1' })
    createStandaloneReviewerCallMock.mockResolvedValue({
      id: 'reviewer-call-1',
      fundingCallId: 'funding-1',
      call_input_type: 'template',
    })
    const res = createMockRes()
    await callsHandler(
      {
        method: 'POST',
        body: {
          project_title: 'Project',
          fundingCallId: 'funding-1',
          manualRubric: { evaluationCriteria: ['Fit'] },
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.body.call.id).toBe('reviewer-call-1')
    expect(createStandaloneReviewerCallMock).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      fundingCallId: 'funding-1',
      projectTitle: 'Project',
      manualRubric: { evaluationCriteria: ['Fit'] },
      seedSections: false,
    })
  })

  it('increments section versions for duplicate section titles', async () => {
    const { default: sectionsHandler } = await import(
      '../../../pages/api/reviewer/calls/[id]/sections/index'
    )

    prismaMock.reviewerCall.findUnique.mockResolvedValue({ user_id: 'user-1' })
    prismaMock.reviewerSection.findFirst.mockResolvedValue({ version: 2 })
    prismaMock.reviewerSection.create.mockImplementation(async ({ data }) => ({
      id: 'section-3',
      section_title: data.section_title,
      version: data.version,
    }))

    const res = createMockRes()
    await sectionsHandler(
      {
        method: 'POST',
        query: { id: 'call-1' },
        body: {
          section_title: 'Methodology',
          user_input: 'Updated section text',
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.body.section).toEqual({
      id: 'section-3',
      section_title: 'Methodology',
      version: 3,
    })
    expect(prismaMock.reviewerSection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 3,
          is_revision: false,
        }),
      })
    )
  })

  it('copies revision assets while enforcing the donor max-3 per section type rule', async () => {
    const { default: sectionsHandler } = await import(
      '../../../pages/api/reviewer/calls/[id]/sections/index'
    )

    prismaMock.reviewerCall.findUnique.mockResolvedValue({ user_id: 'user-1' })
    prismaMock.reviewerSection.findUnique.mockResolvedValue({ version: 4 })
    prismaMock.reviewerSection.create.mockImplementation(async ({ data }) => ({
      id: 'section-5',
      section_title: data.section_title,
      version: data.version,
    }))
    prismaMock.reviewAssetLink.findMany.mockResolvedValue([
      { section_type: 'METHODOLOGY', asset_id: 'a1', order: 0 },
      { section_type: 'METHODOLOGY', asset_id: 'a2', order: 1 },
      { section_type: 'METHODOLOGY', asset_id: 'a3', order: 2 },
      { section_type: 'METHODOLOGY', asset_id: 'a4', order: 3 },
      { section_type: 'TIMELINE', asset_id: 't1', order: 4 },
    ])
    prismaMock.reviewAssetLink.create.mockResolvedValue({})

    const res = createMockRes()
    await sectionsHandler(
      {
        method: 'POST',
        query: { id: 'call-1' },
        body: {
          section_title: 'Methodology',
          user_input: 'Revision text',
          previous_section_id: 'section-4',
          is_revision: true,
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(201)
    expect(prismaMock.reviewerSection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 5,
          previous_section_id: 'section-4',
          is_revision: true,
        }),
      })
    )
    expect(prismaMock.reviewAssetLink.create).toHaveBeenCalledTimes(4)
    expect(prismaMock.reviewAssetLink.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ asset_id: 'a4' }),
      })
    )
  })
})
