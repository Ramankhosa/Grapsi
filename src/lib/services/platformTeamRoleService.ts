import { Prisma } from '@/lib/prisma-generated';

import prisma from '../prisma';
import {
  PLATFORM_PERMISSION_DEFINITIONS,
  PLATFORM_ROLE_DEFINITIONS,
  getPermissionsForRoleCodes,
  isPlatformPermissionCode,
  isPlatformRoleCode,
  type PlatformPermissionCode,
  type PlatformRoleCode,
} from '../platformTeamRoles';

export interface PlatformTeamRoleAssignmentRecord {
  id: string;
  roleCode: PlatformRoleCode;
  assignedByUserId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformTeamRoleUserRecord {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  status: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantAtiId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedRoleCodes: PlatformRoleCode[];
  permissions: PlatformPermissionCode[];
}

type PlatformUserRow = {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  status: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantAtiId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AssignmentRow = {
  id: string;
  userId: string;
  roleCode: string;
  assignedByUserId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface PlatformTeamRoleUserFilters {
  query?: string | null;
  roleCode?: string | null;
  status?: string | null;
}

function normalizeRoleCodes(roleCodes: string[]): PlatformRoleCode[] {
  const unique = Array.from(new Set(roleCodes.map((roleCode) => String(roleCode || '').trim()).filter(Boolean)));
  const invalid = unique.filter((roleCode) => !isPlatformRoleCode(roleCode));
  if (invalid.length > 0) {
    throw new Error(`Unknown platform role code: ${invalid.join(', ')}`);
  }
  return unique as PlatformRoleCode[];
}

function serializeAssignment(row: AssignmentRow): PlatformTeamRoleAssignmentRecord {
  return {
    id: row.id,
    roleCode: row.roleCode as PlatformRoleCode,
    assignedByUserId: row.assignedByUserId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeUser(row: PlatformUserRow, assignedRoleCodes: PlatformRoleCode[]): PlatformTeamRoleUserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    roles: Array.isArray(row.roles) ? row.roles : [],
    status: row.status,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tenantAtiId: row.tenantAtiId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedRoleCodes,
    permissions: getPermissionsForRoleCodes(assignedRoleCodes),
  };
}

function buildPlatformUserBaseCondition() {
  return Prisma.sql`(
    tenant."atiId" = 'PLATFORM'
    OR 'SUPER_ADMIN' = ANY(ARRAY(SELECT unnest(u.roles)::text))
    OR 'SUPER_ADMIN_VIEWER' = ANY(ARRAY(SELECT unnest(u.roles)::text))
  )`;
}

async function isPlatformUser(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT u.id
    FROM users u
    LEFT JOIN tenants tenant ON tenant.id = u."tenantId"
    WHERE u.id = ${userId}
      AND ${buildPlatformUserBaseCondition()}
    LIMIT 1
  `);

  return rows.length > 0;
}

export class PlatformTeamRoleService {
  getDefinitions() {
    return {
      roles: PLATFORM_ROLE_DEFINITIONS,
      permissions: PLATFORM_PERMISSION_DEFINITIONS,
    };
  }

  async listUsers(filters: PlatformTeamRoleUserFilters = {}): Promise<PlatformTeamRoleUserRecord[]> {
    const conditions: Prisma.Sql[] = [buildPlatformUserBaseCondition()];
    const query = String(filters.query || '').trim();
    const status = String(filters.status || '').trim().toUpperCase();
    const roleCode = String(filters.roleCode || '').trim();

    if (query) {
      const likeQuery = `%${query.toLowerCase()}%`;
      conditions.push(Prisma.sql`(
        LOWER(u.id) LIKE ${likeQuery}
        OR LOWER(u.email) LIKE ${likeQuery}
        OR LOWER(COALESCE(u.name, '')) LIKE ${likeQuery}
        OR LOWER(COALESCE(u."firstName", '')) LIKE ${likeQuery}
        OR LOWER(COALESCE(u."lastName", '')) LIKE ${likeQuery}
      )`);
    }

    if (status && ['ACTIVE', 'SUSPENDED'].includes(status)) {
      conditions.push(Prisma.sql`u.status::text = ${status}`);
    }

    if (roleCode) {
      if (!isPlatformRoleCode(roleCode)) {
        throw new Error(`Unknown platform role code: ${roleCode}`);
      }
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM platform_team_role_assignments assignment_filter
        WHERE assignment_filter.user_id = u.id
          AND assignment_filter.role_code = ${roleCode}
          AND assignment_filter.is_active = true
      )`);
    }

    const where = conditions.reduce((combined, condition, index) => {
      if (index === 0) return condition;
      return Prisma.sql`${combined} AND ${condition}`;
    }, Prisma.sql`TRUE`);

    const userRows = await prisma.$queryRaw<PlatformUserRow[]>(Prisma.sql`
      SELECT
        u.id,
        u.email,
        u.name,
        u."firstName",
        u."lastName",
        u.roles,
        u.status::text AS status,
        u."tenantId",
        tenant.name AS "tenantName",
        tenant."atiId" AS "tenantAtiId",
        u."createdAt",
        u."updatedAt"
      FROM users u
      LEFT JOIN tenants tenant ON tenant.id = u."tenantId"
      WHERE ${where}
      ORDER BY u."createdAt" DESC
      LIMIT 200
    `);

    const assignments = await this.listAssignmentsForUsers(userRows.map((user) => user.id));
    return userRows.map((user) => serializeUser(user, assignments.get(user.id) || []));
  }

  async listAssignmentsForUsers(userIds: string[]): Promise<Map<string, PlatformRoleCode[]>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = await prisma.$queryRaw<Array<{ userId: string; roleCode: string }>>(Prisma.sql`
      SELECT user_id AS "userId", role_code AS "roleCode"
      FROM platform_team_role_assignments
      WHERE is_active = true
        AND user_id IN (${Prisma.join(userIds.map((userId) => Prisma.sql`${userId}`))})
      ORDER BY role_code ASC
    `);

    const grouped = new Map<string, PlatformRoleCode[]>();
    rows.forEach((row) => {
      if (!isPlatformRoleCode(row.roleCode)) {
        return;
      }
      grouped.set(row.userId, [...(grouped.get(row.userId) || []), row.roleCode]);
    });

    return grouped;
  }

  async getUserRoleCodes(userId: string): Promise<PlatformRoleCode[]> {
    const assignments = await this.listAssignmentsForUsers([userId]);
    return assignments.get(userId) || [];
  }

  async getUserPermissions(userId: string): Promise<PlatformPermissionCode[]> {
    const roleCodes = await this.getUserRoleCodes(userId);
    return getPermissionsForRoleCodes(roleCodes);
  }

  async hasPlatformPermission(userId: string, permissionCode: PlatformPermissionCode): Promise<boolean> {
    if (!isPlatformPermissionCode(permissionCode)) {
      return false;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { roles: true },
    });

    if (!user) {
      return false;
    }

    if ((user.roles || []).includes('SUPER_ADMIN')) {
      return true;
    }

    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permissionCode);
  }

  async replaceUserRoles(input: {
    targetUserId: string;
    roleCodes: string[];
    assignedByUserId: string;
  }): Promise<{
    assignments: PlatformTeamRoleAssignmentRecord[];
    assignedRoleCodes: PlatformRoleCode[];
    permissions: PlatformPermissionCode[];
  }> {
    const roleCodes = normalizeRoleCodes(input.roleCodes);
    const targetIsPlatformUser = await isPlatformUser(input.targetUserId);
    if (!targetIsPlatformUser) {
      throw new Error('Platform user not found');
    }

    const previousRoleCodes = await this.getUserRoleCodes(input.targetUserId);
    const previousSet = new Set(previousRoleCodes);
    const nextSet = new Set(roleCodes);
    const added = roleCodes.filter((roleCode) => !previousSet.has(roleCode));
    const removed = previousRoleCodes.filter((roleCode) => !nextSet.has(roleCode));

    await prisma.$transaction(async (tx) => {
      if (roleCodes.length === 0) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE platform_team_role_assignments
          SET is_active = false,
              updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ${input.targetUserId}
            AND is_active = true
        `);
      } else {
        await tx.$executeRaw(Prisma.sql`
          UPDATE platform_team_role_assignments
          SET is_active = false,
              updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ${input.targetUserId}
            AND role_code NOT IN (${Prisma.join(roleCodes.map((roleCode) => Prisma.sql`${roleCode}`))})
            AND is_active = true
        `);

        for (const roleCode of roleCodes) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO platform_team_role_assignments (
              id, user_id, role_code, assigned_by_user_id, is_active, created_at, updated_at
            )
            VALUES (
              ${cryptoRandomId()},
              ${input.targetUserId},
              ${roleCode},
              ${input.assignedByUserId},
              true,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT (user_id, role_code)
            DO UPDATE SET
              assigned_by_user_id = EXCLUDED.assigned_by_user_id,
              is_active = true,
              updated_at = CURRENT_TIMESTAMP
          `);
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: input.assignedByUserId,
          action: 'PLATFORM_TEAM_ROLE_ASSIGNMENT_REPLACE',
          resource: `user:${input.targetUserId}`,
          meta: {
            targetUserId: input.targetUserId,
            previousRoleCodes,
            roleCodes,
            added,
            removed,
          },
        },
      });
    });

    const assignments = await this.listAssignments(input.targetUserId);
    const assignedRoleCodes = assignments.map((assignment) => assignment.roleCode);
    return {
      assignments,
      assignedRoleCodes,
      permissions: getPermissionsForRoleCodes(assignedRoleCodes),
    };
  }

  async listAssignments(userId: string): Promise<PlatformTeamRoleAssignmentRecord[]> {
    const rows = await prisma.$queryRaw<AssignmentRow[]>(Prisma.sql`
      SELECT
        id,
        user_id AS "userId",
        role_code AS "roleCode",
        assigned_by_user_id AS "assignedByUserId",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM platform_team_role_assignments
      WHERE user_id = ${userId}
        AND is_active = true
      ORDER BY role_code ASC
    `);

    return rows
      .filter((row) => isPlatformRoleCode(row.roleCode))
      .map((row) => serializeAssignment(row));
  }
}

function cryptoRandomId() {
  return `ptr_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Grant platform team roles to a brand-new account inside the caller's own
 * transaction.
 *
 * `replaceUserRoles` cannot serve this case: it opens a transaction of its own
 * and pre-checks `isPlatformUser`, which reads a row that does not exist yet
 * when provisioning is mid-flight. Provisioning has already established the
 * account belongs to the PLATFORM tenant, so the check would be redundant
 * anyway — and doing the grant in the same transaction as the insert means an
 * admin never ends up with a staff account that silently has no capabilities.
 *
 * Insert-only by design: a user created moments ago has nothing to revoke.
 */
export async function grantPlatformRolesInTransaction(
  tx: Prisma.TransactionClient,
  input: { targetUserId: string; roleCodes: string[]; assignedByUserId: string }
): Promise<PlatformRoleCode[]> {
  const roleCodes = normalizeRoleCodes(input.roleCodes);
  if (roleCodes.length === 0) {
    return [];
  }

  for (const roleCode of roleCodes) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO platform_team_role_assignments (
        id, user_id, role_code, assigned_by_user_id, is_active, created_at, updated_at
      )
      VALUES (
        ${cryptoRandomId()},
        ${input.targetUserId},
        ${roleCode},
        ${input.assignedByUserId},
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (user_id, role_code)
      DO UPDATE SET
        assigned_by_user_id = EXCLUDED.assigned_by_user_id,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
    `);
  }

  await tx.auditLog.create({
    data: {
      actorUserId: input.assignedByUserId,
      action: 'PLATFORM_TEAM_ROLE_ASSIGNMENT_GRANT',
      resource: `user:${input.targetUserId}`,
      meta: {
        targetUserId: input.targetUserId,
        roleCodes,
        grantedAtProvisioning: true,
      },
    },
  });

  return roleCodes;
}

/** Validate role codes without touching the database. */
export function parsePlatformRoleCodes(roleCodes: string[]): PlatformRoleCode[] {
  return normalizeRoleCodes(roleCodes);
}

export const platformTeamRoleService = new PlatformTeamRoleService();

export async function getUserPlatformRoleCodes(userId: string): Promise<PlatformRoleCode[]> {
  return platformTeamRoleService.getUserRoleCodes(userId);
}

export async function getUserPlatformPermissionCodes(userId: string): Promise<PlatformPermissionCode[]> {
  return platformTeamRoleService.getUserPermissions(userId);
}

export async function hasPlatformPermission(
  userId: string,
  permissionCode: PlatformPermissionCode
): Promise<boolean> {
  return platformTeamRoleService.hasPlatformPermission(userId, permissionCode);
}
