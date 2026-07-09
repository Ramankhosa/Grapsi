/**
 * Sweep expired EVENT (workshop) users: any ACTIVE user whose accessExpiresAt
 * has passed is set to SUSPENDED and their refresh tokens are revoked.
 *
 * Auth-time checks (login/refresh/middleware) already block expired users;
 * this sweep is hygiene so expired accounts don't linger as ACTIVE.
 *
 * Usage: node scripts/run-local-command.js node scripts/expire-event-users.js
 * Schedule via cron/Task Scheduler (e.g. daily).
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const now = new Date()

  const expiredUsers = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      accessExpiresAt: { lte: now }
    },
    select: { id: true, email: true, accessExpiresAt: true, tenantId: true }
  })

  if (expiredUsers.length === 0) {
    console.log('No expired event users found.')
    return
  }

  console.log(`Suspending ${expiredUsers.length} expired event user(s)...`)

  for (const user of expiredUsers) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { status: 'SUSPENDED' }
      }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, isRevoked: false },
        data: { isRevoked: true, revokedAt: now, revokedReason: 'access_expired' }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: user.tenantId,
          action: 'EVENT_ACCESS_EXPIRED',
          resource: `user:${user.id}`,
          meta: { email: user.email, access_expires_at: user.accessExpiresAt }
        }
      })
    ])
    console.log(`  suspended ${user.email} (access ended ${user.accessExpiresAt.toISOString()})`)
  }

  console.log('Done.')
}

main()
  .catch(err => {
    console.error('expire-event-users failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
