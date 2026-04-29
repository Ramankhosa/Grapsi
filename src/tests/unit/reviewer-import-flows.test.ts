import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getReviewerSessionMock,
  prismaMock,
  axiosMock,
} = vi.hoisted(() => ({
  getReviewerSessionMock: vi.fn(),
  prismaMock: {
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
  })

  it('reuses parsed URL analysis without refetching or calling an LLM', async () => {
    const { default: analyzeHandler } = await import(
      '../../../pages/api/reviewer/calls/analyze'
    )
    const cachedJson = { title: 'Cached call', objectives: ['Reuse me'] }

    prismaMock.reviewerCall.findFirst.mockResolvedValue({
      id: 'cached-call',
      parsed_json: cachedJson,
      raw_text_backup: 'cached raw text',
    })
    prismaMock.reviewerCall.create.mockResolvedValue({ id: 'new-call' })

    const res = createMockRes()
    await analyzeHandler(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          project_title: 'Project',
          agency_name: 'Agency',
          call_input_type: 'url',
          call_input_data: 'https://example.test/call',
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.body).toEqual({
      call_id: 'new-call',
      status: 'completed',
      cached: true,
    })
    expect(axiosMock.get).not.toHaveBeenCalled()
    expect(axiosMock.post).not.toHaveBeenCalled()
    expect(prismaMock.reviewerCall.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parsed_json: cachedJson,
          raw_text_backup: 'cached raw text',
          review_status: 'parsed',
        }),
      })
    )
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
