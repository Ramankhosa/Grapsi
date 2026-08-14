import { Prisma } from '@prisma/client';

import prisma from '../prisma';

/**
 * Who a user may act for, in org-hierarchy terms.
 *
 * The rules below ARE the backward-compatibility contract, so they are written
 * once here and consumed everywhere rather than re-derived per route:
 *
 *   SUPER_ADMIN / OWNER / ADMIN / CALL_ADMIN
 *       -> tenant-wide. Unchanged, forever.
 *   Holds >= 1 active OrgUnitManager grant
 *       -> scoped to the union of those units (plus descendants for SUBTREE
 *          grants). Capabilities come from the grants, so a head can assign
 *          without also being CALL_ASSIGNER — that is the delegation.
 *   Active FundingDeptMember with >= 1 covered school
 *       -> scoped to those schools and their descendants, with assign and
 *          report rights. The department head covers every school any member
 *          covers, which is what makes their oversight views dept-wide.
 *   MANAGER / CALL_ASSIGNER with no grant and no coverage,
 *   tenant.org_scope_enforced = false
 *       -> tenant-wide. This is TODAY'S behaviour and the default.
 *   MANAGER / CALL_ASSIGNER with no grant and no coverage,
 *   org_scope_enforced = true
 *       -> no managed scope; cannot assign.
 *   Anyone else -> no managed scope.
 *
 * A tenant with zero rows in org_unit_managers and funding_dept_members and the
 * flag off therefore behaves exactly as it did before these features existed.
 *
 * Note the direction of the department rule: coverage NARROWS a user who would
 * otherwise be a tenant-wide legacy assigner, exactly as a head grant does. That
 * is why department membership is not a UserRole — a role would widen instead,
 * and would keep widening after the schools were taken away.
 *
 * Cost is three indexed queries (grants, coverage, then one shared subtree
 * expansion). Subtree user ids are deliberately NEVER materialized — at 1000+
 * faculty that would blow up every query. Membership is always expressed as a
 * unit-id predicate.
 */

const TENANT_WIDE_ROLES = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'CALL_ADMIN'];
/** Legacy tenant-wide assigners, narrowed only when a tenant opts in. */
const LEGACY_ASSIGNER_ROLES = ['MANAGER', 'CALL_ASSIGNER'];

/** Funding Department standing, as far as org scoping is concerned. */
export interface FundingDeptScope {
  isMember: boolean;
  isHead: boolean;
  memberId: string | null;
  /**
   * Schools reached through department coverage, before subtree expansion.
   * For a member that is their own rota; for the head it is every school the
   * department covers. For "which schools am I personally responsible for",
   * read the membership record (GET /api/funding-dept/me), not this.
   */
  schoolUnitIds: string[];
}

export interface ManagedScope {
  tenantId: string;
  userId: string;
  /** No org narrowing at all — every predicate helper becomes a no-op. */
  isTenantWide: boolean;
  /** Holds at least one active manager grant, or covers at least one school. */
  isHead: boolean;
  /** Units directly granted or covered, without subtree expansion. */
  headUnitIds: string[];
  /** Those units plus descendants of SUBTREE grants and covered schools. Empty when tenant-wide. */
  managedUnitIds: string[];
  canAssign: boolean;
  canViewReports: boolean;
  canManageStructure: boolean;
  canManageMembers: boolean;
  /** Unit stamped onto assignments this user creates, for reporting. */
  primaryUnitId: string | null;
  /**
   * Only populated for non-tenant-wide callers: tenant-wide admins return
   * before the lookup runs, so routes that need an admin's own membership ask
   * GET /api/funding-dept/me instead of reading it from here.
   */
  fundingDept: FundingDeptScope;
}

const NO_FUNDING_DEPT: FundingDeptScope = {
  isMember: false,
  isHead: false,
  memberId: null,
  schoolUnitIds: [],
};

export function emptyScope(tenantId: string, userId: string): ManagedScope {
  return {
    tenantId,
    userId,
    isTenantWide: false,
    isHead: false,
    headUnitIds: [],
    managedUnitIds: [],
    canAssign: false,
    canViewReports: false,
    canManageStructure: false,
    canManageMembers: false,
    primaryUnitId: null,
    fundingDept: NO_FUNDING_DEPT,
  };
}

function hasAnyRole(roles: string[], allowed: string[]) {
  return roles.some((role) => allowed.includes(role));
}

export async function resolveManagedScope(input: {
  tenantId: string;
  userId: string;
  roles: string[];
  /** Tenant.org_scope_enforced — pass through from the auth context. */
  enforceScope?: boolean;
}): Promise<ManagedScope> {
  const { tenantId, userId, roles, enforceScope = false } = input;
  const base = emptyScope(tenantId, userId);

  if (hasAnyRole(roles, TENANT_WIDE_ROLES)) {
    return {
      ...base,
      isTenantWide: true,
      canAssign: true,
      canViewReports: true,
      canManageStructure: true,
      canManageMembers: true,
      primaryUnitId: null,
    };
  }

  const [grants, membership] = await Promise.all([
    prisma.orgUnitManager.findMany({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        is_active: true,
        org_unit: { is_active: true },
      },
      select: {
        org_unit_id: true,
        scope: true,
        can_assign: true,
        can_view_reports: true,
        can_manage_structure: true,
        can_manage_members: true,
      },
      orderBy: { created_at: 'asc' },
    }),
    prisma.fundingDeptMember.findFirst({
      where: { tenant_id: tenantId, user_id: userId, is_active: true },
      select: { id: true, is_head: true },
    }),
  ]);

  // The head answers for the whole department, so their reach is every school
  // any active member covers — that single difference is what makes the
  // oversight dashboards dept-wide without a second code path.
  const coverage = membership
    ? await prisma.fundingDeptSchoolAssignment.findMany({
        where: membership.is_head
          ? { tenant_id: tenantId, member: { is_active: true } }
          : { tenant_id: tenantId, member_id: membership.id },
        select: { org_unit_id: true },
        orderBy: { created_at: 'asc' },
      })
    : [];
  const deptUnitIds = coverage.map((row) => row.org_unit_id);

  const fundingDept: FundingDeptScope = membership
    ? {
        isMember: true,
        isHead: membership.is_head,
        memberId: membership.id,
        schoolUnitIds: deptUnitIds,
      }
    : NO_FUNDING_DEPT;

  if (grants.length === 0 && deptUnitIds.length === 0) {
    // No headship and no schools to look after. Legacy tenant-wide assigners
    // keep their reach unless this tenant has explicitly opted into lockdown.
    if (!enforceScope && hasAnyRole(roles, LEGACY_ASSIGNER_ROLES)) {
      return {
        ...base,
        isTenantWide: true,
        canAssign: true,
        canViewReports: true,
        fundingDept,
      };
    }
    return { ...base, fundingDept };
  }

  const grantUnitIds = grants.map((grant) => grant.org_unit_id);
  const headUnitIds = Array.from(new Set([...grantUnitIds, ...deptUnitIds]));
  // A covered school always includes its departments: chasing a school means
  // chasing everyone under it.
  const subtreeRoots = Array.from(
    new Set([
      ...grants.filter((grant) => grant.scope === 'SUBTREE').map((grant) => grant.org_unit_id),
      ...deptUnitIds,
    ])
  );

  const managed = new Set(headUnitIds);
  if (subtreeRoots.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM tenant_org_units
       WHERE tenant_id = ${tenantId}
         AND is_active = true
         AND path && ARRAY[${Prisma.join(subtreeRoots.map((id) => Prisma.sql`${id}`))}]::text[]
    `);
    for (const row of rows) managed.add(row.id);
  }

  const hasCoverage = deptUnitIds.length > 0;

  return {
    ...base,
    isHead: true,
    headUnitIds,
    managedUnitIds: Array.from(managed),
    canAssign: grants.some((grant) => grant.can_assign) || hasCoverage,
    canViewReports: grants.some((grant) => grant.can_view_reports) || hasCoverage,
    // Structural rights stay with named heads. Covering a school is a chasing
    // duty, not permission to rename it or move people between units.
    canManageStructure: grants.some((grant) => grant.can_manage_structure),
    canManageMembers: grants.some((grant) => grant.can_manage_members),
    // The earliest grant is the unit this person is understood to act for.
    // Department coverage deliberately does NOT set this: one of four covered
    // schools is an arbitrary choice, so resolveAssignerUnitId falls back to
    // the member's own placement instead of inventing an attribution.
    primaryUnitId: grantUnitIds[0] || null,
    fundingDept,
  };
}

/** The org unit an assignment created by this user should be attributed to. */
export async function resolveAssignerUnitId(scope: ManagedScope): Promise<string | null> {
  if (scope.primaryUnitId) return scope.primaryUnitId;
  const profile = await prisma.researcherProfile.findUnique({
    where: { user_id: scope.userId },
    select: { org_unit_id: true },
  });
  return profile?.org_unit_id || null;
}

export interface AssignPermission {
  allowed: boolean;
  assigneeUnitId: string | null;
  reason?: string;
}

/** The authorization question behind POST /api/assignments. */
export async function canAssignToUser(
  scope: ManagedScope,
  assigneeUserId: string
): Promise<AssignPermission> {
  const profile = await prisma.researcherProfile.findUnique({
    where: { user_id: assigneeUserId },
    select: { org_unit_id: true },
  });
  const assigneeUnitId = profile?.org_unit_id || null;

  if (scope.isTenantWide) {
    return { allowed: true, assigneeUnitId };
  }
  if (!scope.canAssign) {
    return {
      allowed: false,
      assigneeUnitId,
      reason: 'You do not have permission to assign funding calls.',
    };
  }
  if (!assigneeUnitId) {
    return {
      allowed: false,
      assigneeUnitId,
      reason:
        'That person is not placed in any department yet, so only an organization admin can assign to them.',
    };
  }
  if (!scope.managedUnitIds.includes(assigneeUnitId)) {
    return {
      allowed: false,
      assigneeUnitId,
      reason: 'That person is not in a department you manage.',
    };
  }
  return { allowed: true, assigneeUnitId };
}

/** Whether an existing assignment falls inside this user's reach. */
export function canManageAssignment(
  scope: ManagedScope,
  assignment: { assigned_by_user_id: string; assignee_org_unit_id: string | null }
): boolean {
  if (scope.isTenantWide) return true;
  // The person who delegated it keeps oversight even if the assignee later
  // moves out of their subtree — otherwise a transfer would orphan the record.
  if (assignment.assigned_by_user_id === scope.userId) return true;
  if (!scope.isHead) return false;
  return Boolean(
    assignment.assignee_org_unit_id &&
      scope.managedUnitIds.includes(assignment.assignee_org_unit_id)
  );
}

/**
 * Client-chosen unit filters, clamped to what the caller may actually see.
 * Tenant-wide callers pass through unchanged.
 */
export function intersectRequestedUnits(scope: ManagedScope, requested: string[]): string[] {
  const wanted = (requested || []).filter(Boolean);
  if (scope.isTenantWide) return wanted;
  if (wanted.length === 0) return scope.managedUnitIds;
  return wanted.filter((id) => scope.managedUnitIds.includes(id));
}

/** `TRUE` when tenant-wide, else a profile-side org predicate for raw SQL. */
export function scopedProfileSql(scope: ManagedScope, alias = 'rp'): Prisma.Sql {
  if (scope.isTenantWide) return Prisma.sql`TRUE`;
  if (scope.managedUnitIds.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(alias)}.org_unit_id = ANY(ARRAY[${Prisma.join(
    scope.managedUnitIds.map((id) => Prisma.sql`${id}`)
  )}]::text[])`;
}

/** `TRUE` when tenant-wide, else the assignee-unit predicate on assignments. */
export function scopedAssignmentSql(scope: ManagedScope, alias = 'ca'): Prisma.Sql {
  if (scope.isTenantWide) return Prisma.sql`TRUE`;
  if (scope.managedUnitIds.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(alias)}.assignee_org_unit_id = ANY(ARRAY[${Prisma.join(
    scope.managedUnitIds.map((id) => Prisma.sql`${id}`)
  )}]::text[])`;
}
