/**
 * Who may read the report archive, and how far.
 *
 * Two surfaces share one implementation:
 *   - platform scope — super admins (and platform staff holding
 *     `platform.support.read`) see every tenant's reports and may narrow to one
 *     tenant with a filter.
 *   - tenant scope — a tenant admin sees only their own tenant's reports. The
 *     tenant is taken from the session, never from the request, so a supplied
 *     `tenantId` can only ever narrow a platform viewer.
 *
 * The archive is read-only by construction: nothing here grants a write, and no
 * route in the module regenerates a report (that would spend a tenant's LLM
 * quota on an administrator's page view).
 */

import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { platformTeamRoleService } from '@/lib/services/platformTeamRoleService'

/** Platform roles that always carry the archive. */
const PLATFORM_CONSOLE_ROLES = ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER']
/**
 * The base role a platform-staff account holds. Platform team-role grants are
 * only honoured on top of it: on the live data those grants (a funding
 * publisher, say) are also handed to ordinary tenant admins, so treating the
 * `platform.support.read` they carry as platform reach would silently let a
 * customer's admin read every other customer's reports.
 */
const PLATFORM_STAFF_ROLE = 'PLATFORM_STAFF'
/**
 * Tenant roles allowed to read every member's reports.
 * QUALITY_AUDITOR is included because the tenant already grants that role
 * cross-project review visibility on /quality-audit; leaving it out here would
 * mean the same person can see the row but not the report behind it.
 */
const TENANT_ROLES = ['OWNER', 'ADMIN', 'QUALITY_AUDITOR']

export type ArchiveScope =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string }

export interface ArchiveViewer {
  user: any
  scope: ArchiveScope
}

export interface ArchiveAccessError {
  response: NextResponse
}

export function isArchiveAccessError(value: unknown): value is ArchiveAccessError {
  return Boolean(value && typeof value === 'object' && 'response' in (value as Record<string, unknown>))
}

function deny(message: string, status: number): ArchiveAccessError {
  return { response: NextResponse.json({ error: message }, { status }) }
}

/**
 * Resolve the caller into a viewer plus the widest scope they hold.
 * Returns `{ response }` — already a NextResponse — when the caller is not
 * entitled, so routes can `if ('response' in viewer) return viewer.response`.
 */
export async function requireArchiveViewer(
  request: NextRequest
): Promise<ArchiveViewer | ArchiveAccessError> {
  const { user, error } = await authenticateUser(request)
  if (error || !user) {
    return deny(error?.message ?? 'Unauthorized', error?.status ?? 401)
  }

  const roles: string[] = user.roles || []

  if (roles.some((role) => PLATFORM_CONSOLE_ROLES.includes(role))) {
    return { user, scope: { kind: 'platform' } }
  }

  // Platform staff carry the archive only through an explicit support grant.
  if (
    roles.includes(PLATFORM_STAFF_ROLE) &&
    (await platformTeamRoleService.hasPlatformPermission(user.id, 'platform.support.read'))
  ) {
    return { user, scope: { kind: 'platform' } }
  }

  if (user.tenantId && roles.some((role) => TENANT_ROLES.includes(role))) {
    return { user, scope: { kind: 'tenant', tenantId: user.tenantId } }
  }

  return deny('You do not have permission to view the report archive.', 403)
}

/**
 * The tenant a listing should be restricted to, after a platform viewer's
 * optional filter is applied. `null` means "every tenant".
 */
export function resolveTenantFilter(scope: ArchiveScope, requestedTenantId: string | null): string | null {
  if (scope.kind === 'tenant') return scope.tenantId
  return requestedTenantId && requestedTenantId !== 'all' ? requestedTenantId : null
}

/** Whether a report owned by `tenantId` is inside the viewer's scope. */
export function scopeAllows(scope: ArchiveScope, tenantId: string | null): boolean {
  if (scope.kind === 'platform') return true
  return tenantId === scope.tenantId
}
