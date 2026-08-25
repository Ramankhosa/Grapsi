import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { PrismaClient } from '@prisma/client'

async function main() {
  const { generateJWT } = await import('@/lib/auth')
  const prisma = new PrismaClient()
  const callId = 'cmq0o9bel00o214iusm84d32n'
  const call = await prisma.reviewerCall.findUnique({ where: { id: callId }, select: { user_id: true } })
  if (!call) throw new Error('call missing')
  const user = await prisma.user.findUnique({
    where: { id: call.user_id },
    select: { id: true, email: true, tenantId: true, roles: true, status: true, tenant: { select: { atiId: true } } },
  })
  if (!user) throw new Error('owner missing')
  const token = generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  })
  console.log('TOKEN:' + token)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
