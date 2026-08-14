import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The precedence rules in resolveManagedScope ARE the backward-compatibility
 * contract for this feature, so they are asserted here as executable spec
 * rather than left to review discipline.
 */

const {
  findManyGrantsMock,
  queryRawMock,
  findUniqueProfileMock,
  findFirstDeptMemberMock,
  findManyCoverageMock,
} = vi.hoisted(() => ({
  findManyGrantsMock: vi.fn(),
  queryRawMock: vi.fn(),
  findUniqueProfileMock: vi.fn(),
  findFirstDeptMemberMock: vi.fn(),
  findManyCoverageMock: vi.fn(),
}))

const prismaMock = {
  orgUnitManager: { findMany: findManyGrantsMock },
  researcherProfile: { findUnique: findUniqueProfileMock },
  fundingDeptMember: { findFirst: findFirstDeptMemberMock },
  fundingDeptSchoolAssignment: { findMany: findManyCoverageMock },
  $queryRaw: queryRawMock,
}

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
  prisma: prismaMock,
}))

const load = async () => import('@/lib/orgUnits/scope')

const GRANT = {
  org_unit_id: 'dept-1',
  scope: 'SUBTREE' as const,
  can_assign: true,
  can_view_reports: true,
  can_manage_structure: false,
  can_manage_members: false,
}

const DEPT_MEMBER = { id: 'fdm-1', is_head: false }

beforeEach(() => {
  vi.clearAllMocks()
  findManyGrantsMock.mockResolvedValue([])
  queryRawMock.mockResolvedValue([])
  findUniqueProfileMock.mockResolvedValue(null)
  // No department membership by default: every pre-existing assertion below
  // must hold unchanged, which is the back-compat proof for this feature.
  findFirstDeptMemberMock.mockResolvedValue(null)
  findManyCoverageMock.mockResolvedValue([])
})

describe('resolveManagedScope precedence', () => {
  it('gives OWNER/ADMIN/CALL_ADMIN tenant-wide reach', async () => {
    const { resolveManagedScope } = await load()
    for (const role of ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'CALL_ADMIN']) {
      const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: [role] })
      expect(scope.isTenantWide, role).toBe(true)
      expect(scope.canAssign, role).toBe(true)
    }
    // Tenant-wide callers never pay for the grant lookup.
    expect(findManyGrantsMock).not.toHaveBeenCalled()
  })

  it('BACK-COMPAT: an ungranted MANAGER keeps tenant-wide reach by default', async () => {
    const { resolveManagedScope } = await load()
    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MANAGER'] })
    expect(scope.isTenantWide).toBe(true)
    expect(scope.isHead).toBe(false)
  })

  it('narrows an ungranted MANAGER only when the tenant opts in', async () => {
    const { resolveManagedScope } = await load()
    const scope = await resolveManagedScope({
      tenantId: 't1',
      userId: 'u1',
      roles: ['CALL_ASSIGNER'],
      enforceScope: true,
    })
    expect(scope.isTenantWide).toBe(false)
    expect(scope.canAssign).toBe(false)
  })

  it('gives a plain MEMBER no reach at all', async () => {
    const { resolveManagedScope } = await load()
    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })
    expect(scope.isTenantWide).toBe(false)
    expect(scope.isHead).toBe(false)
    expect(scope.canAssign).toBe(false)
  })

  it('lets a head assign without holding CALL_ASSIGNER — the delegation itself', async () => {
    findManyGrantsMock.mockResolvedValue([GRANT])
    queryRawMock.mockResolvedValue([{ id: 'dept-1' }, { id: 'centre-1' }])
    const { resolveManagedScope } = await load()

    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })
    expect(scope.isHead).toBe(true)
    expect(scope.canAssign).toBe(true)
    expect(scope.isTenantWide).toBe(false)
    expect(scope.managedUnitIds.sort()).toEqual(['centre-1', 'dept-1'])
    expect(scope.primaryUnitId).toBe('dept-1')
  })

  it('does not expand a UNIT_ONLY grant', async () => {
    findManyGrantsMock.mockResolvedValue([{ ...GRANT, scope: 'UNIT_ONLY' }])
    const { resolveManagedScope } = await load()

    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })
    expect(scope.managedUnitIds).toEqual(['dept-1'])
    expect(queryRawMock).not.toHaveBeenCalled()
  })

  it('honours a reports-only grant that cannot assign', async () => {
    findManyGrantsMock.mockResolvedValue([{ ...GRANT, can_assign: false }])
    const { resolveManagedScope } = await load()

    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })
    expect(scope.canAssign).toBe(false)
    expect(scope.canViewReports).toBe(true)
  })
})

describe('resolveManagedScope: funding department coverage', () => {
  it('scopes a covering member to their schools and lets them assign', async () => {
    findFirstDeptMemberMock.mockResolvedValue(DEPT_MEMBER)
    findManyCoverageMock.mockResolvedValue([{ org_unit_id: 'school-a' }, { org_unit_id: 'school-b' }])
    queryRawMock.mockResolvedValue([
      { id: 'school-a' },
      { id: 'school-b' },
      { id: 'dept-under-a' },
    ])
    const { resolveManagedScope } = await load()

    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })
    expect(scope.isTenantWide).toBe(false)
    expect(scope.isHead).toBe(true)
    expect(scope.canAssign).toBe(true)
    expect(scope.canViewReports).toBe(true)
    expect(scope.managedUnitIds.sort()).toEqual(['dept-under-a', 'school-a', 'school-b'])
    expect(scope.fundingDept).toEqual({
      isMember: true,
      isHead: false,
      memberId: 'fdm-1',
      schoolUnitIds: ['school-a', 'school-b'],
    })
  })

  it('covers a school subtree, so departments under it are in reach', async () => {
    findFirstDeptMemberMock.mockResolvedValue(DEPT_MEMBER)
    findManyCoverageMock.mockResolvedValue([{ org_unit_id: 'school-a' }])
    const { resolveManagedScope } = await load()
    await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })

    // Coverage is always a subtree root — there is no UNIT_ONLY equivalent.
    expect(queryRawMock).toHaveBeenCalledTimes(1)
  })

  it('gives the head every school the department covers', async () => {
    findFirstDeptMemberMock.mockResolvedValue({ id: 'fdm-head', is_head: true })
    findManyCoverageMock.mockResolvedValue([
      { org_unit_id: 'school-a' },
      { org_unit_id: 'school-b' },
      { org_unit_id: 'school-c' },
    ])
    const { resolveManagedScope } = await load()
    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'head', roles: ['MEMBER'] })

    expect(scope.fundingDept.isHead).toBe(true)
    expect(scope.headUnitIds.sort()).toEqual(['school-a', 'school-b', 'school-c'])
    // The head query asks for every active member's coverage, not just their own.
    expect(findManyCoverageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 't1', member: { is_active: true } },
      })
    )
  })

  it('NARROWS a legacy tenant-wide assigner once they cover schools', async () => {
    findFirstDeptMemberMock.mockResolvedValue(DEPT_MEMBER)
    findManyCoverageMock.mockResolvedValue([{ org_unit_id: 'school-a' }])
    const { resolveManagedScope } = await load()

    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['CALL_ASSIGNER'] })
    expect(scope.isTenantWide).toBe(false)
    expect(scope.managedUnitIds).toContain('school-a')
  })

  it('leaves a member with no schools on the pre-existing code path', async () => {
    findFirstDeptMemberMock.mockResolvedValue(DEPT_MEMBER)
    findManyCoverageMock.mockResolvedValue([])
    const { resolveManagedScope } = await load()

    const plain = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })
    expect(plain.isHead).toBe(false)
    expect(plain.canAssign).toBe(false)
    expect(plain.fundingDept.isMember).toBe(true)

    // ...including the legacy widening, which coverage (not membership) revokes.
    const legacy = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MANAGER'] })
    expect(legacy.isTenantWide).toBe(true)
  })

  it('does not grant structural rights — covering a school is not owning it', async () => {
    findFirstDeptMemberMock.mockResolvedValue(DEPT_MEMBER)
    findManyCoverageMock.mockResolvedValue([{ org_unit_id: 'school-a' }])
    const { resolveManagedScope } = await load()

    const scope = await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['MEMBER'] })
    expect(scope.canManageStructure).toBe(false)
    expect(scope.canManageMembers).toBe(false)
    // Arbitrary attribution is worse than none: 1 of 4 schools is not "their" unit.
    expect(scope.primaryUnitId).toBeNull()
  })

  it('never pays for the department lookup when the caller is tenant-wide', async () => {
    const { resolveManagedScope } = await load()
    await resolveManagedScope({ tenantId: 't1', userId: 'u1', roles: ['ADMIN'] })
    expect(findFirstDeptMemberMock).not.toHaveBeenCalled()
  })
})

describe('canAssignToUser', () => {
  const headScope = {
    tenantId: 't1',
    userId: 'u1',
    isTenantWide: false,
    isHead: true,
    headUnitIds: ['dept-1'],
    managedUnitIds: ['dept-1', 'centre-1'],
    canAssign: true,
    canViewReports: true,
    canManageStructure: false,
    canManageMembers: false,
    primaryUnitId: 'dept-1',
    fundingDept: { isMember: false, isHead: false, memberId: null, schoolUnitIds: [] },
  }

  it('allows an assignee inside the managed subtree', async () => {
    findUniqueProfileMock.mockResolvedValue({ org_unit_id: 'centre-1' })
    const { canAssignToUser } = await load()
    const result = await canAssignToUser(headScope, 'u2')
    expect(result.allowed).toBe(true)
    expect(result.assigneeUnitId).toBe('centre-1')
  })

  it('blocks an assignee in a sibling branch, and says why', async () => {
    findUniqueProfileMock.mockResolvedValue({ org_unit_id: 'other-dept' })
    const { canAssignToUser } = await load()
    const result = await canAssignToUser(headScope, 'u2')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('not in a department you manage')
  })

  it('blocks an unplaced assignee for a head but allows one for an admin', async () => {
    findUniqueProfileMock.mockResolvedValue({ org_unit_id: null })
    const { canAssignToUser } = await load()

    expect((await canAssignToUser(headScope, 'u2')).allowed).toBe(false)
    expect(
      (await canAssignToUser({ ...headScope, isTenantWide: true }, 'u2')).allowed
    ).toBe(true)
  })
})

describe('canManageAssignment', () => {
  const headScope = {
    tenantId: 't1',
    userId: 'head',
    isTenantWide: false,
    isHead: true,
    headUnitIds: ['dept-1'],
    managedUnitIds: ['dept-1'],
    canAssign: true,
    canViewReports: true,
    canManageStructure: false,
    canManageMembers: false,
    primaryUnitId: 'dept-1',
    fundingDept: { isMember: false, isHead: false, memberId: null, schoolUnitIds: [] },
  }

  it('keeps the original assigner in control after the assignee moves away', async () => {
    const { canManageAssignment } = await load()
    expect(
      canManageAssignment(headScope, {
        assigned_by_user_id: 'head',
        assignee_org_unit_id: 'far-away-unit',
      })
    ).toBe(true)
  })

  it('lets a head manage anything landing in their subtree', async () => {
    const { canManageAssignment } = await load()
    expect(
      canManageAssignment(headScope, {
        assigned_by_user_id: 'someone-else',
        assignee_org_unit_id: 'dept-1',
      })
    ).toBe(true)
  })

  it('shuts out a head of another branch', async () => {
    const { canManageAssignment } = await load()
    expect(
      canManageAssignment(headScope, {
        assigned_by_user_id: 'someone-else',
        assignee_org_unit_id: 'other-dept',
      })
    ).toBe(false)
  })
})

describe('intersectRequestedUnits', () => {
  const scope = {
    tenantId: 't1',
    userId: 'u1',
    isTenantWide: false,
    isHead: true,
    headUnitIds: ['a'],
    managedUnitIds: ['a', 'b'],
    canAssign: true,
    canViewReports: true,
    canManageStructure: false,
    canManageMembers: false,
    primaryUnitId: 'a',
    fundingDept: { isMember: false, isHead: false, memberId: null, schoolUnitIds: [] },
  }

  it('drops out-of-scope ids so a forged filter cannot widen reach', async () => {
    const { intersectRequestedUnits } = await load()
    expect(intersectRequestedUnits(scope, ['a', 'zzz'])).toEqual(['a'])
  })

  it('falls back to the whole managed set when nothing is requested', async () => {
    const { intersectRequestedUnits } = await load()
    expect(intersectRequestedUnits(scope, [])).toEqual(['a', 'b'])
  })

  it('passes everything through for a tenant-wide caller', async () => {
    const { intersectRequestedUnits } = await load()
    expect(intersectRequestedUnits({ ...scope, isTenantWide: true }, ['anything'])).toEqual([
      'anything',
    ])
  })
})

