import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { generateJWT } from '@/lib/auth'

const prisma = new PrismaClient()

async function main() {
  const callId = 'cmq0o9bel00o214iusm84d32n'
  const call = await prisma.reviewerCall.findUnique({ where: { id: callId }, select: { user_id: true } })
  if (!call) throw new Error('call missing')
  const user = await prisma.user.findUnique({
    where: { id: call.user_id },
    select: { id: true, email: true, tenantId: true, roles: true, status: true, tenant: { select: { atiId: true, status: true } } },
  })
  if (!user || user.status !== 'ACTIVE') throw new Error('owner inactive: ' + JSON.stringify(user))
  const token = generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  })
  console.log('OWNER:', user.email)
  console.log('TOKEN:' + token)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
