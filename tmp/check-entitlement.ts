import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const tenantId = 'cmocl5lwx0005jebt5rptaybt'
  const plans = await prisma.tenantPlan.findMany({
    where: { tenantId },
    select: {
      status: true,
      plan: { select: { code: true, planFeatures: { select: { feature: { select: { code: true } } } } } },
    },
  })
  console.log(JSON.stringify(plans.map((p) => ({
    status: p.status, plan: p.plan.code, features: p.plan.planFeatures.map((f) => f.feature.code),
  })), null, 1))
  const features = await prisma.feature.findMany({ select: { code: true } })
  console.log('ALL FEATURES:', features.map((f) => f.code).join(', '))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
