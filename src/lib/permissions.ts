import { User } from '@/lib/auth-context'

export type Permission =
  | 'manage_users'
  | 'manage_tenants'
  | 'view_analytics'
  | 'create_projects'
  | 'access_novelty_search'
  | 'manage_ati_tokens'
  | 'view_reports'
  // Persona/Writing Style permissions
  | 'use_persona'              // Can use personas for drafting
  | 'create_own_persona'       // Can create private personas
  | 'create_org_persona'       // Can create organization-wide personas
  | 'manage_org_personas'      // Can edit/delete any org persona

/**
 * Context-aware permission checking that considers tenant type
 * - INDIVIDUAL tenants: Allow multi-role flexibility (analysts can have admin privileges)
 * - ENTERPRISE tenants: Strict role separation (analysts cannot have admin privileges)
 */
export function hasPermission(user: User | null, permission: Permission, tenantType?: 'INDIVIDUAL' | 'ENTERPRISE'): boolean {
  if (!user) return false

  // Super admin always has all permissions
  if (user.roles?.includes('SUPER_ADMIN')) return true

  // Get tenant type - default to ENTERPRISE for safety
  const effectiveTenantType = tenantType || 'ENTERPRISE'

  switch (permission) {
    case 'manage_users':
      if (effectiveTenantType === 'INDIVIDUAL') {
        // In individual tenants, analysts can manage users (since they are the only user)
        return user.roles?.some(role => ['OWNER', 'ADMIN', 'ANALYST'].includes(role)) || false
      } else {
        // In enterprise tenants, only admins can manage users
        return user.roles?.some(role => ['OWNER', 'ADMIN'].includes(role)) || false
      }

    case 'manage_tenants':
      return user.roles?.some(role => ['OWNER', 'ADMIN'].includes(role)) || false

    case 'manage_ati_tokens':
      return user.roles?.some(role => ['OWNER', 'ADMIN'].includes(role)) || false

    case 'view_analytics':
      return user.roles?.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'].includes(role)) || false

    case 'create_projects':
      return user.roles?.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role)) || false

    case 'access_novelty_search':
      return user.roles?.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role)) || false

    case 'view_reports':
      return user.roles?.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'].includes(role)) || false

    // Persona/Writing Style permissions - Analysts MUST have access as they do the actual drafting
    case 'use_persona':
      // Anyone who can draft can use personas
      return user.roles?.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role)) || false

    case 'create_own_persona':
      // Anyone who can draft can create their own private personas
      return user.roles?.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role)) || false

    case 'create_org_persona':
      // Only admins can create organization-wide personas
      return user.roles?.some(role => ['OWNER', 'ADMIN'].includes(role)) || false

    case 'manage_org_personas':
      // Only admins can edit/delete organization personas
      return user.roles?.some(role => ['OWNER', 'ADMIN'].includes(role)) || false

    default:
      return false
  }
}

/**
 * Check if user can perform admin actions based on tenant context
 */
export function canManageUsers(user: User | null, tenantType?: 'INDIVIDUAL' | 'ENTERPRISE'): boolean {
  return hasPermission(user, 'manage_users', tenantType)
}

export function canManageTenants(user: User | null): boolean {
  return hasPermission(user, 'manage_tenants')
}

export function canViewAnalytics(user: User | null): boolean {
  return hasPermission(user, 'view_analytics')
}

export function canCreateProjects(user: User | null): boolean {
  return hasPermission(user, 'create_projects')
}

export function canAccessNoveltySearch(user: User | null): boolean {
  return hasPermission(user, 'access_novelty_search')
}

export function canManageATITokens(user: User | null): boolean {
  return hasPermission(user, 'manage_ati_tokens')
}

// Persona/Writing Style permission helpers
export function canUsePersona(user: User | null): boolean {
  return hasPermission(user, 'use_persona')
}

export function canCreateOwnPersona(user: User | null): boolean {
  return hasPermission(user, 'create_own_persona')
}

export function canCreateOrgPersona(user: User | null): boolean {
  return hasPermission(user, 'create_org_persona')
}

export function canManageOrgPersonas(user: User | null): boolean {
  return hasPermission(user, 'manage_org_personas')
}
