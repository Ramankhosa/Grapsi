import prisma from '@/lib/prisma'

export interface ExpireEventUsersResult {
  considered: number
  suspended: number
  tokensRevoked: number
  failed: number
}

/**
 * Sweep expired EVENT (workshop) users: any ACTIVE user whose accessExpiresAt
 * has passed is set to SUSPENDED and their refresh tokens are revoked.
 *
 * Auth-time checks (login/refresh/middleware) already block expired users;
 * this sweep is hygiene so expired accounts don't linger as ACTIVE. Safe to
 * re-run: the ACTIVE filter means a suspended user is never touched twice.
 */
export async function expireEventUsers(
  options: { limit?: number; now?: Date } = {}
): Promise<ExpireEventUsersResult> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? 500

  const expiredUsers = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      accessExpiresAt: { lte: now },
    },
    select: { id: true, email: true, accessExpiresAt: true, tenantId: true },
    take: limit,
  })

  const result: ExpireEventUsersResult = {
    considered: expiredUsers.length,
    suspended: 0,
    tokensRevoked: 0,
    failed: 0,
  }

  for (const user of expiredUsers) {
    try {
      const [, revoked] = await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { status: 'SUSPENDED' },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: user.id, isRevoked: false },
          data: { isRevoked: true, revokedAt: now, revokedReason: 'access_expired' },
        }),
        prisma.auditLog.create({
          data: {
            tenantId: user.tenantId,
            action: 'EVENT_ACCESS_EXPIRED',
            resource: `user:${user.id}`,
            meta: { email: user.email, access_expires_at: user.accessExpiresAt },
          },
        }),
      ])
      result.suspended += 1
      result.tokensRevoked += revoked.count
    } catch (error) {
      result.failed += 1
      console.error(`[EVENT-EXPIRY] Failed to suspend ${user.email}:`, error)
    }
  }

  return result
}
