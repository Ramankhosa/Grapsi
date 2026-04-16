#!/usr/bin/env node

/**
 * Admin plans/features seeding script
 * Ensures features (PRIOR_ART_SEARCH, PATENT_DRAFTING, DIAGRAM_GENERATION),
 * tasks (LLM1_PRIOR_ART, LLM2_DRAFT, LLM3_DIAGRAM), model classes,
 * and plan links for FREE_PLAN, PRO_PLAN, ENTERPRISE_PLAN.
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function ensureModelClasses() {
  const baseS = await prisma.lLMModelClass.upsert({ where: { code: 'BASE_S' }, update: {}, create: { code: 'BASE_S', name: 'Base Small' } })
  const proM = await prisma.lLMModelClass.upsert({ where: { code: 'PRO_M' }, update: {}, create: { code: 'PRO_M', name: 'Pro Medium' } })
  return { baseS, proM }
}

async function ensureFeaturesAndTasks() {
  const priorArt = await prisma.feature.upsert({ where: { code: 'PRIOR_ART_SEARCH' }, update: {}, create: { code: 'PRIOR_ART_SEARCH', name: 'Prior Art Search', unit: 'calls' } })
  const drafting = await prisma.feature.upsert({ where: { code: 'PATENT_DRAFTING' }, update: {}, create: { code: 'PATENT_DRAFTING', name: 'Patent Drafting', unit: 'tokens' } })
  const diagrams = await prisma.feature.upsert({ where: { code: 'DIAGRAM_GENERATION' }, update: {}, create: { code: 'DIAGRAM_GENERATION', name: 'Diagram Generation', unit: 'calls' } })

  await prisma.task.upsert({ where: { code: 'LLM1_PRIOR_ART' }, update: {}, create: { code: 'LLM1_PRIOR_ART', name: 'Prior Art Analysis', linkedFeatureId: priorArt.id } })
  await prisma.task.upsert({ where: { code: 'LLM2_DRAFT' }, update: {}, create: { code: 'LLM2_DRAFT', name: 'Patent Drafting', linkedFeatureId: drafting.id } })
  await prisma.task.upsert({ where: { code: 'LLM3_DIAGRAM' }, update: {}, create: { code: 'LLM3_DIAGRAM', name: 'Diagram Generation', linkedFeatureId: diagrams.id } })

  return { priorArt, drafting, diagrams }
}

async function ensurePlans() {
  const free = await prisma.plan.upsert({ where: { code: 'FREE_PLAN' }, update: { name: 'Basic Plan' }, create: { code: 'FREE_PLAN', name: 'Basic Plan', cycle: 'MONTHLY', status: 'ACTIVE' } })
  const pro = await prisma.plan.upsert({ where: { code: 'PRO_PLAN' }, update: {}, create: { code: 'PRO_PLAN', name: 'Professional Plan', cycle: 'MONTHLY', status: 'ACTIVE' } })
  const ent = await prisma.plan.upsert({ where: { code: 'ENTERPRISE_PLAN' }, update: {}, create: { code: 'ENTERPRISE_PLAN', name: 'Enterprise Plan', cycle: 'MONTHLY', status: 'ACTIVE' } })
  return { free, pro, ent }
}

async function linkPlanFeatures(plan, features) {
  // Reasonable defaults; adjust quotas as needed
  const quotas = {
    PRIOR_ART_SEARCH: { monthly: 1000, daily: 100 },
    PATENT_DRAFTING: { monthly: 600000, daily: 20000 }, // tokens
    DIAGRAM_GENERATION: { monthly: 1000, daily: 100 }
  }
  for (const f of [features.priorArt, features.drafting, features.diagrams]) {
    const q = quotas[f.code]
    await prisma.planFeature.upsert({
      where: { planId_featureId: { planId: plan.id, featureId: f.id } },
      update: { monthlyQuota: q.monthly, dailyQuota: q.daily },
      create: { planId: plan.id, featureId: f.id, monthlyQuota: q.monthly, dailyQuota: q.daily }
    })
  }
}

async function linkPlanLLMAccess(plan, classes) {
  const tasks = ['LLM1_PRIOR_ART', 'LLM2_DRAFT', 'LLM3_DIAGRAM']
  for (const taskCode of tasks) {
    await prisma.planLLMAccess.upsert({
      where: { planId_taskCode: { planId: plan.id, taskCode } },
      update: { allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']), defaultClassId: classes.proM.id },
      create: { planId: plan.id, taskCode, allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']), defaultClassId: classes.proM.id }
    })
  }
}

async function main() {
  try {
    console.log('🔧 Seeding admin plans/features...')
    const classes = await ensureModelClasses()
    const features = await ensureFeaturesAndTasks()
    const { free, pro, ent } = await ensurePlans()

    // FREE: minimal access (prior art only)
    await prisma.planFeature.upsert({
      where: { planId_featureId: { planId: free.id, featureId: features.priorArt.id } },
      update: { monthlyQuota: 100, dailyQuota: 10 },
      create: { planId: free.id, featureId: features.priorArt.id, monthlyQuota: 100, dailyQuota: 10 }
    })

    // PRO: all three
    await linkPlanFeatures(pro, features)
    await linkPlanLLMAccess(pro, classes)

    // ENTERPRISE: all three with higher quotas
    await prisma.planFeature.upsert({ where: { planId_featureId: { planId: ent.id, featureId: features.priorArt.id } }, update: { monthlyQuota: 10000, dailyQuota: 1000 }, create: { planId: ent.id, featureId: features.priorArt.id, monthlyQuota: 10000, dailyQuota: 1000 } })
    await prisma.planFeature.upsert({ where: { planId_featureId: { planId: ent.id, featureId: features.drafting.id } }, update: { monthlyQuota: 5000000, dailyQuota: 200000 }, create: { planId: ent.id, featureId: features.drafting.id, monthlyQuota: 5000000, dailyQuota: 200000 } })
    await prisma.planFeature.upsert({ where: { planId_featureId: { planId: ent.id, featureId: features.diagrams.id } }, update: { monthlyQuota: 10000, dailyQuota: 1000 }, create: { planId: ent.id, featureId: features.diagrams.id, monthlyQuota: 10000, dailyQuota: 1000 } })
    await linkPlanLLMAccess(ent, classes)

    console.log('🎉 Admin plans/features seed complete.')
  } catch (e) {
    console.error('❌ Seed failed:', e)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}


