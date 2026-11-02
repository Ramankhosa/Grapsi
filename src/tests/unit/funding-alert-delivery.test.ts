import { beforeEach, describe, expect, it, vi } from 'vitest'

// Alert delivery reliability: a crash between claiming an alert and delivering
// it must be resumed, a definite email failure retried, an uncertain one never
// resent, and an unconfigured mailer never recorded as "sent".

const mocks = vi.hoisted(() => ({
  fundingCallFindUnique: vi.fn(),
  alertFindMany: vi.fn(),
  alertCreate: vi.fn(),
  alertUpdate: vi.fn(),
  alertUpdateMany: vi.fn(),
  userFindMany: vi.fn(),
  preferenceFindMany: vi.fn(),
  notificationCreate: vi.fn(),
  sendEmail: vi.fn(),
  search: vi.fn(),
  filterTenantsWithFeature: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}))

const prismaMock = {
  fundingCall: { findUnique: mocks.fundingCallFindUnique },
  fundingCallAlert: { findMany: mocks.alertFindMany, create: mocks.alertCreate, update: mocks.alertUpdate, updateMany: mocks.alertUpdateMany },
  user: { findMany: mocks.userFindMany },
  researcherNotificationPreference: { findMany: mocks.preferenceFindMany },
  notification: { create: mocks.notificationCreate },
  researcherProfile: { findMany: vi.fn(async () => []) },
  $queryRaw: mocks.queryRaw,
  $executeRaw: mocks.executeRaw,
  $transaction: async (fn: (tx: unknown) => unknown) => fn(prismaMock),
}

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }))
vi.mock('@/lib/mailer', () => ({
  sendEmail: mocks.sendEmail,
  SITE_URL: 'https://app.example.org',
  EmailDeliveryError: class EmailDeliveryError extends Error {
    constructor(message: string, readonly kind: string) { super(message) }
  },
}))
vi.mock('@/lib/email-templates', () => ({
  fundingOpportunityTemplate: vi.fn(() => ({ subject: 'match', html: '<p>match</p>' })),
  fundingAlertDigestTemplate: vi.fn(() => ({ subject: 'digest', html: '<p>digest</p>' })),
}))
vi.mock('@/lib/entitlement-service', () => ({ filterTenantsWithFeature: mocks.filterTenantsWithFeature }))
vi.mock('@/lib/services/researcherSearchService', () => ({ researcherSearchService: { search: mocks.search } }))
vi.mock('@/lib/fundingDept/opportunitySnapshot', () => ({ snapshotFundingOpportunity: vi.fn(async () => undefined) }))
vi.mock('@/lib/tenant/locale', () => ({ getTenantLocale: async () => ({ timezone: 'Asia/Kolkata' }) }))

const CALL = {
  id: 'call-1', tenantId: 'tenant-1', visibility: 'TENANT_PRIVATE', status: 'PUBLISHED', catalog_status: 'PUBLISHED',
  is_active: true, title: 'Quantum Materials Call', scheme_title: null, agency_name: 'DST', agencyName: null,
  close_date: null, deadlineAt: null, expiration_date: null, amount_min: null, amount_max: null, currency: null, metadata: {},
}
const USER = { id: 'user-a', email: 'a@uni.edu', name: 'A', tenantId: 'tenant-1' }

async function load() {
  const service = (await import('@/lib/services/fundingAlertService')).fundingAlertService
  const { EmailDeliveryError } = (await import('@/lib/mailer')) as unknown as {
    EmailDeliveryError: new (message: string, kind: string) => Error
  }
  return { service, EmailDeliveryError }
}

function lastAlertUpdate() {
  return mocks.alertUpdate.mock.calls.at(-1)?.[0]?.data
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.fundingCallFindUnique.mockResolvedValue({ ...CALL })
  mocks.alertFindMany.mockResolvedValue([])
  mocks.alertCreate.mockResolvedValue({ id: 'alert-1' })
  mocks.alertUpdate.mockResolvedValue({})
  mocks.alertUpdateMany.mockResolvedValue({ count: 1 })
  mocks.userFindMany.mockResolvedValue([USER])
  mocks.preferenceFindMany.mockResolvedValue([])
  mocks.notificationCreate.mockResolvedValue({})
  mocks.sendEmail.mockResolvedValue({ sent: true })
  mocks.search.mockResolvedValue({ scoreBasis: 'rerank', results: [{ userId: 'user-a', score: .9, matchTier: 'strong', matchedSources: ['profile'], matchReason: 'Profile overlap' }] })
  mocks.filterTenantsWithFeature.mockResolvedValue(new Set(['tenant-1']))
  mocks.queryRaw.mockResolvedValue([])
  mocks.executeRaw.mockResolvedValue(1)
})

describe('instant alert delivery', () => {
  it('claims each wanted channel as pending, so an interrupted delivery is distinguishable from a skip', async () => {
    const { service } = await load()
    await service.dispatchAlertsForFundingCall('call-1')
    expect(mocks.alertCreate.mock.calls[0][0].data).toMatchObject({ in_app_status: 'pending', email_status: 'pending' })
    // The in-app claim is conditional, and the bell entry is written with it.
    expect(mocks.alertUpdateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'alert-1', in_app_status: 'pending' }, data: { in_app_status: 'created' } })
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1)
    expect(lastAlertUpdate()).toMatchObject({ email_status: 'sent' })
  })

  it('does not record an email as sent when no mail provider is configured', async () => {
    mocks.sendEmail.mockResolvedValue({ sent: false })
    const { service } = await load()
    const result = await service.dispatchAlertsForFundingCall('call-1')
    expect(lastAlertUpdate()).toMatchObject({ email_status: 'skipped', email_error: 'Email delivery is not configured' })
    expect(result.emailsSent).toBe(0)
  })

  it('schedules a retry for a definite, retryable failure', async () => {
    const { service, EmailDeliveryError } = await load()
    mocks.sendEmail.mockRejectedValue(new EmailDeliveryError('Mailjet send failed (503)', 'retryable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service.dispatchAlertsForFundingCall('call-1')
    const data = lastAlertUpdate()
    expect(data.email_status).toBe('failed')
    expect(data.email_retry_at).toBeInstanceOf(Date)
  })

  it('never retries a rejected message', async () => {
    const { service, EmailDeliveryError } = await load()
    mocks.sendEmail.mockRejectedValue(new EmailDeliveryError('Mailjet send failed (400)', 'rejected'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service.dispatchAlertsForFundingCall('call-1')
    expect(lastAlertUpdate()).toMatchObject({ email_status: 'failed', email_retry_at: null })
  })

  it('marks an unconfirmed send uncertain rather than failed, so it is not sent twice', async () => {
    const { service, EmailDeliveryError } = await load()
    mocks.sendEmail.mockRejectedValue(new EmailDeliveryError('timeout', 'uncertain'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service.dispatchAlertsForFundingCall('call-1')
    expect(lastAlertUpdate()).toMatchObject({ email_status: 'uncertain', email_retry_at: null })
  })

  it('sends nothing when another worker already claimed the email', async () => {
    mocks.alertUpdateMany.mockResolvedValue({ count: 0 })
    const { service } = await load()
    await service.dispatchAlertsForFundingCall('call-1')
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(mocks.notificationCreate).not.toHaveBeenCalled()
  })
})

describe('resuming interrupted alerts', () => {
  const stranded = {
    id: 'alert-9', user_id: 'user-a', match_reason: 'Profile overlap', match_tier: 'strong',
    in_app_status: 'pending', email_status: 'pending', email_attempts: 0,
    funding_call: { ...CALL }, user: { ...USER, status: 'ACTIVE' },
  }

  it('turns a send that died mid-flight into "uncertain" before anything else', async () => {
    mocks.alertUpdateMany.mockResolvedValueOnce({ count: 2 })
    const { service } = await load()
    const summary = await service.resumeInterruptedAlerts()
    expect(mocks.alertUpdateMany.mock.calls[0][0]).toMatchObject({ where: { email_status: 'sending' }, data: { email_status: 'uncertain' } })
    expect(summary.uncertain).toBe(2)
  })

  it('delivers the channels a crash left pending', async () => {
    mocks.alertFindMany.mockResolvedValue([stranded])
    const { service } = await load()
    const summary = await service.resumeInterruptedAlerts()
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ considered: 1, inAppCreated: 1, emailsSent: 1 })
  })

  it('closes out a stranded alert whose recipient lost the plan', async () => {
    mocks.alertFindMany.mockResolvedValue([stranded])
    mocks.filterTenantsWithFeature.mockResolvedValue(new Set())
    const { service } = await load()
    const summary = await service.resumeInterruptedAlerts()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(lastAlertUpdate()).toMatchObject({ in_app_status: 'skipped', email_status: 'skipped', email_error: 'Plan no longer includes funding alerts' })
    expect(summary.closedOut).toBe(1)
  })

  it('does not alert on an imported call its entry date has already closed', async () => {
    mocks.alertFindMany.mockResolvedValue([{ ...stranded, funding_call: { ...CALL, import_run_id: 'run-1',
      entry_closes_at: new Date('2020-01-01'), close_date: new Date('2999-01-01') } }])
    const { service } = await load()
    await service.resumeInterruptedAlerts()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(lastAlertUpdate()).toMatchObject({ email_error: 'Call closed before delivery' })
  })
})

describe('digests', () => {
  const queued = (id: string) => ({
    id, user_id: 'user-a', match_reason: 'Profile overlap', match_tier: 'strong',
    funding_call: { ...CALL }, user: { ...USER, status: 'ACTIVE' },
  })

  it('reads only the users whose schedule this is', async () => {
    const { service } = await load()
    await service.sendFundingAlertDigests('weekly')
    expect(mocks.alertFindMany.mock.calls[0][0].where).toMatchObject({
      email_status: 'queued',
      user: { researcher_notification_preference: { is: { notification_frequency: 'weekly' } } },
    })
  })

  it('marks a digest with an unconfirmed send uncertain, never resending it', async () => {
    mocks.alertFindMany.mockResolvedValue([queued('alert-1'), queued('alert-2')])
    const { service, EmailDeliveryError } = await load()
    mocks.sendEmail.mockRejectedValue(new EmailDeliveryError('timeout', 'uncertain'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service.sendFundingAlertDigests('daily')
    const marked = mocks.alertUpdateMany.mock.calls.find(([args]) => args?.data?.email_status === 'uncertain')
    expect(marked?.[0].where.id.in).toEqual(['alert-1', 'alert-2'])
  })

  it('counts a retryable digest failure toward its attempt cap', async () => {
    mocks.alertFindMany.mockResolvedValue([queued('alert-1')])
    const { service, EmailDeliveryError } = await load()
    mocks.sendEmail.mockRejectedValue(new EmailDeliveryError('503', 'retryable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service.sendFundingAlertDigests('daily')
    const counted = mocks.alertUpdateMany.mock.calls.find(([args]) => args?.data?.email_attempts?.increment === 1)
    expect(counted).toBeTruthy()
  })
})
