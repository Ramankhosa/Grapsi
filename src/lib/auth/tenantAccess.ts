import { NextRequest } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { resolveManagedScope, type ManagedScope } from '@/lib/orgUnits/scope'

/**
 * Shared tenant guards for the org-structure, faculty and assignment routes.
 *
 * Every one of these features is tenant-scoped: an admin only ever manages
 * their own organization's faculty, and a faculty member only ever sees their
 * own assignments. Callers must use `tenantId` from the returned context rather
 * than anything supplied by the client.
 */

/** Full tenant admin — the only tier allowed to grant/revoke user roles. */
export const TENANT_ADMIN_ROLES = ['OWNER', 'ADMIN']
/**
 * Scoped tenant admin: OWNER/ADMIN plus the additive CALL_ADMIN tag.
 * CALL_ADMIN can touch the org tree, faculty roster and invite flow but
 * cannot elevate roles (that stays TENANT_ADMIN_ROLES).
 */
export const TENANT_SCOPED_ADMIN_ROLES = ['OWNER', 'ADMIN', 'CALL_ADMIN']
/** Roles allowed to assign a funding call to a faculty member. */
export const TENANT_ASSIGNER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CALL_ASSIGNER', 'CALL_ADMIN']

export interface TenantContext {
  user: any
  tenantId: string
  isAdmin: boolean
  isAssigner: boolean
  isCallAdmin: boolean
}

export interface TenantAccessError {
  error: string
  status: number
}

function hasAnyRole(roles: string[] | undefined, allowed: string[]) {
  return Boolean(roles?.some((role) => allowed.includes(role)))
}

/** Any authenticated user that belongs to a tenant. */
export async function requireTenantUser(
  request: NextRequest
): Promise<TenantContext | TenantAccessError> {
  const { user, error } = await authenticateUser(request)
  if (error || !user) {
    return { error: error?.message ?? 'Unauthorized', status: error?.status ?? 401 }
  }
  if (!user.tenantId) {
    return { error: 'A tenant account is required to use this feature.', status: 403 }
  }

  const roles: string[] = user.roles || []
  const isSuperAdmin = roles.includes('SUPER_ADMIN')

  return {
    user,
    tenantId: user.tenantId,
    isAdmin: isSuperAdmin || hasAnyRole(roles, TENANT_ADMIN_ROLES),
    isAssigner: isSuperAdmin || hasAnyRole(roles, TENANT_ASSIGNER_ROLES),
    isCallAdmin: isSuperAdmin || hasAnyRole(roles, TENANT_SCOPED_ADMIN_ROLES),
  }
}

/** A tenant user holding one of `allowed` (super admins always pass). */
export async function requireTenantRoles(
  request: NextRequest,
  allowed: string[] = TENANT_ADMIN_ROLES
): Promise<TenantContext | TenantAccessError> {
  const context = await requireTenantUser(request)
  if ('error' in context) {
    return context
  }

  const roles: string[] = context.user.roles || []
  if (!roles.includes('SUPER_ADMIN') && !hasAnyRole(roles, allowed)) {
    return { error: 'You do not have permission to perform this action.', status: 403 }
  }
  return context
}

export function isAccessError(
  value: TenantContext | TenantScopeContext | TenantAccessError
): value is TenantAccessError {
  return 'error' in value
}

export interface TenantScopeContext extends TenantContext {
  scope: ManagedScope
}

/**
 * Per-request memo so a route that needs the scope twice pays for it once.
 * Keyed on the context object itself, which lives exactly as long as the
 * request does.
 */
const scopeCache = new WeakMap<TenantContext, Promise<ManagedScope>>()

/**
 * Attaches org-hierarchy scope to a context you already hold.
 *
 * Deliberately NOT folded into `requireTenantUser`: plenty of routes (a
 * researcher reading their own notifications, an assignee opening their own
 * assignment) do not care about org scope, and charging them two extra queries
 * would be a regression on the common path.
 */
export async function withOrgScope(context: TenantContext): Promise<TenantScopeContext> {
  let pending = scopeCache.get(context)
  if (!pending) {
    pending = resolveManagedScope({
      tenantId: context.tenantId,
      userId: context.user.id,
      roles: context.user.roles || [],
      // `tenant` is already loaded by authenticateUser's include, so reading
      // the flag here costs nothing extra.
      enforceScope: Boolean(context.user.tenant?.org_scope_enforced),
    })
    scopeCache.set(context, pending)
  }
  return { ...context, scope: await pending }
}

/** requireTenantUser + org scope, for routes that narrow by hierarchy. */
export async function requireTenantScope(
  request: NextRequest
): Promise<TenantScopeContext | TenantAccessError> {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return context
  }
  return withOrgScope(context)
}
