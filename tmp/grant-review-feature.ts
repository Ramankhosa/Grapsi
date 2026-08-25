import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  let feature = await prisma.feature.findUnique({ where: { code: 'GRANT_REVIEW' } }).catch(() => null)
  if (!feature) {
    feature = await prisma.feature.create({
      data: { code: 'GRANT_REVIEW', name: 'AI Grant Review', unit: 'calls' },
    })
    console.log('created feature', feature.id)
  } else {
    console.log('feature exists', feature.id)
  }
  const plan = await prisma.plan.findFirst({ where: { code: 'FREE_PLAN' }, select: { id: true } })
  if (!plan) throw new Error('FREE_PLAN missing')
  const existing = await prisma.planFeature.findFirst({ where: { planId: plan.id, featureId: feature.id } })
  if (!existing) {
    const pf = await prisma.planFeature.create({
      data: { planId: plan.id, featureId: feature.id, monthlyQuota: null, dailyQuota: null },
    })
    console.log('created planFeature', pf.id)
  } else {
    console.log('planFeature exists', existing.id)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1) })
