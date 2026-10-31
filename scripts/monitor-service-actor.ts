/**
 * Creates the Source Watch service user that paid AI work is billed to.
 *
 *   npm run monitor:service-actor
 *
 * Idempotent. Requires the platform tenant (atiId PLATFORM, or
 * MONITOR_PLATFORM_TENANT_ATI) to exist — it never creates a tenant. The user
 * has no password and no roles, so nobody can sign in as it.
 */
import dotenv from 'dotenv'

dotenv.config()

async function main() {
  const { prisma } = await import('../src/lib/prisma')
  const { PLATFORM_TENANT_ATI, SERVICE_USER_EMAIL } = await import('../src/lib/monitor/actor')

  const tenant = await prisma.tenant.findFirst({ where: { atiId: PLATFORM_TENANT_ATI() }, select: { id: true, name: true } })
  if (!tenant) {
    console.error(
      `No tenant with atiId "${PLATFORM_TENANT_ATI()}". Create the platform tenant first (or set MONITOR_PLATFORM_TENANT_ATI to the existing one), then re-run.`
    )
    process.exitCode = 1
    return
  }
  const email = SERVICE_USER_EMAIL()
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Source Watch (system)', tenantId: tenant.id, roles: [] },
    update: { tenantId: tenant.id },
    select: { id: true, email: true },
  })
  console.log(`Source Watch service user ready: ${user.email} (${user.id}) in tenant "${tenant.name}"`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
