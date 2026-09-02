/**
 * Access-control plan seeding (idempotent).
 *
 * CURRENT POSTURE (1 Sep 2026): Grant Studio is switched OFF platform-wide.
 * Every tier gets the same four modules — Funding Directory, AI Funding Chatbot,
 * Funding Intelligence and AI Grant Review — while grant prep / blueprint /
 * drafting (GRANT_PREP + GRANT_DRAFTING) are withheld from all plans. The tiers
 * are otherwise deliberately identical; they differ only in LLM model access
 * (configured in Super Admin → LLM Model Control) and quotas (Quota Controller).
 *
 * Funding Alerts (FUNDING_ALERTS) is a separately sold delivery service: the
 * publish-hooked matcher only emails/notifies users whose tenant plan includes
 * it. It is seeded onto Pro and Enterprise but NOT Starter — grant it to a
 * specific institution via Super Admin → Plans & Feature Access (tick "Funding
 * Alerts" on their plan or custom plan); individual paying customers get it
 * through the plan their subscription assigns.
 *
 * To re-open Grant Studio later, add 'GRANT_PREP' and 'GRANT_DRAFTING' back to
 * the relevant tier's `includes` below and re-run — or just tick "Grant Studio"
 * for that plan in Super Admin → Plans & Feature Access, which does the same
 * thing through the UI.
 *
 * It ONLY manages the module features listed in MODULE_FEATURES below. Any
 * other features already attached to a plan (patent / paper products, etc.) are
 * left untouched. Plan display names are normalised to Starter/Pro/Enterprise.
 *
 * Run AFTER `prisma migrate deploy` (the migration adds the new enum values):
 *   node scripts/seed-access-control-plans.js
 * or via npm:  npm run seed:access-control
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Feature catalog rows for the plan-gated modules (upserted so PlanFeature can attach).
const MODULE_FEATURES = [
  { code: 'FUNDING_DISCOVERY', name: 'Funding Directory', unit: 'calls' },
  { code: 'FUNDING_CHAT', name: 'AI Funding Chatbot', unit: 'messages' },
  { code: 'FUNDING_INTELLIGENCE', name: 'Funding Intelligence', unit: 'runs' },
  { code: 'GRANT_PREP', name: 'Grant Prep', unit: 'sessions' },
  { code: 'GRANT_DRAFTING', name: 'Grant Drafting', unit: 'tokens' },
  { code: 'GRANT_REVIEW', name: 'AI Grant Review', unit: 'reviews' },
  { code: 'FUNDING_ALERTS', name: 'Funding Alerts', unit: 'alerts' }
]

const ALL_MODULE_CODES = MODULE_FEATURES.map((f) => f.code)

// Modules every tier currently gets. Grant Studio (GRANT_PREP + GRANT_DRAFTING)
// is intentionally absent — see the posture note at the top of this file.
const ENABLED_MODULE_CODES = [
  'FUNDING_DISCOVERY',
  'FUNDING_CHAT',
  'FUNDING_INTELLIGENCE',
  'GRANT_REVIEW'
]

// Plan tier definitions: display name + which module features are included.
// Funding Alerts is a paid add-on: Pro/Enterprise only, never Starter.
const PLANS = [
  { code: 'FREE_PLAN', name: 'Starter', includes: ENABLED_MODULE_CODES },
  { code: 'PRO_PLAN', name: 'Pro', includes: [...ENABLED_MODULE_CODES, 'FUNDING_ALERTS'] },
  { code: 'ENTERPRISE_PLAN', name: 'Enterprise', includes: [...ENABLED_MODULE_CODES, 'FUNDING_ALERTS'] }
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
