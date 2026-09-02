import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getReviewerSessionMock,
  requireReviewerCallAccessMock,
  requireGrantReviewFeatureMock,
  createReviewerCallFromContextMock,
  buildReviewerContextFromStoredCallMock,
  extractReviewerContextFromUrlsMock,
  prismaMock,
  axiosMock,
} = vi.hoisted(() => {
  const prismaMock = {
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
    // Section creation takes an advisory lock inside the transaction so two
    // submissions cannot mint the same version number.
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  }

  // The route wraps section creation in a transaction. The callback is handed
  // a client exposing the same delegates, so pass the mock itself; the array
  // form is supported too, for callers that batch writes. Implemented after
  // the literal so it can refer to the mock without losing its inferred type.
  prismaMock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? await arg(prismaMock) : await Promise.all(arg)
  )

  return {
    getReviewerSessionMock: vi.fn(),
    requireReviewerCallAccessMock: vi.fn(),
    requireGrantReviewFeatureMock: vi.fn(),
    createReviewerCallFromContextMock: vi.fn(),
    buildReviewerContextFromStoredCallMock: vi.fn(),
    extractReviewerContextFromUrlsMock: vi.fn(),
    prismaMock,
    axiosMock: {
      get: vi.fn(),
      post: vi.fn(),
      head: vi.fn(),
      isAxiosError: vi.fn(),
    },
  }
})

vi.mock('@/lib/reviewer-auth-api', () => ({
  getReviewerSession: getReviewerSessionMock,
  requireReviewerCallAccess: requireReviewerCallAccessMock,
  requireGrantReviewFeature: requireGrantReviewFeatureMock,
}))

vi.mock('@/lib/reviewer/template-bridge', () => ({
  createReviewerCallFromContext: createReviewerCallFromContextMock,
}))

vi.mock('@/lib/reviewer/callExtraction', () => ({
  extractReviewerContextFromUrls: extractReviewerContextFromUrlsMock,
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
    requireGrantReviewFeatureMock.mockResolvedValue(true)
  })

  it('creates standalone reviewer calls from a stored funding call', async () => {
    vi.doMock('@/lib/reviewer/callContext', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      buildReviewerContextFromStoredCall: buildReviewerContextFromStoredCallMock,
    }))
    vi.resetModules()
    const { default: callsHandler } = await import(
      '../../../pages/api/reviewer/calls/index'
    )

    getReviewerSessionMock.mockResolvedValue({ user: { id: 'user-1', tenantId: 'tenant-1' } })
    prismaMock.fundingCall.findFirst.mockResolvedValue({ id: 'funding-1' })
    buildReviewerContextFromStoredCallMock.mockResolvedValue({
      context: { rules_source: 'template_manual', template_sections: [{ key: 'a' }] },
      templateSnapshot: { templateId: 'template-1' },
      readiness: 'template_manual',
    })
    createReviewerCallFromContextMock.mockResolvedValue({
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
    expect(res.body.rulesSource).toBe('template_manual')
    expect(buildReviewerContextFromStoredCallMock).toHaveBeenCalledWith({
      fundingCallId: 'funding-1',
      manualRubric: { evaluationCriteria: ['Fit'] },
    })
    expect(createReviewerCallFromContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        projectTitle: 'Project',
        seedSections: false,
      })
    )
    vi.doUnmock('@/lib/reviewer/callContext')
    vi.resetModules()
  })

  it('creates reviewer calls from an already-analyzed URL context without re-extracting', async () => {
    const { default: callsHandler } = await import(
      '../../../pages/api/reviewer/calls/index'
    )

    getReviewerSessionMock.mockResolvedValue({ user: { id: 'user-1', tenantId: 'tenant-1' } })
    createReviewerCallFromContextMock.mockResolvedValue({
      id: 'reviewer-call-2',
      call_input_type: 'url',
    })

    const res = createMockRes()
    await callsHandler(
      {
        method: 'POST',
        body: {
          sourceMode: 'url',
          project_title: 'URL Project',
          sourceUrls: ['https://agency.example/call'],
          analyzedContext: {
            title: 'Open Call',
            agency_name: 'Agency',
            rules_source: 'url_extracted',
            template_sections: [
              { key: 'objectives', label: 'Objectives', bucketKey: 'objectives', required: true },
            ],
          },
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.body.call.id).toBe('reviewer-call-2')
    expect(extractReviewerContextFromUrlsMock).not.toHaveBeenCalled()
    expect(createReviewerCallFromContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectTitle: 'URL Project',
        seedSections: true,
        context: expect.objectContaining({
          rules_source: 'url_extracted',
          source_urls: ['https://agency.example/call'],
        }),
      })
    )
  })

  it('rejects a URL context whose reviewer rules are empty', async () => {
    const { default: callsHandler } = await import(
      '../../../pages/api/reviewer/calls/index'
    )

    getReviewerSessionMock.mockResolvedValue({ user: { id: 'user-1', tenantId: 'tenant-1' } })

    const res = createMockRes()
    await callsHandler(
      {
        method: 'POST',
        body: {
          sourceMode: 'url',
          project_title: 'URL Project',
          sourceUrls: ['https://agency.example/call'],
          analyzedContext: { title: 'Open Call', template_sections: [] },
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(400)
    expect(createReviewerCallFromContextMock).not.toHaveBeenCalled()
  })

  it('treats a re-submitted section title as a revision of the newest version', async () => {
    const { default: sectionsHandler } = await import(
      '../../../pages/api/reviewer/calls/[id]/sections/index'
    )

    prismaMock.reviewerCall.findUnique.mockResolvedValue({ user_id: 'user-1' })
    prismaMock.reviewerSection.findFirst.mockResolvedValue({ id: 'section-2', version: 2 })
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
    // The UI did not flag this as a revision, but an earlier version exists —
    // linking it is what lets the review compare against the prior remarks.
    expect(prismaMock.reviewerSection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 3,
          is_revision: true,
          previous_section_id: 'section-2',
        }),
      })
    )
  })

  it('numbers a revision from the newest version, not the draft being revised', async () => {
    const { default: sectionsHandler } = await import(
      '../../../pages/api/reviewer/calls/[id]/sections/index'
    )

    prismaMock.reviewerCall.findUnique.mockResolvedValue({ user_id: 'user-1' })
    // Base is v1, but v3 already exists — the new row must be v4, not v2.
    prismaMock.reviewerSection.findFirst
      .mockResolvedValueOnce({ id: 'section-1' })
      .mockResolvedValueOnce({ id: 'section-3', version: 3 })
    prismaMock.reviewerSection.create.mockImplementation(async ({ data }) => ({
      id: 'section-4',
      section_title: data.section_title,
      version: data.version,
    }))
    prismaMock.reviewAssetLink.findMany.mockResolvedValue([])

    const res = createMockRes()
    await sectionsHandler(
      {
        method: 'POST',
        query: { id: 'call-1' },
        body: {
          section_title: 'Methodology',
          user_input: 'Revising the original draft',
          previous_section_id: 'section-1',
          is_revision: true,
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(201)
    expect(prismaMock.reviewerSection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 4,
          previous_section_id: 'section-1',
          is_revision: true,
        }),
      })
    )
  })

  it('rejects a revision whose base does not belong to the call', async () => {
    const { default: sectionsHandler } = await import(
      '../../../pages/api/reviewer/calls/[id]/sections/index'
    )

    prismaMock.reviewerCall.findUnique.mockResolvedValue({ user_id: 'user-1' })
    prismaMock.reviewerSection.findFirst.mockResolvedValueOnce(null)

    const res = createMockRes()
    await sectionsHandler(
      {
        method: 'POST',
        query: { id: 'call-1' },
        body: {
          section_title: 'Methodology',
          user_input: 'Revision text',
          previous_section_id: 'section-from-another-call',
          is_revision: true,
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(400)
    expect(prismaMock.reviewerSection.create).not.toHaveBeenCalled()
  })

  it('copies revision assets while enforcing the donor max-3 per section type rule', async () => {
    const { default: sectionsHandler } = await import(
      '../../../pages/api/reviewer/calls/[id]/sections/index'
    )

    prismaMock.reviewerCall.findUnique.mockResolvedValue({ user_id: 'user-1' })
    prismaMock.reviewerSection.findFirst
      .mockResolvedValueOnce({ id: 'section-4' })
      .mockResolvedValueOnce({ id: 'section-4', version: 4 })
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
