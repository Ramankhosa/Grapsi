import { beforeEach, describe, expect, it, vi } from 'vitest'

// Funding alerts are a separately sold service (FUNDING_ALERTS plan feature).
// These tests pin the delivery gate: matched users only receive alerts when
// their tenant is entitled, and queued digest alerts are closed out when the
// entitlement has lapsed by digest time.

const mocks = vi.hoisted(() => ({
  fundingCallFindUnique: vi.fn(),
  fundingCallUpdate: vi.fn(),
  fundingCallAlertFindMany: vi.fn(),
  fundingCallAlertCreate: vi.fn(),
  fundingCallAlertUpdate: vi.fn(),
  fundingCallAlertUpdateMany: vi.fn(),
  userFindMany: vi.fn(),
  preferenceFindMany: vi.fn(),
  notificationCreate: vi.fn(),
  sendEmail: vi.fn(),
  search: vi.fn(),
  filterTenantsWithFeature: vi.fn(),
}))

const prismaMock = {
  fundingCall: {
    findUnique: mocks.fundingCallFindUnique,
    update: mocks.fundingCallUpdate,
  },
  fundingCallAlert: {
    findMany: mocks.fundingCallAlertFindMany,
    create: mocks.fundingCallAlertCreate,
    update: mocks.fundingCallAlertUpdate,
    updateMany: mocks.fundingCallAlertUpdateMany,
  },
  user: { findMany: mocks.userFindMany },
  researcherNotificationPreference: { findMany: mocks.preferenceFindMany },
  notification: { create: mocks.notificationCreate },
}

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }))

vi.mock('@/lib/mailer', () => ({
  sendEmail: mocks.sendEmail,
  SITE_URL: 'https://app.example.org',
}))

vi.mock('@/lib/email-templates', () => ({
  fundingOpportunityTemplate: vi.fn(() => ({ subject: 'match', html: '<p>match</p>' })),
  fundingAlertDigestTemplate: vi.fn(() => ({ subject: 'digest', html: '<p>digest</p>' })),
}))

vi.mock('@/lib/entitlement-service', () => ({
  filterTenantsWithFeature: mocks.filterTenantsWithFeature,
}))

vi.mock('@/lib/services/researcherSearchService', () => ({
  researcherSearchService: { search: mocks.search },
}))

const CALL = {
  id: 'call-1',
  tenantId: null,
  visibility: 'PUBLIC',
  status: 'PUBLISHED',
  catalog_status: 'PUBLISHED',
  is_active: true,
  title: 'Quantum Materials Call',
  scheme_title: null,
  agency_name: 'DST',
  agencyName: null,
  close_date: null,
  deadlineAt: null,
  expiration_date: null,
  amount_min: null,
  amount_max: null,
  currency: null,
  metadata: {},
}

function matchFor(userId: string) {
  return {
    userId,
    score: 0.9,
    matchTier: 'strong',
    matchedSources: ['profile'],
    matchReason: 'Profile overlap',
  }
}

async function loadService() {
  const serviceModule = await import('@/lib/services/fundingAlertService')
  return serviceModule.fundingAlertService
}

describe('funding alert entitlement gating', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.fundingCallFindUnique.mockResolvedValue({ ...CALL })
    mocks.fundingCallUpdate.mockResolvedValue({})
    mocks.fundingCallAlertFindMany.mockResolvedValue([])
    mocks.fundingCallAlertCreate.mockResolvedValue({ id: 'alert-1' })
    mocks.fundingCallAlertUpdate.mockResolvedValue({})
    mocks.fundingCallAlertUpdateMany.mockResolvedValue({ count: 0 })
    mocks.preferenceFindMany.mockResolvedValue([])
    mocks.notificationCreate.mockResolvedValue({})
    mocks.sendEmail.mockResolvedValue({})
  })

  it('alerts entitled tenants and skips unentitled ones', async () => {
    mocks.search.mockResolvedValue({
      scoreBasis: 'voyage',
      results: [matchFor('user-a'), matchFor('user-b')],
    })
    mocks.userFindMany.mockResolvedValue([
      { id: 'user-a', email: 'a@uni.edu', name: 'A', tenantId: 'tenant-entitled' },
      { id: 'user-b', email: 'b@corp.com', name: 'B', tenantId: 'tenant-unentitled' },
    ])
    mocks.filterTenantsWithFeature.mockResolvedValue(new Set(['tenant-entitled']))

    const service = await loadService()
    const result = await service.dispatchAlertsForFundingCall('call-1')

    expect(mocks.filterTenantsWithFeature).toHaveBeenCalledWith(
      ['tenant-entitled', 'tenant-unentitled'],
      'FUNDING_ALERTS'
    )
    expect(result.matched).toBe(2)
    expect(result.alerted).toBe(1)
    expect(result.skippedUnentitled).toBe(1)
    expect(mocks.fundingCallAlertCreate).toHaveBeenCalledTimes(1)
    expect(mocks.fundingCallAlertCreate.mock.calls[0][0].data.user_id).toBe('user-a')
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail.mock.calls[0][0].to).toBe('a@uni.edu')
  })

  it('creates nothing when no matched tenant is entitled, but still stamps the call', async () => {
    mocks.search.mockResolvedValue({
      scoreBasis: 'voyage',
      results: [matchFor('user-a'), matchFor('user-b')],
    })
    mocks.userFindMany.mockResolvedValue([
      { id: 'user-a', email: 'a@uni.edu', name: 'A', tenantId: 'tenant-1' },
      { id: 'user-b', email: 'b@uni.edu', name: 'B', tenantId: null },
    ])
    mocks.filterTenantsWithFeature.mockResolvedValue(new Set())

    const service = await loadService()
    const result = await service.dispatchAlertsForFundingCall('call-1')

    expect(result.dispatched).toBe(true)
    expect(result.alerted).toBe(0)
    expect(result.skippedUnentitled).toBe(2)
    expect(result.reason).toBe('no_entitled_matches')
    expect(mocks.fundingCallAlertCreate).not.toHaveBeenCalled()
    expect(mocks.notificationCreate).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    // The dispatch stamp still lands so the healing sweep does not rescan forever.
    expect(mocks.fundingCallUpdate).toHaveBeenCalledTimes(1)
  })

  it('closes out queued digest alerts whose tenant lost the entitlement', async () => {
    mocks.fundingCallAlertFindMany.mockResolvedValue([
      {
        id: 'alert-entitled',
        user_id: 'user-a',
        match_reason: 'Profile overlap',
        match_tier: 'strong',
        funding_call: { ...CALL },
        user: { id: 'user-a', email: 'a@uni.edu', name: 'A', status: 'ACTIVE', tenantId: 'tenant-entitled' },
      },
      {
        id: 'alert-churned',
        user_id: 'user-b',
        match_reason: 'Profile overlap',
        match_tier: 'strong',
        funding_call: { ...CALL },
        user: { id: 'user-b', email: 'b@corp.com', name: 'B', status: 'ACTIVE', tenantId: 'tenant-churned' },
      },
    ])
    mocks.preferenceFindMany.mockResolvedValue([
      {
        user_id: 'user-a',
        in_app_enabled: true,
        email_enabled: true,
        email_address: null,
        notification_frequency: 'daily',
      },
      {
        user_id: 'user-b',
        in_app_enabled: true,
        email_enabled: true,
        email_address: null,
        notification_frequency: 'daily',
      },
    ])
    mocks.filterTenantsWithFeature.mockResolvedValue(new Set(['tenant-entitled']))

    const service = await loadService()
    const result = await service.sendFundingAlertDigests('daily')

    expect(result.emailsSent).toBe(1)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail.mock.calls[0][0].to).toBe('a@uni.edu')

    const skipCall = mocks.fundingCallAlertUpdateMany.mock.calls.find(
      ([args]) => args?.data?.email_status === 'skipped' && args?.data?.email_error === 'Plan no longer includes funding alerts'
    )
    expect(skipCall).toBeTruthy()
    expect(skipCall?.[0]?.where?.id?.in).toEqual(['alert-churned'])
  })
})
