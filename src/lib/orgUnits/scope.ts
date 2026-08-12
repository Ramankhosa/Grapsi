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
 *   MANAGER / CALL_ASSIGNER with no grant, tenant.org_scope_enforced = false
 *       -> tenant-wide. This is TODAY'S behaviour and the default.
 *   MANAGER / CALL_ASSIGNER with no grant, org_scope_enforced = true
 *       -> no managed scope; cannot assign.
 *   Anyone else -> no managed scope.
 *
 * A tenant with zero rows in org_unit_managers and the flag off therefore
 * behaves exactly as it did before this feature existed.
 *
 * Cost is two indexed queries (grants, then subtree expansion). Subtree user
 * ids are deliberately NEVER materialized — at 1000+ faculty that would blow up
 * every query. Membership is always expressed as a unit-id predicate.
 */

const TENANT_WIDE_ROLES = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'CALL_ADMIN'];
/** Legacy tenant-wide assigners, narrowed only when a tenant opts in. */
const LEGACY_ASSIGNER_ROLES = ['MANAGER', 'CALL_ASSIGNER'];

export interface ManagedScope {
  tenantId: string;
  userId: string;
  /** No org narrowing at all — every predicate helper becomes a no-op. */
  isTenantWide: boolean;
  /** Holds at least one active manager grant. */
  isHead: boolean;
  /** Units directly granted, without subtree expansion. */
  headUnitIds: string[];
  /** Granted units plus descendants of SUBTREE grants. Empty when tenant-wide. */
  managedUnitIds: string[];
  canAssign: boolean;
  canViewReports: boolean;
  canManageStructure: boolean;
  canManageMembers: boolean;
  /** Unit stamped onto assignments this user creates, for reporting. */
  primaryUnitId: string | null;
}

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

  const grants = await prisma.orgUnitManager.findMany({
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
  });

  if (grants.length === 0) {
    // No headship. Legacy tenant-wide assigners keep their reach unless this
    // tenant has explicitly opted into lockdown.
    if (!enforceScope && hasAnyRole(roles, LEGACY_ASSIGNER_ROLES)) {
      return {
        ...base,
        isTenantWide: true,
        canAssign: true,
        canViewReports: true,
      };
    }
    return base;
  }

  const headUnitIds = grants.map((grant) => grant.org_unit_id);
  const subtreeRoots = grants
    .filter((grant) => grant.scope === 'SUBTREE')
    .map((grant) => grant.org_unit_id);

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

  return {
    ...base,
    isHead: true,
    headUnitIds,
    managedUnitIds: Array.from(managed),
    canAssign: grants.some((grant) => grant.can_assign),
    canViewReports: grants.some((grant) => grant.can_view_reports),
    canManageStructure: grants.some((grant) => grant.can_manage_structure),
    canManageMembers: grants.some((grant) => grant.can_manage_members),
    // The earliest grant is the unit this person is understood to act for.
    primaryUnitId: headUnitIds[0] || null,
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
