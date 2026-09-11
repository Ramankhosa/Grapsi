/**
 * Who may read the audit log, and how far.
 *
 * Deliberately the same shape as `reportsArchive/access.ts`, down to the return
 * type, because it answers the same question about a different table and a
 * second, subtly different implementation of "platform scope" is how one of them
 * eventually leaks. Read that file alongside this one.
 *
 * The one difference that matters: `QUALITY_AUDITOR` reads the report archive
 * but not this. That role exists to check whether AI output is defensible, which
 * is a question about work product. Who was granted which role, and who reset
 * whose password, is a question about people, and it stays with the two roles
 * that can already change those things.
 */

import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { platformTeamRoleService } from '@/lib/services/platformTeamRoleService'

const PLATFORM_CONSOLE_ROLES = ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER']
/**
 * Platform team-role grants are only honoured on top of this base role. On the
 * live data those grants are also handed to ordinary tenant admins, so treating
 * the `platform.support.read` they carry as platform reach would let a
 * customer's admin read every other customer's audit trail.
 */
const PLATFORM_STAFF_ROLE = 'PLATFORM_STAFF'
const TENANT_ROLES = ['OWNER', 'ADMIN']

export type AuditScope = { kind: 'platform' } | { kind: 'tenant'; tenantId: string }

export interface AuditViewer {
  user: any
  scope: AuditScope
}

export interface AuditAccessError {
  response: NextResponse
}

export function isAuditAccessError(value: unknown): value is AuditAccessError {
  return Boolean(value && typeof value === 'object' && 'response' in (value as Record<string, unknown>))
}

function deny(message: string, status: number): AuditAccessError {
  return { response: NextResponse.json({ error: message }, { status }) }
}

export async function requireAuditViewer(
  request: NextRequest
): Promise<AuditViewer | AuditAccessError> {
  const { user, error } = await authenticateUser(request)
  if (error || !user) {
    return deny(error?.message ?? 'Unauthorized', error?.status ?? 401)
  }

  const roles: string[] = user.roles || []

  if (roles.some((role) => PLATFORM_CONSOLE_ROLES.includes(role))) {
    return { user, scope: { kind: 'platform' } }
  }

  if (
    roles.includes(PLATFORM_STAFF_ROLE) &&
    (await platformTeamRoleService.hasPlatformPermission(user.id, 'platform.support.read'))
  ) {
    return { user, scope: { kind: 'platform' } }
  }

  if (user.tenantId && roles.some((role) => TENANT_ROLES.includes(role))) {
    return { user, scope: { kind: 'tenant', tenantId: user.tenantId } }
  }

  return deny('You do not have permission to view the audit trail.', 403)
}

/**
 * The tenant a listing is restricted to. `null` means every tenant, which only a
 * platform viewer can reach — a tenant viewer's own id always wins over anything
 * the request asked for.
 */
export function resolveAuditTenantFilter(
  scope: AuditScope,
  requestedTenantId: string | null
): string | null {
  if (scope.kind === 'tenant') return scope.tenantId
  return requestedTenantId && requestedTenantId !== 'all' ? requestedTenantId : null
}
