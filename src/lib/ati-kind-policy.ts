/**
 * Governance policy for ATI token kinds.
 *
 * STANDARD — self-administered org: first user becomes OWNER, tokens may
 *            assign ADMIN/MANAGER/ANALYST.
 * MANAGED  — platform-administered group: members never get OWNER/ADMIN,
 *            roles are clamped to ANALYST/VIEWER.
 * EVENT    — MANAGED plus time-boxed member access (workshops, demos).
 *
 * Pure functions only — signup/login wire these into their transactions.
 */

export type ATIKind = 'STANDARD' | 'MANAGED' | 'EVENT'

const STANDARD_ASSIGNABLE_ROLES = ['ADMIN', 'MANAGER', 'ANALYST'] as const
const MANAGED_ASSIGNABLE_ROLES = ['ANALYST', 'VIEWER'] as const

/** Default per-member access window for EVENT tokens that don't specify one. */
export const DEFAULT_EVENT_ACCESS_HOURS = 24

export function isSelfAdministered(kind: ATIKind): boolean {
  return kind === 'STANDARD'
}

/** Whether the first user of a tenant signing up with this token becomes OWNER. */
export function shouldPromoteFirstUserToOwner(kind: ATIKind): boolean {
  return kind === 'STANDARD'
}

/**
 * Resolve the role a token's assignedRole grants under its kind.
 * Returns null when the token has no valid explicit role (caller falls back
 * to its default logic); `clamped` is true when a disallowed role was reduced.
 */
export function resolveAssignedRole(
  kind: ATIKind,
  assignedRole: string | null | undefined
): { role: string | null; clamped: boolean } {
  if (!assignedRole) return { role: null, clamped: false }

  if (kind === 'STANDARD') {
    if ((STANDARD_ASSIGNABLE_ROLES as readonly string[]).includes(assignedRole)) {
      return { role: assignedRole, clamped: false }
    }
    return { role: null, clamped: false }
  }

  // MANAGED / EVENT: members never get admin-capable roles
  if ((MANAGED_ASSIGNABLE_ROLES as readonly string[]).includes(assignedRole)) {
    return { role: assignedRole, clamped: false }
  }
  return { role: 'ANALYST', clamped: true }
}

/**
 * Compute when an EVENT signup's access ends: the earlier of
 * (signup time + memberAccessHours) and the event's hard cutoff.
 * EVENT tokens with neither configured fall back to 24 hours.
 * Non-EVENT kinds never expire member access.
 */
export function computeAccessExpiresAt(
  token: { kind: ATIKind; memberAccessHours: number | null; accessEndsAt: Date | null },
  now: Date
): Date | null {
  if (token.kind !== 'EVENT') return null

  const candidates: number[] = []
  if (token.memberAccessHours && token.memberAccessHours > 0) {
    candidates.push(now.getTime() + token.memberAccessHours * 60 * 60 * 1000)
  }
  if (token.accessEndsAt) {
    candidates.push(token.accessEndsAt.getTime())
  }
  if (candidates.length === 0) {
    candidates.push(now.getTime() + DEFAULT_EVENT_ACCESS_HOURS * 60 * 60 * 1000)
  }
  return new Date(Math.min(...candidates))
}

export function isAccessExpired(accessExpiresAt: Date | string | null | undefined, now: Date): boolean {
  if (!accessExpiresAt) return false
  const expiry = typeof accessExpiresAt === 'string' ? new Date(accessExpiresAt) : accessExpiresAt
  return expiry.getTime() <= now.getTime()
}
