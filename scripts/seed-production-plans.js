#!/usr/bin/env node

/**
 * Production-safe seeding script for plans, features, tasks and LLM access.
 *
 * This is a trimmed-down version of the local hierarchy seeding:
 * - Ensures Feature, Task, ModelClass enums have matching DB rows
 * - Ensures BASIC (FREE_PLAN), PRO_PLAN, ENTERPRISE_PLAN exist
 * - Ensures PlanFeature + PlanLLMAccess rows match the desired bindings:
 *   - BASIC: Patent drafting + novelty search
 *   - PRO: BASIC + Idea Bank + diagram generation
 *   - ENTERPRISE: Everything (all features)
 *
 * It does NOT:
 * - Create sample ideas
 * - Reassign tenant plans
 * - Touch any tenant-specific data
 *
 * Safe to run multiple times on production (idempotent upserts).
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function seedProductionPlans() {
  try {
    console.log('dY" Seeding production plans, features and LLM access...\n')

    // 1. Features
    console.log('1. Ensuring features...')
    const featureDefs = [
      { code: 'PRIOR_ART_SEARCH', name: 'Patent and Literature Search', unit: 'queries' },
      { code: 'PATENT_DRAFTING', name: 'AI-Assisted Patent Drafting', unit: 'tokens' },
      { code: 'DIAGRAM_GENERATION', name: 'Technical Diagram Generation', unit: 'diagrams' },
      { code: 'IDEA_BANK', name: 'Idea Bank Access', unit: 'reservations' },
      { code: 'PERSONA_SYNC', name: 'PersonaSync Style Learning', unit: 'trainings' },
      { code: 'IDEATION', name: 'Patent Ideation Engine', unit: 'sessions' },
      { code: 'PAPER_DRAFTING', name: 'Academic Paper Drafting', unit: 'tokens' }
    ]

    const featuresByCode = {}
    for (const def of featureDefs) {
      const feature = await prisma.feature.upsert({
        where: { code: def.code },
        update: { name: def.name, unit: def.unit },
        create: def
      })
      featuresByCode[def.code] = feature
    }
    console.log('   �o. Features ready:', Object.keys(featuresByCode))

    // 2. Tasks
    console.log('\n2. Ensuring tasks...')
    const taskDefs = [
      { code: 'LLM1_PRIOR_ART', name: 'Prior Art Search', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'LLM2_DRAFT', name: 'Patent Drafting', linkedFeature: 'PATENT_DRAFTING' },
      { code: 'LLM3_DIAGRAM', name: 'Diagram Generation', linkedFeature: 'DIAGRAM_GENERATION' },
      { code: 'LLM4_NOVELTY_SCREEN', name: 'Novelty Screening', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'LLM5_NOVELTY_ASSESS', name: 'Novelty Assessment', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'LLM6_REPORT_GENERATION', name: 'Report Generation', linkedFeature: 'PRIOR_ART_SEARCH' },
      { code: 'LLM1_CLAIM_REFINEMENT', name: 'Claim Refinement', linkedFeature: 'PATENT_DRAFTING' },
      { code: 'IDEA_BANK_ACCESS', name: 'Idea Bank Access', linkedFeature: 'IDEA_BANK' },
      { code: 'IDEA_BANK_RESERVE', name: 'Idea Reservation', linkedFeature: 'IDEA_BANK' },
      { code: 'IDEA_BANK_EDIT', name: 'Idea Editing', linkedFeature: 'IDEA_BANK' },
      { code: 'PERSONA_SYNC_LEARN', name: 'Style Learning', linkedFeature: 'PERSONA_SYNC' },
      // IDEATION tasks (7 stages of the mind-map ideation engine)
      { code: 'IDEATION_NORMALIZE', name: 'Seed Normalization', linkedFeature: 'IDEATION' },
      { code: 'IDEATION_CLASSIFY', name: 'Invention Classification', linkedFeature: 'IDEATION' },
      { code: 'IDEATION_CONTRADICTION_MAPPING', name: 'Contradiction Mapping', linkedFeature: 'IDEATION' },
      { code: 'IDEATION_EXPAND', name: 'Dimension Expansion', linkedFeature: 'IDEATION' },
      { code: 'IDEATION_OBVIOUSNESS_FILTER', name: 'Obviousness Filter', linkedFeature: 'IDEATION' },
      { code: 'IDEATION_GENERATE', name: 'Idea Frame Generation', linkedFeature: 'IDEATION' },
      { code: 'IDEATION_NOVELTY', name: 'Novelty Assessment', linkedFeature: 'IDEATION' },
      // PAPER_DRAFTING tasks (academic paper writing)
      { code: 'LITERATURE_RELEVANCE', name: 'Literature Relevance Analysis', linkedFeature: 'PAPER_DRAFTING' }
    ]

    for (const def of taskDefs) {
      const linkedFeature = featuresByCode[def.linkedFeature]
      if (!linkedFeature) {
        throw new Error(`Missing feature for task ${def.code}: ${def.linkedFeature}`)
      }

      await prisma.task.upsert({
        where: { code: def.code },
        update: {
          name: def.name,
          linkedFeatureId: linkedFeature.id
        },
        create: {
          code: def.code,
          name: def.name,
          linkedFeatureId: linkedFeature.id
        }
      })
    }
    console.log('   �o. Tasks ready:', taskDefs.map(t => t.code))

    // 3. Model classes
    console.log('\n3. Ensuring LLM model classes...')
    const modelDefs = [
      { code: 'BASE_S', name: 'Base Small' },
      { code: 'BASE_M', name: 'Base Medium' },
      { code: 'PRO_M', name: 'Professional Medium' },
      { code: 'PRO_L', name: 'Professional Large' },
      { code: 'ADVANCED', name: 'Advanced' }
    ]

    const modelByCode = {}
    for (const def of modelDefs) {
      const mc = await prisma.lLMModelClass.upsert({
        where: { code: def.code },
        update: { name: def.name },
        create: def
      })
      modelByCode[def.code] = mc
    }
    console.log('   �o. Model classes ready:', Object.keys(modelByCode))

    // 4. Plans
    console.log('\n4. Ensuring plans (Basic/Pro/Enterprise)...')
    const planDefs = [
      {
        code: 'FREE_PLAN',
        name: 'Basic Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE'
      },
      {
        code: 'PRO_PLAN',
        name: 'Professional Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE'
      },
      {
        code: 'ENTERPRISE_PLAN',
        name: 'Enterprise Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE'
      }
    ]

    const plansByCode = {}
    for (const def of planDefs) {
      const plan = await prisma.plan.upsert({
        where: { code: def.code },
        update: {
          name: def.name,
          cycle: def.cycle,
          status: def.status
        },
        create: def
      })
      plansByCode[def.code] = plan
    }
    console.log('   �o. Plans ready:', Object.keys(plansByCode))

    // 5. Plan features (quotas per feature per plan)
    console.log('\n5. Ensuring plan feature quotas...')
    const planFeatureDefs = [
      // BASIC PLAN (FREE_PLAN) - Patent drafting + novelty search (no Idea Bank, no Ideation)
      { planCode: 'FREE_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 50, dailyQuota: 10 },
      { planCode: 'FREE_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 1000, dailyQuota: 100 },
      { planCode: 'FREE_PLAN', featureCode: 'PAPER_DRAFTING', monthlyQuota: 1000, dailyQuota: 100 },

      // PRO PLAN - Basic services + Idea Bank + Diagram generation + Ideation + Paper Drafting
      { planCode: 'PRO_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 1000, dailyQuota: 100 },
      { planCode: 'PRO_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 10000, dailyQuota: 1000 },
      { planCode: 'PRO_PLAN', featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 200, dailyQuota: 40 },
      { planCode: 'PRO_PLAN', featureCode: 'IDEA_BANK', monthlyQuota: 50, dailyQuota: 10 },
      { planCode: 'PRO_PLAN', featureCode: 'IDEATION', monthlyQuota: 500, dailyQuota: 50, monthlyTokenLimit: 5000000, dailyTokenLimit: 500000 },
      { planCode: 'PRO_PLAN', featureCode: 'PAPER_DRAFTING', monthlyQuota: 10000, dailyQuota: 1000, monthlyTokenLimit: 10000000, dailyTokenLimit: 1000000 },

      // ENTERPRISE PLAN - Everything (all features)
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'PRIOR_ART_SEARCH', monthlyQuota: 5000, dailyQuota: 500 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'PATENT_DRAFTING', monthlyQuota: 50000, dailyQuota: 5000 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'DIAGRAM_GENERATION', monthlyQuota: 500, dailyQuota: 100 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'IDEA_BANK', monthlyQuota: 200, dailyQuota: 50 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'PERSONA_SYNC', monthlyQuota: 50, dailyQuota: 10 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'IDEATION', monthlyQuota: 2000, dailyQuota: 200, monthlyTokenLimit: 20000000, dailyTokenLimit: 2000000 },
      { planCode: 'ENTERPRISE_PLAN', featureCode: 'PAPER_DRAFTING', monthlyQuota: 50000, dailyQuota: 5000, monthlyTokenLimit: 50000000, dailyTokenLimit: 5000000 }
    ]

    for (const def of planFeatureDefs) {
      const plan = plansByCode[def.planCode]
      const feature = featuresByCode[def.featureCode]
      if (!plan || !feature) {
        throw new Error(`Missing plan/feature for PlanFeature: ${def.planCode} / ${def.featureCode}`)
      }

      const updateData = {
        monthlyQuota: def.monthlyQuota,
        dailyQuota: def.dailyQuota
      }
      
      // Add token limits if specified (used by IDEATION feature)
      if (def.monthlyTokenLimit !== undefined) {
        updateData.monthlyTokenLimit = def.monthlyTokenLimit
      }
      if (def.dailyTokenLimit !== undefined) {
        updateData.dailyTokenLimit = def.dailyTokenLimit
      }

      await prisma.planFeature.upsert({
        where: {
          planId_featureId: {
            planId: plan.id,
            featureId: feature.id
          }
        },
        update: updateData,
        create: {
          planId: plan.id,
          featureId: feature.id,
          ...updateData
        }
      })
    }
    console.log('   �o. Plan features ensured:', planFeatureDefs.length, 'rows')

    // 6. Plan LLM access
    console.log('\n6. Ensuring plan LLM access rules...')
    const llmAccessDefs = [
      // BASIC PLAN (FREE_PLAN) - Patent drafting + novelty search + Paper drafting
      { planCode: 'FREE_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      { planCode: 'FREE_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_S'], defaultClass: 'BASE_S' },
      // FREE PLAN - Paper drafting tasks
      { planCode: 'FREE_PLAN', taskCode: 'LITERATURE_RELEVANCE', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_S' },

      // PRO PLAN - Basic services + Idea Bank + Diagram generation
      { planCode: 'PRO_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_L' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM3_DIAGRAM', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_ACCESS', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_RESERVE', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEA_BANK_EDIT', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      // PRO PLAN - IDEATION tasks (lightweight stages use BASE_M, heavy stages use PRO_M)
      { planCode: 'PRO_PLAN', taskCode: 'IDEATION_NORMALIZE', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEATION_CLASSIFY', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEATION_CONTRADICTION_MAPPING', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEATION_EXPAND', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEATION_OBVIOUSNESS_FILTER', allowedClasses: ['BASE_S', 'BASE_M'], defaultClass: 'BASE_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEATION_GENERATE', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'PRO_PLAN', taskCode: 'IDEATION_NOVELTY', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      // PRO PLAN - Paper drafting tasks
      { planCode: 'PRO_PLAN', taskCode: 'LITERATURE_RELEVANCE', allowedClasses: ['BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },

      // ENTERPRISE PLAN - All access (everything)
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM1_PRIOR_ART', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM2_DRAFT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM3_DIAGRAM', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM4_NOVELTY_SCREEN', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_L' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM5_NOVELTY_ASSESS', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM6_REPORT_GENERATION', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_ACCESS', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_RESERVE', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEA_BANK_EDIT', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'PERSONA_SYNC_LEARN', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      // ENTERPRISE PLAN - IDEATION tasks (access to all model tiers)
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEATION_NORMALIZE', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEATION_CLASSIFY', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEATION_CONTRADICTION_MAPPING', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEATION_EXPAND', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEATION_OBVIOUSNESS_FILTER', allowedClasses: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L'], defaultClass: 'PRO_M' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEATION_GENERATE', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'IDEATION_NOVELTY', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' },
      // ENTERPRISE PLAN - Paper drafting tasks
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LITERATURE_RELEVANCE', allowedClasses: ['BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], defaultClass: 'ADVANCED' }
    ]

    for (const def of llmAccessDefs) {
      const plan = plansByCode[def.planCode]
      const defaultClass = modelByCode[def.defaultClass]
      if (!plan || !defaultClass) {
        throw new Error(`Missing plan/modelClass for PlanLLMAccess: ${def.planCode} / ${def.taskCode}`)
      }

      await prisma.planLLMAccess.upsert({
        where: {
          planId_taskCode: {
            planId: plan.id,
            taskCode: def.taskCode
          }
        },
        update: {
          allowedClasses: JSON.stringify(def.allowedClasses),
          defaultClassId: defaultClass.id
        },
        create: {
          planId: plan.id,
          taskCode: def.taskCode,
          allowedClasses: JSON.stringify(def.allowedClasses),
          defaultClassId: defaultClass.id
        }
      })
    }
    console.log('   �o. Plan LLM access ensured:', llmAccessDefs.length, 'rows')

    // 7. Plan-specific concurrency limits for production
    console.log('\n7. Setting plan-specific concurrency limits...')
    const concurrencyRules = [
      // FREE_PLAN - Very limited concurrency for basic users
      { planCode: 'FREE_PLAN', taskCode: 'LLM2_DRAFT', concurrencyLimit: 1 },
      { planCode: 'FREE_PLAN', taskCode: 'LLM1_PRIOR_ART', concurrencyLimit: 1 },

      // PRO_PLAN - Moderate concurrency for professional users
      { planCode: 'PRO_PLAN', taskCode: 'LLM2_DRAFT', concurrencyLimit: 3 },
      { planCode: 'PRO_PLAN', taskCode: 'LLM1_PRIOR_ART', concurrencyLimit: 2 },
      { planCode: 'PRO_PLAN', taskCode: 'LLM3_DIAGRAM', concurrencyLimit: 2 },

      // ENTERPRISE_PLAN - High concurrency for enterprise users
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM2_DRAFT', concurrencyLimit: 5 },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM1_PRIOR_ART', concurrencyLimit: 3 },
      { planCode: 'ENTERPRISE_PLAN', taskCode: 'LLM3_DIAGRAM', concurrencyLimit: 3 },
    ]

    for (const rule of concurrencyRules) {
      const plan = plansByCode[rule.planCode]
      if (!plan) {
        console.warn(`⚠️ Plan ${rule.planCode} not found, skipping concurrency rule`)
        continue
      }

      await prisma.policyRule.upsert({
        where: {
          scope_scopeId_taskCode_key: {
            scope: 'plan',
            scopeId: plan.id,
            taskCode: rule.taskCode,
            key: 'concurrency_limit'
          }
        },
        update: { value: rule.concurrencyLimit },
        create: {
          scope: 'plan',
          scopeId: plan.id,
          taskCode: rule.taskCode,
          key: 'concurrency_limit',
          value: rule.concurrencyLimit
        }
      })
    }
    console.log('   �o. Concurrency limits set for all plans')

    console.log('\n dY"S Production plan seeding complete.')
  } catch (error) {
    console.error('\n �?O Production plan seeding failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  seedProductionPlans()
}

