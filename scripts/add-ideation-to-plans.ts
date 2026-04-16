/**
 * Add IDEATION feature to Pro and Enterprise plans
 * 
 * Run with: npx tsx scripts/add-ideation-to-plans.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Adding IDEATION feature to subscription plans...')

  // First, ensure the IDEATION feature exists
  const ideationFeature = await prisma.feature.upsert({
    where: { code: 'IDEATION' },
    update: {},
    create: {
      code: 'IDEATION',
      name: 'Patent Ideation Engine',
      unit: 'sessions',
    },
  })
  console.log(`✅ Feature: ${ideationFeature.code} (${ideationFeature.id})`)

  // Get all plans
  const plans = await prisma.plan.findMany({
    where: { status: 'ACTIVE' },
  })
  console.log(`\n📋 Found ${plans.length} active plans`)

  for (const plan of plans) {
    // Determine quotas based on plan type
    let monthlyQuota = 100
    let dailyQuota = 20
    let monthlyTokenLimit = 1000000
    let dailyTokenLimit = 100000

    if (plan.code.toLowerCase().includes('pro') || plan.code.toLowerCase().includes('professional')) {
      monthlyQuota = 500
      dailyQuota = 50
      monthlyTokenLimit = 5000000
      dailyTokenLimit = 500000
    } else if (plan.code.toLowerCase().includes('enterprise')) {
      monthlyQuota = 2000
      dailyQuota = 200
      monthlyTokenLimit = 20000000
      dailyTokenLimit = 2000000
    }

    // Add or update PlanFeature
    await prisma.planFeature.upsert({
      where: {
        planId_featureId: {
          planId: plan.id,
          featureId: ideationFeature.id,
        },
      },
      update: {
        monthlyQuota,
        dailyQuota,
        monthlyTokenLimit,
        dailyTokenLimit,
      },
      create: {
        planId: plan.id,
        featureId: ideationFeature.id,
        monthlyQuota,
        dailyQuota,
        monthlyTokenLimit,
        dailyTokenLimit,
      },
    })

    console.log(`  ✅ ${plan.name} (${plan.code}): ${monthlyQuota} sessions/month, ${dailyQuota}/day`)
  }

  console.log('\n✨ IDEATION feature added to all plans successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

