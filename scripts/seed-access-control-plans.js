/**
 * Access-control plan seeding (idempotent).
 *
 * Binds the five product modules to the Starter / Pro / Enterprise tiers:
 *   - Starter  (FREE_PLAN)      → Funding Directory only
 *   - Pro      (PRO_PLAN)       → Directory + AI Chatbot + Funding Intelligence
 *                                 + Grant Studio (prep + drafting) + AI Grant Review
 *   - Enterprise (ENTERPRISE_PLAN) → everything Pro has (premium LLM models are
 *                                 configured separately in the LLM Model Control UI)
 *
 * It ONLY manages the five module features listed in MODULE_FEATURES below. Any
 * other features already attached to a plan (patent / paper products, etc.) are
 * left untouched. Plan display names are normalised to Starter/Pro/Enterprise.
 *
 * Run AFTER `prisma migrate deploy` (the migration adds the new enum values):
 *   node scripts/seed-access-control-plans.js
 * or via npm:  npm run seed:access-control
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Feature catalog rows for the five modules (upserted so PlanFeature can attach).
const MODULE_FEATURES = [
  { code: 'FUNDING_DISCOVERY', name: 'Funding Directory', unit: 'calls' },
  { code: 'FUNDING_CHAT', name: 'AI Funding Chatbot', unit: 'messages' },
  { code: 'FUNDING_INTELLIGENCE', name: 'Funding Intelligence', unit: 'runs' },
  { code: 'GRANT_PREP', name: 'Grant Prep', unit: 'sessions' },
  { code: 'GRANT_DRAFTING', name: 'Grant Drafting', unit: 'tokens' },
  { code: 'GRANT_REVIEW', name: 'AI Grant Review', unit: 'reviews' }
]

const ALL_MODULE_CODES = MODULE_FEATURES.map((f) => f.code)

// Plan tier definitions: display name + which module features are included.
const PLANS = [
  {
    code: 'FREE_PLAN',
    name: 'Starter',
    includes: ['FUNDING_DISCOVERY']
  },
  {
    code: 'PRO_PLAN',
    name: 'Pro',
    includes: [
      'FUNDING_DISCOVERY',
      'FUNDING_CHAT',
      'FUNDING_INTELLIGENCE',
      'GRANT_PREP',
      'GRANT_DRAFTING',
      'GRANT_REVIEW'
    ]
  },
  {
    code: 'ENTERPRISE_PLAN',
    name: 'Enterprise',
    includes: [
      'FUNDING_DISCOVERY',
      'FUNDING_CHAT',
      'FUNDING_INTELLIGENCE',
      'GRANT_PREP',
      'GRANT_DRAFTING',
      'GRANT_REVIEW'
    ]
  }
]

async function main() {
  console.log('🌱 Seeding access-control module features + plan bindings...\n')

  // 1. Ensure module feature rows exist.
  const featureByCode = {}
  for (const f of MODULE_FEATURES) {
    const feature = await prisma.feature.upsert({
      where: { code: f.code },
      update: { name: f.name, unit: f.unit },
      create: f
    })
    featureByCode[f.code] = feature
    console.log(`  ✓ feature ${f.code} (${f.name})`)
  }

  // 2. For each tier, normalise the display name and reconcile module features.
  for (const planDef of PLANS) {
    const plan = await prisma.plan.findUnique({ where: { code: planDef.code } })
    if (!plan) {
      console.warn(`  ⚠ plan ${planDef.code} not found — skipping (run base plan seed first)`)
      continue
    }

    if (plan.name !== planDef.name) {
      await prisma.plan.update({ where: { id: plan.id }, data: { name: planDef.name } })
      console.log(`  ✎ renamed ${planDef.code} → "${planDef.name}"`)
    }

    // Add the included module features (leave quotas unlimited; tune in Quota Controller).
    for (const code of planDef.includes) {
      const feature = featureByCode[code]
      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
        update: {},
        create: { planId: plan.id, featureId: feature.id }
      })
    }

    // Remove any module features that should NOT be on this tier
    // (e.g. strip Pro modules from Starter). Non-module features are untouched.
    const excludeCodes = ALL_MODULE_CODES.filter((c) => !planDef.includes.includes(c))
    const excludeFeatureIds = excludeCodes
      .map((c) => featureByCode[c]?.id)
      .filter(Boolean)
    if (excludeFeatureIds.length) {
      const removed = await prisma.planFeature.deleteMany({
        where: { planId: plan.id, featureId: { in: excludeFeatureIds } }
      })
      if (removed.count) {
        console.log(`  ✂ ${planDef.name}: removed ${removed.count} out-of-tier module feature(s)`)
      }
    }

    console.log(`  ✓ ${planDef.name} (${planDef.code}) → [${planDef.includes.join(', ')}]`)
  }

  console.log('\n✅ Access-control plan seeding complete.')
  console.log('   Note: Enterprise premium LLM models are configured in Super Admin → LLM Model Control.')
}

main()
  .catch((err) => {
    console.error('❌ Seeding failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
