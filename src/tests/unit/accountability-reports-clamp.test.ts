import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who may read the three report endpoints, and how far.
 *
 * The grid next door has its own copy of this spec. These exist because the
 * clamp is now shared, and the whole point of sharing it is that the four
 * endpoints cannot drift apart — which is only true if all four are checked.
 *
 * The specific failure guarded here: an empty `schoolIds` means "no filter, show
 * everything" for a head and "you cover nothing, show nothing" for a member. An
 * earlier version inferred which from the lens name, and a member who named a
 * school outside their reach came back with their own whole reach instead of an
 * empty report.
 */

const {
  requireTenantScopeMock,
  getMembershipMock,
  resolveWindowMock,
  getBacklogMock,
  getEngagementMock,
  getEfficiencyMock,
  getSettingsMock,
} = vi.hoisted(() => ({
  requireTenantScopeMock: vi.fn(),
  getMembershipMock: vi.fn(),
  resolveWindowMock: vi.fn(),
  getBacklogMock: vi.fn(),
  getEngagementMock: vi.fn(),
  getEfficiencyMock: vi.fn(),
  getSettingsMock: vi.fn(),
}))

vi.mock('@/lib/auth/tenantAccess', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/tenantAccess')
  return {
    ...actual,
    requireTenantScope: requireTenantScopeMock,
    isAccessError: (value: any) => Boolean(value && typeof value.status === 'number' && value.error),
  }
})

vi.mock('@/lib/fundingDept/membershipService', () => ({ getMembership: getMembershipMock }))

vi.mock('@/lib/fundingDept/accountabilityService', () => ({
  resolveActivityWindow: resolveWindowMock,
}))

vi.mock('@/lib/fundingDept/pendencyService', () => ({
  getUnallocatedBacklog: getBacklogMock,
  backlogToCsv: () => 'csv',
}))

vi.mock('@/lib/fundingDept/facultyEngagementService', () => ({
  getFacultyEngagement: getEngagementMock,
  engagementToCsv: () => 'csv',
}))

vi.mock('@/lib/fundingDept/efficiencyService', () => ({
  getOfficerEfficiency: getEfficiencyMock,
  efficiencyToCsv: () => 'csv',
}))

vi.mock('@/lib/fundingDept/settings', () => ({ getDeptSettings: getSettingsMock }))

const request = (url: string) => ({ url, nextUrl: new URL(url) }) as any

function scope(overrides: Record<string, any> = {}) {
  return {
    isTenantWide: false,
    isHead: false,
    managedUnitIds: [],
    canAssign: false,
    canViewReports: false,
    fundingDept: { isMember: false, isHead: false, memberId: null, schoolUnitIds: [] },
    ...overrides,
  }
}

function membership(overrides: Record<string, any> = {}) {
  return {
    id: 'member-1',
    user_id: 'user-1',
    is_head: false,
    is_active: true,
    title: null,
    created_at: new Date(),
    away_from: null,
    away_until: null,
    last_digest_sent_at: null,
    user: { id: 'user-1', name: 'Arun', email: 'arun@example.edu' },
    school_assignments: [
      {
        id: 'c1',
        org_unit_id: 'school-a',
        created_at: new Date(),
        is_deputy: false,
        org_unit: { id: 'school-a', name: 'Sciences', code: null, is_active: true },
      },
      {
        id: 'c2',
        org_unit_id: 'school-b',
        created_at: new Date(),
        is_deputy: true,
        org_unit: { id: 'school-b', name: 'Engineering', code: null, is_active: true },
      },
    ],
    ...overrides,
  }
}

const asAdmin = () =>
  requireTenantScopeMock.mockResolvedValue({
    tenantId: 'tenant-1',
    user: { id: 'admin-1' },
    isAdmin: true,
    roles: ['ADMIN'],
    scope: scope({ isTenantWide: true }),
  })

const asMember = () => {
  requireTenantScopeMock.mockResolvedValue({
    tenantId: 'tenant-1',
    user: { id: 'user-1' },
    isAdmin: false,
    roles: ['ANALYST'],
    scope: scope({ fundingDept: { isMember: true, isHead: false, memberId: 'member-1', schoolUnitIds: ['school-a'] } }),
  })
  getMembershipMock.mockResolvedValue(membership())
}

const asOutsider = () => {
  requireTenantScopeMock.mockResolvedValue({
    tenantId: 'tenant-1',
    user: { id: 'user-9' },
    isAdmin: false,
    roles: ['ANALYST'],
    scope: scope(),
  })
  getMembershipMock.mockResolvedValue(null)
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveWindowMock.mockResolvedValue({
    start: new Date('2026-01-01'),
    end: new Date('2026-12-31'),
    label: '2026',
    key: 'reporting',
  })
  getSettingsMock.mockResolvedValue({
    untouchedDays: 7,
    silentDays: 14,
    unansweredDays: 3,
    firstTouchTargetDays: 3,
    facultyDormantDays: 90,
    dismissalRateWarnPct: 40,
  })
  getBacklogMock.mockResolvedValue({ calls: [], totals: {} })
  getEngagementMock.mockResolvedValue({ rows: [], totals: {}, bySchool: [] })
  getEfficiencyMock.mockResolvedValue({ members: [], trendWeeks: [] })
})

describe('GET /api/funding-dept/accountability/backlog', () => {
  const load = () => import('@/app/api/funding-dept/accountability/backlog/route')
  const url = 'http://localhost/api/funding-dept/accountability/backlog'

  it('refuses somebody outside the department', async () => {
    asOutsider()
    const { GET } = await load()
    const response = await GET(request(url))
    expect(response.status).toBe(403)
    expect(getBacklogMock).not.toHaveBeenCalled()
  })

  it('gives an admin every school', async () => {
    asAdmin()
    const { GET } = await load()
    await GET(request(url))
    // Empty means "no filter" here, and the service reads that as every root.
    expect(getBacklogMock.mock.calls[0][1].schoolIds).toEqual([])
  })

  it('clamps a member to their rota and their deputy cover', async () => {
    asMember()
    const { GET } = await load()
    await GET(request(url))
    expect(getBacklogMock.mock.calls[0][1].schoolIds).toEqual(['school-a', 'school-b'])
  })

  it('shows a member nothing for a school they do not cover', async () => {
    asMember()
    const { GET } = await load()
    const response = await GET(request(`${url}?schoolId=school-z`))
    // Narrowed to nothing rather than widening, and without touching the service.
    expect(getBacklogMock).not.toHaveBeenCalled()
    expect((await response.json()).calls).toEqual([])
  })

  it('never lets a filter loosen the tenant threshold', async () => {
    asAdmin()
    const { GET } = await load()
    await GET(request(`${url}?minDays=1`))
    // Below the threshold the list would include calls that arrived this
    // morning, burying the real pendency.
    expect(getBacklogMock.mock.calls[0][1].minDays).toBe(7)
  })
})

describe('GET /api/funding-dept/accountability/faculty', () => {
  const load = () => import('@/app/api/funding-dept/accountability/faculty/route')
  const url = 'http://localhost/api/funding-dept/accountability/faculty'

  it('refuses somebody outside the department', async () => {
    asOutsider()
    const { GET } = await load()
    expect((await GET(request(url))).status).toBe(403)
  })

  it('clamps a member to their own schools', async () => {
    asMember()
    const { GET } = await load()
    await GET(request(url))
    expect(getEngagementMock.mock.calls[0][1].schoolIds).toEqual(['school-a', 'school-b'])
  })

  it('filters the rows after classification, so the totals still describe everyone', async () => {
    asAdmin()
    getEngagementMock.mockResolvedValue({
      rows: [
        { userId: 'a', code: 'NEVER_ASSIGNED' },
        { userId: 'b', code: 'ENGAGED' },
      ],
      totals: { faculty: 2, neverAssigned: 1, engaged: 1 },
      bySchool: [],
    })
    const { GET } = await load()
    const payload = await (await GET(request(`${url}?standing=NEVER_ASSIGNED`))).json()
    expect(payload.rows).toHaveLength(1)
    // "1 never approached" must not become "1 never approached, of the 1 I am
    // looking at".
    expect(payload.totals.faculty).toBe(2)
  })
})

describe('GET /api/funding-dept/accountability/efficiency', () => {
  const load = () => import('@/app/api/funding-dept/accountability/efficiency/route')
  const url = 'http://localhost/api/funding-dept/accountability/efficiency'

  it('refuses somebody outside the department', async () => {
    asOutsider()
    const { GET } = await load()
    expect((await GET(request(url))).status).toBe(403)
  })

  it('gives an admin every member and every school', async () => {
    asAdmin()
    const { GET } = await load()
    await GET(request(url))
    const options = getEfficiencyMock.mock.calls[0][1]
    expect(options.memberIds).toBeUndefined()
    expect(options.schoolIds).toBeUndefined()
  })

  it('clamps a member to their own row', async () => {
    asMember()
    const { GET } = await load()
    await GET(request(url))
    const options = getEfficiencyMock.mock.calls[0][1]
    expect(options.memberIds).toEqual(['member-1'])
    expect(options.schoolIds).toEqual(['school-a', 'school-b'])
  })

  it('bounds how much history a caller may ask for', async () => {
    asAdmin()
    const { GET } = await load()
    await GET(request(`${url}?weeks=9999`))
    expect(getEfficiencyMock.mock.calls[0][1].weeks).toBe(26)
  })
})

/**
 * The school-head lens.
 *
 * A Dean or Head of Department holds an OrgUnitManager grant, which is neither a
 * role nor a coverage row — so `canReviewDept` refuses them, and when these
 * reports first shipped that meant a 403 on the two screens most about their own
 * school. These pin the branch that fixed it, and the one report that stays
 * closed to them.
 */
const asSchoolHead = (headUnitIds = ['school-a', 'dept-b']) => {
  requireTenantScopeMock.mockResolvedValue({
    tenantId: 'tenant-1',
    user: { id: 'dean-1' },
    isAdmin: false,
    roles: ['ANALYST'],
    scope: scope({ isHead: true, canViewReports: true, headUnitIds, managedUnitIds: headUnitIds }),
  })
  // Not a department member: that is the whole point of this persona.
  getMembershipMock.mockResolvedValue(null)
}

describe('the school-head lens', () => {
  it('lets a Dean read the backlog for their own units', async () => {
    asSchoolHead()
    const { GET } = await import('@/app/api/funding-dept/accountability/backlog/route')
    const response = await GET(request('http://localhost/api/funding-dept/accountability/backlog'))
    expect(response.status).toBe(200)
    expect(getBacklogMock.mock.calls[0][1].schoolIds).toEqual(['school-a', 'dept-b'])
  })

  it('lets a Dean read faculty engagement for their own units', async () => {
    asSchoolHead()
    const { GET } = await import('@/app/api/funding-dept/accountability/faculty/route')
    const response = await GET(request('http://localhost/api/funding-dept/accountability/faculty'))
    expect(response.status).toBe(200)
    expect(getEngagementMock.mock.calls[0][1].schoolIds).toEqual(['school-a', 'dept-b'])
  })

  it('refuses a Dean the officer efficiency report', async () => {
    // It measures the funding department's own people. The module already keeps
    // that line by stripping officer notes from a Dean's copy of the ledger.
    asSchoolHead()
    const { GET } = await import('@/app/api/funding-dept/accountability/efficiency/route')
    const response = await GET(
      request('http://localhost/api/funding-dept/accountability/efficiency')
    )
    expect(response.status).toBe(403)
    expect(getEfficiencyMock).not.toHaveBeenCalled()
  })

  it('shows a Dean nothing for a unit they do not head', async () => {
    asSchoolHead()
    const { GET } = await import('@/app/api/funding-dept/accountability/backlog/route')
    const response = await GET(
      request('http://localhost/api/funding-dept/accountability/backlog?schoolId=school-z')
    )
    // Narrowed to nothing rather than widening to everything they head.
    expect(getBacklogMock).not.toHaveBeenCalled()
    expect((await response.json()).calls).toEqual([])
  })

  it('never widens a Dean to every school', async () => {
    asSchoolHead()
    const { GET } = await import('@/app/api/funding-dept/accountability/backlog/route')
    await GET(request('http://localhost/api/funding-dept/accountability/backlog'))
    // An empty schoolIds means "every school" to the services, so a school head
    // must always arrive with an explicit list.
    expect(getBacklogMock.mock.calls[0][1].schoolIds.length).toBeGreaterThan(0)
  })

  it('keeps the officer lens for somebody who is both', async () => {
    // An officer who also heads a school sees their whole rota, not just the one
    // unit they were granted — the wider of the two answers.
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 'tenant-1',
      user: { id: 'user-1' },
      isAdmin: false,
      roles: ['ANALYST'],
      scope: scope({
        isHead: true,
        canViewReports: true,
        headUnitIds: ['school-z'],
        fundingDept: { isMember: true, isHead: false, memberId: 'member-1', schoolUnitIds: ['school-a'] },
      }),
    })
    getMembershipMock.mockResolvedValue(membership())
    const { GET } = await import('@/app/api/funding-dept/accountability/backlog/route')
    await GET(request('http://localhost/api/funding-dept/accountability/backlog'))
    expect(getBacklogMock.mock.calls[0][1].schoolIds).toEqual(['school-a', 'school-b'])
  })

  it('still refuses somebody with a grant that does not carry reports', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 'tenant-1',
      user: { id: 'dean-2' },
      isAdmin: false,
      roles: ['ANALYST'],
      scope: scope({ isHead: true, canViewReports: false, headUnitIds: ['school-a'] }),
    })
    getMembershipMock.mockResolvedValue(null)
    const { GET } = await import('@/app/api/funding-dept/accountability/backlog/route')
    const response = await GET(request('http://localhost/api/funding-dept/accountability/backlog'))
    expect(response.status).toBe(403)
  })
})
