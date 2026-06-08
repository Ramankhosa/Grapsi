import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  fundingCallFindUnique: vi.fn(),
  fundingCallGuidelineFindUnique: vi.fn(),
  fundingCallGuidelineRevisionFindFirst: vi.fn(),
  fundingCallTemplateFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    project: {
      findFirst: mocks.projectFindFirst,
    },
    fundingCall: {
      findUnique: mocks.fundingCallFindUnique,
    },
    fundingCallGuideline: {
      findUnique: mocks.fundingCallGuidelineFindUnique,
    },
    fundingCallGuidelineRevision: {
      findFirst: mocks.fundingCallGuidelineRevisionFindFirst,
    },
    fundingCallTemplate: {
      findUnique: mocks.fundingCallTemplateFindUnique,
    },
  },
}))

function makeFundingCall() {
  return {
    id: 'call-uploaded-1',
    catalog_status: 'DRAFT',
    is_active: false,
    agency_name: 'Health Innovation Fund',
    scheme_title: 'Uploaded Sensory Health Call',
    description: 'Supports health technology pilots.',
    close_date: new Date('2026-09-30T00:00:00Z'),
    amount_min: 25000,
    amount_max: 25000,
    currency: 'EUR',
    project_duration_min_months: 12,
    project_duration_max_months: 12,
    project_duration_text: null,
    eligibility_text: 'Eligible applicants include academic health teams.',
    expected_deliverables_text: 'Prototype and validation report.',
    official_urls: ['https://example.org/call'],
    source_url: 'https://example.org/call',
    disciplines: ['health tech'],
    funding_kinds: ['pilot grant'],
    guideline_status: 'approved',
    template_status: 'draft',
    metadata: {
      owner_user_id: 'user-1',
      verification_status: 'pending_admin_verification',
    },
    uploaded_by: 'user@example.org',
    active_template_id: null,
  }
}

describe('project funding context', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.projectFindFirst.mockResolvedValue({
      id: 'project-1',
      grantSessions: [],
    })
    mocks.fundingCallFindUnique.mockResolvedValue(makeFundingCall())
    mocks.fundingCallGuidelineFindUnique.mockResolvedValue({
      id: 'guideline-1',
    })
    mocks.fundingCallGuidelineRevisionFindFirst.mockResolvedValue({
      id: 'guideline-revision-1',
    })
    mocks.fundingCallTemplateFindUnique.mockResolvedValue(null)
  })

  it('uses an explicitly bound uploaded call even before a grant session anchor exists', async () => {
    const { resolveProjectFundingContext } = await import('@/lib/fundingContext')

    const context = await resolveProjectFundingContext(
      'project-1',
      {
        id: 'user-1',
        email: 'user@example.org',
        tenantId: 'tenant-1',
      },
      {
        fundingCallId: 'call-uploaded-1',
      }
    )

    expect(mocks.projectFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        grantSessions: expect.any(Object),
      }),
    }))
    expect(mocks.fundingCallFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'call-uploaded-1' },
    }))
    expect(context.id).toBe('call-uploaded-1')
    expect(context.title).toBe('Uploaded Sensory Health Call')
    expect(context.guidelineStatus).toBe('approved')
    expect(context.focusAreas).toEqual(['health tech', 'pilot grant'])
  })
})
