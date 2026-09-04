import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who may read the accountability grid, and how far.
 *
 * The clamping rule is the whole security surface of this feature: a head sees
 * the department, a member sees themselves — including the schools they cover
 * as deputy, because during someone's leave the deputy is the one doing the
 * work — and anyone else is refused. Asserted here as executable spec, because
 * a silent widening of `schoolIds` would leak one officer's record to another.
 */

const { requireTenantScopeMock, getMembershipMock, getMatrixMock, resolveWindowMock } = vi.hoisted(
  () => ({
    requireTenantScopeMock: vi.fn(),
    getMembershipMock: vi.fn(),
    getMatrixMock: vi.fn(),
    resolveWindowMock: vi.fn(),
  })
)

vi.mock('@/lib/auth/tenantAccess', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/tenantAccess')
  return {
    ...actual,
    requireTenantScope: requireTenantScopeMock,
    isAccessError: (value: any) => Boolean(value && typeof value.status === 'number' && value.error),
  }
})

vi.mock('@/lib/fundingDept/membershipService', () => ({
  getMembership: getMembershipMock,
}))

vi.mock('@/lib/fundingDept/accountabilityService', () => ({
  getMemberSchoolMatrix: getMatrixMock,
  resolveActivityWindow: resolveWindowMock,
}))

const load = async () => import('@/app/api/funding-dept/accountability/route')

const request = (url = 'http://localhost/api/funding-dept/accountability') =>
  ({ url }) as any

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
      { id: 'c1', org_unit_id: 'school-a', created_at: new Date(), is_deputy: false, org_unit: { id: 'school-a', name: 'Sciences', code: null, is_active: true } },
      { id: 'c2', org_unit_id: 'school-b', created_at: new Date(), is_deputy: true, org_unit: { id: 'school-b', name: 'Engineering', code: null, is_active: true } },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveWindowMock.mockResolvedValue({
    start: new Date('2026-01-01'),
    end: new Date('2026-12-31'),
    label: '2026',
    key: 'reporting',
  })
  getMatrixMock.mockResolvedValue({ members: [], uncovered: [], totals: {} })
})

describe('GET /api/funding-dept/accountability', () => {
  it('gives an org admin the whole department, unclamped', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 't1',
      user: { id: 'admin-1' },
      isAdmin: true,
      scope: scope({ isTenantWide: true }),
    })
    getMembershipMock.mockResolvedValue(null)

    const { GET } = await load()
    const response = await GET(request())
    expect(response.status).toBe(200)

    const [, options] = getMatrixMock.mock.calls[0]
    expect(options.memberIds).toBeUndefined()
    expect(options.schoolIds).toBeUndefined()
    expect((await response.json()).lens).toBe('department')
  })

  it('gives the department head the whole department', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 't1',
      user: { id: 'user-1' },
      isAdmin: false,
      scope: scope({ fundingDept: { isMember: true, isHead: true } }),
    })
    getMembershipMock.mockResolvedValue(membership({ is_head: true }))

    const { GET } = await load()
    const response = await GET(request())
    const [, options] = getMatrixMock.mock.calls[0]
    expect(options.memberIds).toBeUndefined()
    expect(options.schoolIds).toBeUndefined()
    expect((await response.json()).lens).toBe('department')
  })

  it('clamps a plain member to their own row and their own schools, deputy cover included', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 't1',
      user: { id: 'user-1' },
      isAdmin: false,
      scope: scope({ fundingDept: { isMember: true, isHead: false } }),
    })
    getMembershipMock.mockResolvedValue(membership())

    const { GET } = await load()
    const response = await GET(request())
    const [, options] = getMatrixMock.mock.calls[0]
    expect(options.memberIds).toEqual(['member-1'])
    // The deputy school is included: the deputy is doing that work.
    expect(options.schoolIds?.sort()).toEqual(['school-a', 'school-b'])
    expect((await response.json()).lens).toBe('member')
  })

  it('never lets a member widen to a school outside their reach', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 't1',
      user: { id: 'user-1' },
      isAdmin: false,
      scope: scope({ fundingDept: { isMember: true, isHead: false } }),
    })
    getMembershipMock.mockResolvedValue(membership())

    const { GET } = await load()
    await GET(request('http://localhost/api/funding-dept/accountability?schoolId=school-z'))
    const [, options] = getMatrixMock.mock.calls[0]
    // Narrows to nothing rather than widening.
    expect(options.schoolIds).toEqual([])
  })

  it('ignores a member trying to inspect a colleague', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 't1',
      user: { id: 'user-1' },
      isAdmin: false,
      scope: scope({ fundingDept: { isMember: true, isHead: false } }),
    })
    getMembershipMock.mockResolvedValue(membership())

    const { GET } = await load()
    await GET(request('http://localhost/api/funding-dept/accountability?memberId=member-9'))
    const [, options] = getMatrixMock.mock.calls[0]
    expect(options.memberIds).toEqual(['member-1'])
  })

  it('refuses someone outside the department, such as a Dean', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 't1',
      user: { id: 'dean-1' },
      isAdmin: false,
      scope: scope({ isHead: true, managedUnitIds: ['school-a'], canViewReports: true }),
    })
    getMembershipMock.mockResolvedValue(null)

    const { GET } = await load()
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(getMatrixMock).not.toHaveBeenCalled()
  })

  it('refuses a member whose membership was deactivated', async () => {
    requireTenantScopeMock.mockResolvedValue({
      tenantId: 't1',
      user: { id: 'user-1' },
      isAdmin: false,
      scope: scope(),
    })
    getMembershipMock.mockResolvedValue(membership({ is_active: false }))

    const { GET } = await load()
    const response = await GET(request())
    expect(response.status).toBe(403)
  })
})
