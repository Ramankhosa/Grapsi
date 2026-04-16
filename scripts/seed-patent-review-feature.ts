/**
 * Seed script to add PATENT_REVIEW feature and configure it for Pro plans
 * 
 * This creates the PATENT_REVIEW feature and assigns it to higher-tier plans
 * (Pro, Enterprise, etc.) while excluding it from Basic/Free plans.
 * 
 * Run with: npx ts-node scripts/seed-patent-review-feature.ts
 * Or: npx tsx scripts/seed-patent-review-feature.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Starting PATENT_REVIEW feature seeding...')

  // 1. Create or update the PATENT_REVIEW feature
  const feature = await prisma.feature.upsert({
    where: { code: 'PATENT_REVIEW' },
    update: {
      name: 'AI Patent Review',
      unit: 'reviews'
    },
    create: {
      code: 'PATENT_REVIEW',
      name: 'AI Patent Review',
      unit: 'reviews'
    }
  })
  console.log('✅ Feature created/updated:', feature.id, feature.code)

  // 2. Find all plans to configure
  const allPlans = await prisma.plan.findMany({
    where: { status: 'ACTIVE' }
  })
  console.log(`📋 Found ${allPlans.length} active plans`)

  // 3. Define which plans get the PATENT_REVIEW feature
  // Higher tier plans get access, Basic/Free plans do NOT get access
  const planConfig: Record<string, { dailyQuota: number; monthlyQuota: number; dailyTokenLimit: number; monthlyTokenLimit: number } | 'remove'> = {
    // Free/Basic plans - NO access (remove existing config if any)
    'Free': 'remove',
    'Basic': 'remove',
    'Starter': 'remove',
    'free': 'remove',
    'basic': 'remove',
    'starter': 'remove',
    'Basic Plan': 'remove',  // Specific plan names
    
    // Pro/Professional plans - Limited access
    'Pro': { dailyQuota: 5, monthlyQuota: 50, dailyTokenLimit: 100000, monthlyTokenLimit: 1000000 },
    'pro': { dailyQuota: 5, monthlyQuota: 50, dailyTokenLimit: 100000, monthlyTokenLimit: 1000000 },
    'Professional': { dailyQuota: 5, monthlyQuota: 50, dailyTokenLimit: 100000, monthlyTokenLimit: 1000000 },
    'professional': { dailyQuota: 5, monthlyQuota: 50, dailyTokenLimit: 100000, monthlyTokenLimit: 1000000 },
    'Professional Plan': { dailyQuota: 5, monthlyQuota: 50, dailyTokenLimit: 100000, monthlyTokenLimit: 1000000 },
    
    // Enterprise plans - Generous limits
    'Enterprise': { dailyQuota: 20, monthlyQuota: 200, dailyTokenLimit: 500000, monthlyTokenLimit: 5000000 },
    'enterprise': { dailyQuota: 20, monthlyQuota: 200, dailyTokenLimit: 500000, monthlyTokenLimit: 5000000 },
    'Enterprise Plan': { dailyQuota: 20, monthlyQuota: 200, dailyTokenLimit: 500000, monthlyTokenLimit: 5000000 },
    'Business': { dailyQuota: 15, monthlyQuota: 150, dailyTokenLimit: 300000, monthlyTokenLimit: 3000000 },
    'business': { dailyQuota: 15, monthlyQuota: 150, dailyTokenLimit: 300000, monthlyTokenLimit: 3000000 },
    
    // Unlimited plans
    'Unlimited': { dailyQuota: 999, monthlyQuota: 9999, dailyTokenLimit: 10000000, monthlyTokenLimit: 100000000 },
    'unlimited': { dailyQuota: 999, monthlyQuota: 9999, dailyTokenLimit: 10000000, monthlyTokenLimit: 100000000 },
  }

  // 4. Add/Remove PlanFeature entries based on plan tier
  let configuredCount = 0
  let removedCount = 0
  for (const plan of allPlans) {
    const config = planConfig[plan.name]
    
    // Check if this plan should have access removed
    if (config === 'remove') {
      // Try to delete existing PlanFeature if any
      try {
        await prisma.planFeature.deleteMany({
          where: {
            planId: plan.id,
            featureId: feature.id
          }
        })
        console.log(`🚫 Removed PATENT_REVIEW from ${plan.name} (Basic tier - no access)`)
        removedCount++
      } catch {
        // Ignore if doesn't exist
      }
      continue
    }
    
    // If plan name not in config, skip (no default access for unknown plans)
    if (!config) {
      console.log(`⏭️  Skipping ${plan.name} (not configured)`)
      continue
    }
    
    try {
      await prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plan.id,
            featureId: feature.id
          }
        },
        update: {
          dailyQuota: config.dailyQuota,
          monthlyQuota: config.monthlyQuota,
          dailyTokenLimit: config.dailyTokenLimit,
          monthlyTokenLimit: config.monthlyTokenLimit
        },
        create: {
          planId: plan.id,
          featureId: feature.id,
          dailyQuota: config.dailyQuota,
          monthlyQuota: config.monthlyQuota,
          dailyTokenLimit: config.dailyTokenLimit,
          monthlyTokenLimit: config.monthlyTokenLimit
        }
      })
      console.log(`✅ Configured ${plan.name}: ${config.dailyQuota}/day, ${config.monthlyQuota}/month`)
      configuredCount++
    } catch (err) {
      console.error(`❌ Failed to configure ${plan.name}:`, err)
    }
  }
  
  console.log(`\n📊 Summary: ${configuredCount} plans configured, ${removedCount} plans restricted`)

  console.log(`\n🎉 Done! Configured PATENT_REVIEW for ${configuredCount} plans`)
  
  // 5. Show summary
  const planFeatures = await prisma.planFeature.findMany({
    where: { featureId: feature.id },
    include: { plan: true }
  })
  
  console.log('\n📊 PATENT_REVIEW Configuration Summary:')
  console.log('=' .repeat(60))
  for (const pf of planFeatures) {
    console.log(`  ${pf.plan.name.padEnd(20)} | Daily: ${String(pf.dailyQuota || '∞').padStart(5)} | Monthly: ${String(pf.monthlyQuota || '∞').padStart(6)}`)
  }
}

main()
  .catch((e) => {
    console.error('Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

