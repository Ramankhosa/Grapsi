/**
 * Organization Access Service
 * 
 * Centralized service for organizational structure, role management,
 * and team management within tenants.
 * 
 * IMPORTANT: LLM MODEL ACCESS CONTROL IS HANDLED SEPARATELY
 * - LLM model access is controlled by Super Admin via PlanLLMAccess
 * - This service handles organizational permissions (roles, teams)
 * - Team/User service toggles are for UI-level feature visibility
 * - They do NOT affect LLM gateway access (that's plan-based only)
 * 
 * PATENT DRAFTING QUOTA:
 * - Patent drafting quota is counted by PATENTS, not LLM tokens
 * - A patent counts toward quota when essential sections are drafted:
 *   - detailedDescription (required)
 *   - claims (required)
 * - Uses PatentDraftingUsage table for tracking
 * 
 * Use Cases:
 * - Role management (OWNER/ADMIN can change user roles)
 * - Team management (create teams, add/remove members)
 * - Feature visibility (hide Patent Drafting from certain teams in UI)
 * 
 * NOT for:
 * - LLM model routing (Super Admin only)
 */

import { prisma } from './prisma'
import { TaskCode } from '@/lib/prisma-generated'
import type { UserRole, ServiceType, TeamRole } from '@/lib/prisma-generated'
import { getPatentDraftingQuota } from './patent-drafting-tracker'
import { checkServiceQuota, getServiceUsage } from './service-usage-tracker'
import { checkTrialQuotaForService } from './trial-plan-service'
import { ensureTenantEntitlementForSignup, getActiveTenantEntitlement } from './entitlement-service'

// ============================================================================
// Types
// ============================================================================

export interface UserContext {
  userId: string
  tenantId: string
  roles: UserRole[]
  email?: string
}

export interface ServiceAccessResult {
  allowed: boolean
  reason?: string
  remainingQuota?: {
    daily: number | null   // null = unlimited
    monthly: number | null // null = unlimited
  }
  quotaSource?: 'user' | 'team' | 'tenant'
}

export interface TeamInfo {
  id: string
  name: string
  description: string | null
  role: TeamRole
  isLead: boolean
}

export interface UserWithTeams {
  id: string
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  roles: UserRole[]
  status: string
  teams: TeamInfo[]
  createdAt: Date
}

// Role hierarchy for permission checks. Additive tags don't participate in
// the hierarchy (a CALL_ASSIGNER is not "above" a VIEWER); they resolve to 0
// so getHighestRole falls through to whichever hierarchy role the user has.
const ROLE_HIERARCHY: Record<string, number> = {
  SUPER_ADMIN: 100,
  SUPER_ADMIN_VIEWER: 90,
  OWNER: 80,
  ADMIN: 70,
  MANAGER: 50,
  ANALYST: 30,
  VIEWER: 10,
  MEMBER: 5,
  CALL_ASSIGNER: 0,
  CALL_ADMIN: 0,
  QUALITY_AUDITOR: 0,
}

// Roles that can manage users
const USER_MANAGEMENT_ROLES: UserRole[] = ['OWNER', 'ADMIN']

/**
 * Additive tenant-scoped tags. These live outside ROLE_HIERARCHY; a user can
 * hold any subset alongside one hierarchy role. Granting them is a plain
 * add/remove operation, not a promote/demote.
 *
 * Cast: the generated Prisma client may still be one generate cycle behind
 * the schema on shared dev boxes; the underlying Postgres enum has these
 * values via migration, so the string cast is safe.
 */
const ADDITIVE_ROLES: UserRole[] = ['MEMBER', 'CALL_ASSIGNER', 'CALL_ADMIN', 'QUALITY_AUDITOR'] as UserRole[]
/**
 * Roles anyone below OWNER must not grant. Prevents a CALL_ADMIN (which
 * gates the scoped admin surface) from minting more admins or another
 * CALL_ADMIN.
 */
const OWNER_ONLY_GRANTABLE_ROLES: UserRole[] = ['OWNER', 'ADMIN', 'CALL_ADMIN'] as UserRole[]

// Roles that can manage teams
const TEAM_MANAGEMENT_ROLES: UserRole[] = ['OWNER', 'ADMIN', 'MANAGER']

// Service to FeatureCode mapping
const SERVICE_TO_FEATURE: Record<ServiceType, string> = {
  PATENT_DRAFTING: 'PATENT_DRAFTING',
  NOVELTY_SEARCH: 'PRIOR_ART_SEARCH', // Maps to same feature
  PRIOR_ART_SEARCH: 'PRIOR_ART_SEARCH',
  IDEA_BANK: 'IDEA_BANK',
  PERSONA_SYNC: 'PERSONA_SYNC',
  DIAGRAM_GENERATION: 'DIAGRAM_GENERATION',
  PATENT_REVIEW: 'PATENT_REVIEW',      // Pro tier feature
  IDEATION: 'IDEATION',
  FUNDING_DISCOVERY: 'FUNDING_DISCOVERY',
  GRANT_PREP: 'GRANT_PREP',
  GRANT_DRAFTING: 'GRANT_DRAFTING',
  FUNDING_CHAT: 'FUNDING_CHAT',
  FUNDING_INTELLIGENCE: 'FUNDING_INTELLIGENCE',
  GRANT_REVIEW: 'GRANT_REVIEW'
}

// Roles that can use each service (default, can be overridden by team/user settings)
const SERVICE_DEFAULT_ROLES: Record<ServiceType, UserRole[]> = {
  PATENT_DRAFTING: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  NOVELTY_SEARCH: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  PRIOR_ART_SEARCH: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  IDEA_BANK: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  PERSONA_SYNC: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  DIAGRAM_GENERATION: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  PATENT_REVIEW: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],  // Pro tier feature - role access same, quota-controlled
  IDEATION: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  FUNDING_DISCOVERY: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  GRANT_PREP: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  GRANT_DRAFTING: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  FUNDING_CHAT: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  FUNDING_INTELLIGENCE: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'],
  GRANT_REVIEW: ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']
}

function isServiceQuotaExempt(serviceType: ServiceType): boolean {
  return serviceType === 'GRANT_PREP'
}

// ============================================================================
// Role Management
// ============================================================================

/**
 * Check if a user can change another user's role
 */
export function canChangeRole(
  actorRoles: UserRole[],
  targetCurrentRole: UserRole,
  newRole: UserRole
): { allowed: boolean; reason?: string } {
  // Get the highest role of the actor
  const actorHighestRole = getHighestRole(actorRoles)
  
  // Only OWNER and ADMIN can change roles
  if (!actorRoles.some(r => USER_MANAGEMENT_ROLES.includes(r))) {
    return { allowed: false, reason: 'Only OWNER or ADMIN can change user roles' }
  }
  
  // Cannot promote to a role higher than or equal to your own
  if (ROLE_HIERARCHY[newRole] >= ROLE_HIERARCHY[actorHighestRole]) {
    return { allowed: false, reason: 'Cannot promote to a role equal or higher than your own' }
  }
  
  // Cannot demote someone with equal or higher role
  if (ROLE_HIERARCHY[targetCurrentRole] >= ROLE_HIERARCHY[actorHighestRole]) {
    return { allowed: false, reason: 'Cannot modify role of user with equal or higher role' }
  }
  
  // Cannot assign SUPER_ADMIN roles
  if (newRole === 'SUPER_ADMIN' || newRole === 'SUPER_ADMIN_VIEWER') {
    return { allowed: false, reason: 'Cannot assign super admin roles through tenant management' }
  }
  
  return { allowed: true }
}

/**
 * Get the highest role from an array of roles
 */
export function getHighestRole(roles: UserRole[]): UserRole {
  return roles.reduce((highest, current) => 
    ROLE_HIERARCHY[current] > ROLE_HIERARCHY[highest] ? current : highest
  , 'VIEWER' as UserRole)
}

/**
 * Whether an actor can grant `role` to any target in their tenant.
 * Used for the additive role tags (CALL_ADMIN/CALL_ASSIGNER/MEMBER),
 * where semantics are "add to the array" rather than replace-in-hierarchy.
 */
export function canAddRole(
  actorRoles: UserRole[],
  role: UserRole
): { allowed: boolean; reason?: string } {
  if (role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER') {
    return { allowed: false, reason: 'Cannot assign super admin roles through tenant management' }
  }
  // Only OWNER/ADMIN can touch roles at all.
  if (!actorRoles.some(r => USER_MANAGEMENT_ROLES.includes(r))) {
    return { allowed: false, reason: 'Only OWNER or ADMIN can change user roles' }
  }
  // OWNER-only escalations (grant ADMIN or CALL_ADMIN) require OWNER.
  if (OWNER_ONLY_GRANTABLE_ROLES.includes(role) && !actorRoles.includes('OWNER')) {
    return { allowed: false, reason: `Only OWNER can grant ${role}` }
  }
  // OWNER is the ceiling — nobody grants OWNER via this path.
  if (role === 'OWNER' && !actorRoles.includes('OWNER')) {
    return { allowed: false, reason: 'Only OWNER can grant OWNER' }
  }
  return { allowed: true }
}

export function canRemoveRole(
  actorRoles: UserRole[],
  role: UserRole
): { allowed: boolean; reason?: string } {
  if (!actorRoles.some(r => USER_MANAGEMENT_ROLES.includes(r))) {
    return { allowed: false, reason: 'Only OWNER or ADMIN can change user roles' }
  }
  if (role === 'OWNER' && !actorRoles.includes('OWNER')) {
    return { allowed: false, reason: 'Only OWNER can remove OWNER' }
  }
  return { allowed: true }
}

async function assertSameTenant(
  actorContext: UserContext,
  targetUserId: string
): Promise<{ ok: true; targetUser: { id: string; roles: UserRole[]; email: string } } | { ok: false; error: string }> {
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, tenantId: true, roles: true, email: true }
  })
  if (!targetUser) {
    return { ok: false, error: 'User not found' }
  }
  if (targetUser.tenantId !== actorContext.tenantId) {
    return { ok: false, error: 'Cannot modify users from different tenant' }
  }
  return { ok: true, targetUser: { id: targetUser.id, roles: targetUser.roles, email: targetUser.email } }
}

/**
 * Add an additive/tag role to a user's role array. Idempotent — no-op if the
 * user already holds `role`. Never touches roles the caller isn't allowed to
 * grant (guarded by `canAddRole`).
 */
export async function addUserRole(
  actorContext: UserContext,
  targetUserId: string,
  role: UserRole
): Promise<{ success: boolean; roles?: UserRole[]; error?: string }> {
  const check = canAddRole(actorContext.roles, role)
  if (!check.allowed) return { success: false, error: check.reason }

  const target = await assertSameTenant(actorContext, targetUserId)
  if (!target.ok) return { success: false, error: target.error }

  const current = target.targetUser.roles
  if (current.includes(role)) {
    return { success: true, roles: current }
  }
  const nextRoles = Array.from(new Set([...current, role])) as UserRole[]

  await prisma.user.update({
    where: { id: targetUserId },
    data: { roles: nextRoles }
  })

  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'USER_ROLE_ADD',
      resource: `user:${targetUserId}`,
      meta: { role, previousRoles: current, newRoles: nextRoles, targetEmail: target.targetUser.email }
    }
  })

  return { success: true, roles: nextRoles }
}

/**
 * Remove a role from a user. If the resulting array would be empty the user
 * falls back to `['MEMBER']` — a role-less user would silently lose every
 * gate that keys on `user.roles`.
 */
export async function removeUserRole(
  actorContext: UserContext,
  targetUserId: string,
  role: UserRole
): Promise<{ success: boolean; roles?: UserRole[]; error?: string }> {
  const check = canRemoveRole(actorContext.roles, role)
  if (!check.allowed) return { success: false, error: check.reason }

  const target = await assertSameTenant(actorContext, targetUserId)
  if (!target.ok) return { success: false, error: target.error }

  const current = target.targetUser.roles
  if (!current.includes(role)) {
    return { success: true, roles: current }
  }

  // Guard: never let a non-OWNER remove OWNER from anyone.
  if (role === 'OWNER' && !actorContext.roles.includes('OWNER')) {
    return { success: false, error: 'Only OWNER can remove OWNER' }
  }

  let nextRoles = current.filter(r => r !== role)
  if (nextRoles.length === 0) {
    // See ADDITIVE_ROLES note: string cast covers stale generated client.
    nextRoles = ['MEMBER'] as UserRole[]
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { roles: nextRoles }
  })

  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'USER_ROLE_REMOVE',
      resource: `user:${targetUserId}`,
      meta: { role, previousRoles: current, newRoles: nextRoles, targetEmail: target.targetUser.email }
    }
  })

  return { success: true, roles: nextRoles }
}

/**
 * Change a user's role
 */
export async function changeUserRole(
  actorContext: UserContext,
  targetUserId: string,
  newRole: UserRole
): Promise<{ success: boolean; error?: string }> {
  // Get target user
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, tenantId: true, roles: true, email: true }
  })
  
  if (!targetUser) {
    return { success: false, error: 'User not found' }
  }
  
  // Ensure same tenant
  if (targetUser.tenantId !== actorContext.tenantId) {
    return { success: false, error: 'Cannot modify users from different tenant' }
  }
  
  // Check permission
  const targetCurrentRole = getHighestRole(targetUser.roles)
  const check = canChangeRole(actorContext.roles, targetCurrentRole, newRole)
  
  if (!check.allowed) {
    return { success: false, error: check.reason }
  }
  
  // Update role
  await prisma.user.update({
    where: { id: targetUserId },
    data: { roles: [newRole] }
  })
  
  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'USER_ROLE_CHANGE',
      resource: `user:${targetUserId}`,
      meta: {
        previousRole: targetCurrentRole,
        newRole,
        targetEmail: targetUser.email
      }
    }
  })
  
  return { success: true }
}

// ============================================================================
// Team Management
// ============================================================================

/**
 * Create a new team
 */
export async function createTeam(
  actorContext: UserContext,
  name: string,
  description?: string,
  isDefault?: boolean
): Promise<{ success: boolean; team?: any; error?: string }> {
  // Check permission
  if (!actorContext.roles.some(r => TEAM_MANAGEMENT_ROLES.includes(r))) {
    return { success: false, error: 'Insufficient permissions to create teams' }
  }
  
  // Check for duplicate name
  const existing = await prisma.team.findUnique({
    where: { tenantId_name: { tenantId: actorContext.tenantId, name } }
  })
  
  if (existing) {
    return { success: false, error: 'Team with this name already exists' }
  }
  
  // If setting as default, unset other defaults first
  if (isDefault) {
    await prisma.team.updateMany({
      where: { tenantId: actorContext.tenantId, isDefault: true },
      data: { isDefault: false }
    })
  }
  
  // Create team
  const team = await prisma.team.create({
    data: {
      tenantId: actorContext.tenantId,
      name,
      description,
      isDefault: isDefault || false,
      createdBy: actorContext.userId
    }
  })
  
  // Add creator as team lead
  await prisma.teamMember.create({
    data: {
      teamId: team.id,
      userId: actorContext.userId,
      role: 'LEAD'
    }
  })
  
  // Create default service access (all enabled)
  const serviceTypes: ServiceType[] = [
    'PATENT_DRAFTING',
    'NOVELTY_SEARCH',
    'PRIOR_ART_SEARCH',
    'IDEA_BANK',
    'PERSONA_SYNC',
    'DIAGRAM_GENERATION',
    'PATENT_REVIEW',
    'FUNDING_DISCOVERY',
    'GRANT_PREP',
    'GRANT_DRAFTING'
  ]
  
  await prisma.teamServiceAccess.createMany({
    data: serviceTypes.map(serviceType => ({
      teamId: team.id,
      serviceType,
      isEnabled: true
    }))
  })
  
  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'TEAM_CREATE',
      resource: `team:${team.id}`,
      meta: { name, description, isDefault }
    }
  })
  
  return { success: true, team }
}

/**
 * Add member to team
 */
export async function addTeamMember(
  actorContext: UserContext,
  teamId: string,
  userId: string,
  role: TeamRole = 'MEMBER'
): Promise<{ success: boolean; error?: string }> {
  // Get team
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: { where: { userId: actorContext.userId } } }
  })
  
  if (!team || team.tenantId !== actorContext.tenantId) {
    return { success: false, error: 'Team not found' }
  }
  
  // Check permission (must be team lead, OWNER, or ADMIN)
  const isTeamLead = team.members.some(m => m.role === 'LEAD')
  if (!isTeamLead && !actorContext.roles.some(r => ['OWNER', 'ADMIN'].includes(r))) {
    return { success: false, error: 'Only team leads or admins can add members' }
  }
  
  // Check target user exists and is in same tenant
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true }
  })
  
  if (!targetUser || targetUser.tenantId !== actorContext.tenantId) {
    return { success: false, error: 'User not found or not in same tenant' }
  }
  
  // Check if already a member
  const existingMember = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } }
  })
  
  if (existingMember) {
    return { success: false, error: 'User is already a team member' }
  }
  
  // Add member
  await prisma.teamMember.create({
    data: { teamId, userId, role }
  })
  
  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'TEAM_MEMBER_ADD',
      resource: `team:${teamId}`,
      meta: { addedUserId: userId, role }
    }
  })
  
  return { success: true }
}

/**
 * Remove member from team
 */
export async function removeTeamMember(
  actorContext: UserContext,
  teamId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  // Get team
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: true }
  })
  
  if (!team || team.tenantId !== actorContext.tenantId) {
    return { success: false, error: 'Team not found' }
  }
  
  // Check permission
  const actorMembership = team.members.find(m => m.userId === actorContext.userId)
  const isTeamLead = actorMembership?.role === 'LEAD'
  if (!isTeamLead && !actorContext.roles.some(r => ['OWNER', 'ADMIN'].includes(r))) {
    return { success: false, error: 'Only team leads or admins can remove members' }
  }
  
  // Check member exists
  const targetMembership = team.members.find(m => m.userId === userId)
  if (!targetMembership) {
    return { success: false, error: 'User is not a team member' }
  }
  
  // Cannot remove the last lead
  const leadCount = team.members.filter(m => m.role === 'LEAD').length
  if (targetMembership.role === 'LEAD' && leadCount <= 1) {
    return { success: false, error: 'Cannot remove the last team lead' }
  }
  
  // Remove member
  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId } }
  })
  
  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'TEAM_MEMBER_REMOVE',
      resource: `team:${teamId}`,
      meta: { removedUserId: userId }
    }
  })
  
  return { success: true }
}

/**
 * Get user's teams
 */
export async function getUserTeams(userId: string): Promise<TeamInfo[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        select: { id: true, name: true, description: true, isActive: true }
      }
    }
  })
  
  return memberships
    .filter(m => m.team.isActive)
    .map(m => ({
      id: m.team.id,
      name: m.team.name,
      description: m.team.description,
      role: m.role,
      isLead: m.role === 'LEAD'
    }))
}

/**
 * Get all teams for a tenant
 */
export async function getTenantTeams(tenantId: string): Promise<any[]> {
  return prisma.team.findMany({
    where: { tenantId, isActive: true },
    include: {
      members: {
        include: {
          user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, roles: true } }
        }
      },
      serviceAccess: true,
      _count: { select: { members: true } }
    },
    orderBy: { name: 'asc' }
  })
}

// ============================================================================
// Service Access Control
// ============================================================================

/**
 * Check if a user can access a service
 */
export async function checkServiceAccess(
  userId: string,
  tenantId: string,
  serviceType: ServiceType
): Promise<ServiceAccessResult> {
  // Get user info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      roles: true,
      status: true,
      tenantId: true,
      signupAtiTokenId: true,
      signupAtiToken: {
        select: {
          id: true,
          planTier: true
        }
      },
      teamMemberships: {
        include: {
          team: {
            include: {
              serviceAccess: { where: { serviceType } }
            }
          }
        }
      },
      serviceQuotas: { where: { serviceType } }
    }
  })
  
  if (!user || user.tenantId !== tenantId) {
    return { allowed: false, reason: 'User not found or invalid tenant' }
  }
  
  if (user.status !== 'ACTIVE') {
    return { allowed: false, reason: 'User account is not active' }
  }

  const trialAccess = await checkTrialQuotaForService(userId, serviceType)
  if (!trialAccess.allowed) {
    return { allowed: false, reason: trialAccess.reason }
  }
  
  // 1. Check role-based access
  const allowedRoles = SERVICE_DEFAULT_ROLES[serviceType]
  if (!user.roles.some(r => allowedRoles.includes(r))) {
    return { allowed: false, reason: `Role not authorized for ${serviceType}` }
  }
  
  let overrideQuota: ServiceAccessResult['remainingQuota'] | undefined
  let overrideQuotaSource: ServiceAccessResult['quotaSource'] | undefined
  const quotaExempt = isServiceQuotaExempt(serviceType)

  // 2. Check user-level quota/access (highest priority)
  const userQuota = user.serviceQuotas[0]
  if (userQuota) {
    if (!userQuota.isEnabled) {
      return { allowed: false, reason: `${serviceType} is disabled for this user` }
    }

    if (quotaExempt) {
      overrideQuota = { daily: null, monthly: null }
      overrideQuotaSource = 'user'
    } else {
    
      const currentDay = new Date().toISOString().substring(0, 10)
      const currentMonth = new Date().toISOString().substring(0, 7)
      const [trackedDailyUsage, trackedMonthlyUsage] = await Promise.all([
        prisma.serviceCompletionUsage.count({
          where: { tenantId, userId, serviceType, isCompleted: true, completionDate: currentDay }
        }),
        prisma.serviceCompletionUsage.count({
          where: { tenantId, userId, serviceType, isCompleted: true, completionMonth: currentMonth }
        })
      ])
      const dailyUsage = Math.max(userQuota.currentDayUsage, trackedDailyUsage)
      const monthlyUsage = Math.max(userQuota.currentMonthUsage, trackedMonthlyUsage)

      if (userQuota.dailyQuota !== null && dailyUsage >= userQuota.dailyQuota) {
        return {
          allowed: false,
          reason: `Daily quota exceeded for ${serviceType}`,
          remainingQuota: { daily: 0, monthly: null },
          quotaSource: 'user'
        }
      }
    
      if (userQuota.monthlyQuota !== null && monthlyUsage >= userQuota.monthlyQuota) {
        return {
          allowed: false,
          reason: `Monthly quota exceeded for ${serviceType}`,
          remainingQuota: { daily: null, monthly: 0 },
          quotaSource: 'user'
        }
      }

      overrideQuota = {
        daily: userQuota.dailyQuota !== null ? userQuota.dailyQuota - dailyUsage : null,
        monthly: userQuota.monthlyQuota !== null ? userQuota.monthlyQuota - monthlyUsage : null
      }
      overrideQuotaSource = 'user'
    }
  }
  
  // 3. Check team-level access
  if (!userQuota) {
    const configuredTeams = user.teamMemberships
      .map(membership => ({ membership, teamAccess: membership.team.serviceAccess[0] }))
      .filter(({ teamAccess }) => Boolean(teamAccess))

    if (configuredTeams.length > 0) {
      let allowedTeamQuota: ServiceAccessResult['remainingQuota'] | undefined
      let quotaDenied = false
      const currentDay = new Date().toISOString().substring(0, 10)
      const currentMonth = new Date().toISOString().substring(0, 7)

      for (const { membership, teamAccess } of configuredTeams) {
        if (!teamAccess?.isEnabled) continue

        if (quotaExempt) {
          allowedTeamQuota = { daily: null, monthly: null }
          break
        }

        const memberRows = await prisma.teamMember.findMany({
          where: { teamId: membership.team.id },
          select: { userId: true }
        })
        const memberIds = memberRows.map(member => member.userId)
        const [dailyUsage, monthlyUsage] = memberIds.length > 0
          ? await Promise.all([
              prisma.serviceCompletionUsage.count({
                where: { tenantId, userId: { in: memberIds }, serviceType, isCompleted: true, completionDate: currentDay }
              }),
              prisma.serviceCompletionUsage.count({
                where: { tenantId, userId: { in: memberIds }, serviceType, isCompleted: true, completionMonth: currentMonth }
              })
            ])
          : [0, 0]

        const dailyAllowed = teamAccess.dailyQuota === null || dailyUsage < teamAccess.dailyQuota
        const monthlyAllowed = teamAccess.monthlyQuota === null || monthlyUsage < teamAccess.monthlyQuota
        if (!dailyAllowed || !monthlyAllowed) {
          quotaDenied = true
          continue
        }

        allowedTeamQuota = {
          daily: teamAccess.dailyQuota === null ? null : teamAccess.dailyQuota - dailyUsage,
          monthly: teamAccess.monthlyQuota === null ? null : teamAccess.monthlyQuota - monthlyUsage
        }
        break
      }

      if (!allowedTeamQuota) {
        return {
          allowed: false,
          reason: quotaDenied
            ? `Team quota exceeded for ${serviceType}`
            : `${serviceType} is disabled for this user's teams`,
          quotaSource: 'team'
        }
      }

      overrideQuota = allowedTeamQuota
      overrideQuotaSource = 'team'
    }
  }
  
  // 4. Check tenant plan
  let tenantPlan = await getActiveTenantEntitlement(tenantId)

  if (!tenantPlan) {
    try {
      await ensureTenantEntitlementForSignup({
        tenantId,
        atiTokenId: user.signupAtiToken?.id || user.signupAtiTokenId,
        planTier: user.signupAtiToken?.planTier || null
      })
      tenantPlan = await getActiveTenantEntitlement(tenantId)
    } catch (entitlementError) {
      console.error('[ServiceAccess] Failed to provision missing tenant entitlement:', entitlementError)
    }
  }
  
  if (!tenantPlan) {
    return { allowed: false, reason: 'No active entitlement found for tenant' }
  }
  
  const featureCode = SERVICE_TO_FEATURE[serviceType]
  const planFeature = tenantPlan.plan.planFeatures?.find(
    pf => pf.feature.code === featureCode
  )
  
  if (!planFeature) {
    console.error(`[ENTITLEMENT DEBUG] serviceType=${serviceType} featureCode=${featureCode} tenantId=${tenantId} planCode=${tenantPlan.plan.code ?? tenantPlan.plan.id} planFeatureCodes=${JSON.stringify(tenantPlan.plan.planFeatures?.map(pf => pf.feature.code))} DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)
    return { allowed: false, reason: `${serviceType} is not included in the active entitlement` }
  }
  
  // Check tenant-level usage using unified service usage tracker
  // This enforces BOTH completion-based AND token-based quotas
  
  if (quotaExempt) {
    return {
      allowed: true,
      remainingQuota: overrideQuota || { daily: null, monthly: null },
      quotaSource: overrideQuotaSource || 'tenant'
    }
  }

  // Special handling for PATENT_DRAFTING (uses legacy patent-based counting for completions)
  if (serviceType === 'PATENT_DRAFTING') {
    const patentQuota = await getPatentDraftingQuota(tenantId)
    
    // Check completion quota
    if (patentQuota.monthlyLimit !== null && patentQuota.monthlyUsed >= patentQuota.monthlyLimit) {
      return {
        allowed: false,
        reason: `Tenant monthly quota exceeded for ${serviceType}`,
        remainingQuota: { daily: patentQuota.dailyRemaining, monthly: 0 },
        quotaSource: 'tenant'
      }
    }
    
    if (patentQuota.dailyLimit !== null && patentQuota.dailyUsed >= patentQuota.dailyLimit) {
      return {
        allowed: false,
        reason: `Tenant daily quota exceeded for ${serviceType}`,
        remainingQuota: { daily: 0, monthly: patentQuota.monthlyRemaining },
        quotaSource: 'tenant'
      }
    }
    
    // Also check token-based quota (prevents regeneration abuse)
    const tokenLimits = {
      dailyTokenLimit: (planFeature as any).dailyTokenLimit as number | null,
      monthlyTokenLimit: (planFeature as any).monthlyTokenLimit as number | null
    }
    
    if (tokenLimits.dailyTokenLimit !== null || tokenLimits.monthlyTokenLimit !== null) {
      const currentMonth = new Date().toISOString().substring(0, 7)
      const currentDay = new Date().toISOString().substring(0, 10)
      
      const [monthlyMeter, dailyMeter] = await Promise.all([
        prisma.usageMeter.findFirst({
          where: { tenantId, taskCode: getTaskCodeForService(serviceType), periodType: 'MONTHLY', periodKey: currentMonth }
        }),
        prisma.usageMeter.findFirst({
          where: { tenantId, taskCode: getTaskCodeForService(serviceType), periodType: 'DAILY', periodKey: currentDay }
        })
      ])
      
      const dailyTokens = dailyMeter?.currentUsage || 0
      const monthlyTokens = monthlyMeter?.currentUsage || 0
      
      if (tokenLimits.monthlyTokenLimit !== null && monthlyTokens >= tokenLimits.monthlyTokenLimit) {
        return {
          allowed: false,
          reason: `Tenant monthly token limit exceeded for ${serviceType}`,
          remainingQuota: { daily: patentQuota.dailyRemaining, monthly: 0 },
          quotaSource: 'tenant'
        }
      }
      
      if (tokenLimits.dailyTokenLimit !== null && dailyTokens >= tokenLimits.dailyTokenLimit) {
        return {
          allowed: false,
          reason: `Tenant daily token limit exceeded for ${serviceType}`,
          remainingQuota: { daily: 0, monthly: patentQuota.monthlyRemaining },
          quotaSource: 'tenant'
        }
      }
    }
    
    return {
      allowed: true,
      remainingQuota: overrideQuota || {
        daily: patentQuota.dailyRemaining,
        monthly: patentQuota.monthlyRemaining
      },
      quotaSource: overrideQuotaSource || 'tenant'
    }
  }
  
  // For other services, use the unified service usage tracker
  // This checks both completion-based AND token-based quotas
  try {
    const quotaCheck = await checkServiceQuota(tenantId, serviceType)
    
    if (!quotaCheck.allowed) {
      return {
        allowed: false,
        reason: quotaCheck.reason || `Quota exceeded for ${serviceType}`,
        remainingQuota: {
          daily: quotaCheck.quotaStatus.dailyCompletionsRemaining,
          monthly: quotaCheck.quotaStatus.monthlyCompletionsRemaining
        },
        quotaSource: 'tenant'
      }
    }
    
    return {
      allowed: true,
      remainingQuota: overrideQuota || {
        daily: quotaCheck.quotaStatus.dailyCompletionsRemaining,
        monthly: quotaCheck.quotaStatus.monthlyCompletionsRemaining
      },
      quotaSource: overrideQuotaSource || 'tenant'
    }
  } catch (error) {
    // Fallback to legacy token-based metering if new system fails
    console.warn(`[ServiceAccess] Unified tracker failed for ${serviceType}, falling back to legacy metering:`, error)
    
    const currentMonth = new Date().toISOString().substring(0, 7)
    const currentDay = new Date().toISOString().substring(0, 10)
    
    const [monthlyMeter, dailyMeter] = await Promise.all([
      prisma.usageMeter.findFirst({
        where: { tenantId, taskCode: getTaskCodeForService(serviceType), periodType: 'MONTHLY', periodKey: currentMonth }
      }),
      prisma.usageMeter.findFirst({
        where: { tenantId, taskCode: getTaskCodeForService(serviceType), periodType: 'DAILY', periodKey: currentDay }
      })
    ])
    
    const monthlyUsage = monthlyMeter?.currentUsage || 0
    const dailyUsage = dailyMeter?.currentUsage || 0
    
    if (planFeature.monthlyQuota !== null && monthlyUsage >= planFeature.monthlyQuota) {
      return {
        allowed: false,
        reason: `Tenant monthly quota exceeded for ${serviceType}`,
        remainingQuota: { daily: null, monthly: 0 },
        quotaSource: 'tenant'
      }
    }
    
    if (planFeature.dailyQuota !== null && dailyUsage >= planFeature.dailyQuota) {
      return {
        allowed: false,
        reason: `Tenant daily quota exceeded for ${serviceType}`,
        remainingQuota: { daily: 0, monthly: null },
        quotaSource: 'tenant'
      }
    }
    
    return {
      allowed: true,
      remainingQuota: overrideQuota || {
        daily: planFeature.dailyQuota !== null ? planFeature.dailyQuota - dailyUsage : null,
        monthly: planFeature.monthlyQuota !== null ? planFeature.monthlyQuota - monthlyUsage : null
      },
      quotaSource: overrideQuotaSource || 'tenant'
    }
  }
}

/**
 * Map ServiceType to TaskCode for metering
 */
function getTaskCodeForService(serviceType: ServiceType): TaskCode | null {
  const mapping: Record<ServiceType, TaskCode | null> = {
    PATENT_DRAFTING: TaskCode.LLM2_DRAFT,
    NOVELTY_SEARCH: TaskCode.LLM4_NOVELTY_SCREEN,
    PRIOR_ART_SEARCH: TaskCode.LLM1_PRIOR_ART,
    IDEA_BANK: TaskCode.IDEA_BANK_ACCESS,
    PERSONA_SYNC: TaskCode.PERSONA_SYNC_LEARN,
    DIAGRAM_GENERATION: TaskCode.LLM3_DIAGRAM,
    PATENT_REVIEW: TaskCode.LLM2_DRAFT,  // Uses drafting task code for review operations
    IDEATION: null,  // IDEATION has multiple task codes
    FUNDING_DISCOVERY: TaskCode.FUNDING_CALL_INGEST,
    GRANT_PREP: TaskCode.GRANT_PREP_CHAT,
    GRANT_DRAFTING: TaskCode.GRANT_SECTION_GENERATE,
    FUNDING_CHAT: TaskCode.FUNDING_CHAT,
    FUNDING_INTELLIGENCE: TaskCode.IDEA_INTELLIGENCE,
    GRANT_REVIEW: null // reviewer LLM metering handled separately; entry gate only
  }
  return mapping[serviceType]
}

/**
 * Update team service access
 */
export async function updateTeamServiceAccess(
  actorContext: UserContext,
  teamId: string,
  serviceType: ServiceType,
  updates: { isEnabled?: boolean; monthlyQuota?: number | null; dailyQuota?: number | null }
): Promise<{ success: boolean; error?: string }> {
  // Check team exists and belongs to tenant
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: { where: { userId: actorContext.userId } }
    }
  })
  
  if (!team || team.tenantId !== actorContext.tenantId) {
    return { success: false, error: 'Team not found' }
  }
  
  // Check permission (only OWNER, ADMIN, or team LEAD)
  const isTeamLead = team.members.some(m => m.role === 'LEAD')
  if (!isTeamLead && !actorContext.roles.some(r => ['OWNER', 'ADMIN'].includes(r))) {
    return { success: false, error: 'Insufficient permissions' }
  }
  
  // Upsert service access
  await prisma.teamServiceAccess.upsert({
    where: { teamId_serviceType: { teamId, serviceType } },
    create: {
      teamId,
      serviceType,
      isEnabled: updates.isEnabled ?? true,
      monthlyQuota: updates.monthlyQuota,
      dailyQuota: updates.dailyQuota
    },
    update: {
      ...(updates.isEnabled !== undefined && { isEnabled: updates.isEnabled }),
      ...(updates.monthlyQuota !== undefined && { monthlyQuota: updates.monthlyQuota }),
      ...(updates.dailyQuota !== undefined && { dailyQuota: updates.dailyQuota })
    }
  })
  
  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'TEAM_SERVICE_ACCESS_UPDATE',
      resource: `team:${teamId}`,
      meta: { serviceType, updates }
    }
  })
  
  return { success: true }
}

/**
 * Update user service quota
 */
export async function updateUserServiceQuota(
  actorContext: UserContext,
  targetUserId: string,
  serviceType: ServiceType,
  updates: { isEnabled?: boolean; monthlyQuota?: number | null; dailyQuota?: number | null }
): Promise<{ success: boolean; error?: string }> {
  // Check target user exists and is in same tenant
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, tenantId: true, roles: true }
  })
  
  if (!targetUser || targetUser.tenantId !== actorContext.tenantId) {
    return { success: false, error: 'User not found' }
  }
  
  // Only OWNER, ADMIN can change user quotas
  if (!actorContext.roles.some(r => ['OWNER', 'ADMIN'].includes(r))) {
    return { success: false, error: 'Only OWNER or ADMIN can modify user quotas' }
  }
  
  // Upsert user quota
  await prisma.userServiceQuota.upsert({
    where: { userId_serviceType: { userId: targetUserId, serviceType } },
    create: {
      userId: targetUserId,
      serviceType,
      isEnabled: updates.isEnabled ?? true,
      monthlyQuota: updates.monthlyQuota,
      dailyQuota: updates.dailyQuota
    },
    update: {
      ...(updates.isEnabled !== undefined && { isEnabled: updates.isEnabled }),
      ...(updates.monthlyQuota !== undefined && { monthlyQuota: updates.monthlyQuota }),
      ...(updates.dailyQuota !== undefined && { dailyQuota: updates.dailyQuota })
    }
  })
  
  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: actorContext.userId,
      tenantId: actorContext.tenantId,
      action: 'USER_SERVICE_QUOTA_UPDATE',
      resource: `user:${targetUserId}`,
      meta: { serviceType, updates }
    }
  })
  
  return { success: true }
}

/**
 * Increment user service usage
 */
export async function incrementServiceUsage(
  userId: string,
  serviceType: ServiceType,
  amount: number = 1
): Promise<void> {
  const today = new Date()
  const currentDay = today.toISOString().substring(0, 10)
  
  await prisma.userServiceQuota.upsert({
    where: { userId_serviceType: { userId, serviceType } },
    create: {
      userId,
      serviceType,
      currentDayUsage: amount,
      currentMonthUsage: amount,
      lastResetDate: today
    },
    update: {
      currentDayUsage: { increment: amount },
      currentMonthUsage: { increment: amount }
    }
  })
}

/**
 * Reset daily/monthly usage counters
 * Should be called by a scheduled job
 */
export async function resetUsageCounters(type: 'daily' | 'monthly'): Promise<number> {
  if (type === 'daily') {
    const result = await prisma.userServiceQuota.updateMany({
      data: {
        currentDayUsage: 0,
        lastResetDate: new Date()
      }
    })
    return result.count
  } else {
    const result = await prisma.userServiceQuota.updateMany({
      data: {
        currentDayUsage: 0,
        currentMonthUsage: 0,
        lastResetDate: new Date()
      }
    })
    return result.count
  }
}

// ============================================================================
// User Listing with Teams
// ============================================================================

/**
 * Get all users in a tenant with their team memberships
 */
export async function getTenantUsers(tenantId: string): Promise<UserWithTeams[]> {
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      roles: true,
      status: true,
      createdAt: true,
      teamMemberships: {
        include: {
          team: { select: { id: true, name: true, description: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
  
  return users.map(user => ({
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles,
    status: user.status,
    teams: user.teamMemberships.map(m => ({
      id: m.team.id,
      name: m.team.name,
      description: m.team.description,
      role: m.role,
      isLead: m.role === 'LEAD'
    })),
    createdAt: user.createdAt
  }))
}

// ============================================================================
// Auto Team Assignment on Signup
// ============================================================================

/**
 * Auto-assign user to default team if exists
 */
export async function autoAssignToDefaultTeam(
  userId: string,
  tenantId: string,
  specificTeamId?: string
): Promise<void> {
  let teamId = specificTeamId
  
  // If no specific team, find default team
  if (!teamId) {
    const defaultTeam = await prisma.team.findFirst({
      where: { tenantId, isDefault: true, isActive: true }
    })
    if (defaultTeam) {
      teamId = defaultTeam.id
    }
  }
  
  if (teamId) {
    // Check if not already a member
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } }
    })
    
    if (!existing) {
      await prisma.teamMember.create({
        data: {
          teamId,
          userId,
          role: 'MEMBER'
        }
      })
    }
  }
}

