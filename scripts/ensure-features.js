#!/usr/bin/env node

/**
 * Ensure basic features exist in database
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function ensureFeatures() {
  console.log('🔧 Ensuring basic features exist...\n')
  console.log('This script will create missing features required for the application.\n')

  try {
    // Check and create PRIOR_ART_SEARCH feature
    const priorArtFeature = await prisma.feature.upsert({
      where: { code: 'PRIOR_ART_SEARCH' },
      update: {},
      create: {
        code: 'PRIOR_ART_SEARCH',
        name: 'Prior Art Search',
        unit: 'calls'
      }
    })
    console.log('✅ PRIOR_ART_SEARCH feature:', priorArtFeature.id)

    // Check and create PATENT_DRAFTING feature
    const draftingFeature = await prisma.feature.upsert({
      where: { code: 'PATENT_DRAFTING' },
      update: {},
      create: {
        code: 'PATENT_DRAFTING',
        name: 'Patent Drafting',
        unit: 'tokens'
      }
    })
    console.log('✅ PATENT_DRAFTING feature:', draftingFeature.id)

    // Check and create model classes
    const baseSClass = await prisma.lLMModelClass.upsert({
      where: { code: 'BASE_S' },
      update: {},
      create: {
        code: 'BASE_S',
        name: 'Base Small'
      }
    })

    const proMClass = await prisma.lLMModelClass.upsert({
      where: { code: 'PRO_M' },
      update: {},
      create: {
        code: 'PRO_M',
        name: 'Pro Medium'
      }
    })

    console.log('✅ Model classes created')

    // Check and create tasks
    const priorArtTask = await prisma.task.upsert({
      where: { code: 'LLM1_PRIOR_ART' },
      update: {},
      create: {
        code: 'LLM1_PRIOR_ART',
        name: 'Prior Art Analysis',
        linkedFeatureId: priorArtFeature.id
      }
    })

    const noveltyAssessTask = await prisma.task.upsert({
      where: { code: 'LLM5_NOVELTY_ASSESS' },
      update: {},
      create: {
        code: 'LLM5_NOVELTY_ASSESS',
        name: 'Novelty Assessment',
        linkedFeatureId: priorArtFeature.id
      }
    })

    const draftingTask = await prisma.task.upsert({
      where: { code: 'LLM2_DRAFT' },
      update: {},
      create: {
        code: 'LLM2_DRAFT',
        name: 'Patent Drafting',
        linkedFeatureId: draftingFeature.id
      }
    })

    console.log('✅ Tasks created')

    // Check and create plans
    const freePlan = await prisma.plan.upsert({
      where: { code: 'FREE_PLAN' },
      update: {},
      create: {
        code: 'FREE_PLAN',
        name: 'Free Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE'
      }
    })

    const proPlan = await prisma.plan.upsert({
      where: { code: 'PRO_PLAN' },
      update: {},
      create: {
        code: 'PRO_PLAN',
        name: 'Professional Plan',
        cycle: 'MONTHLY',
        status: 'ACTIVE'
      }
    })

    console.log('✅ Plans created')

    // Create plan features for PRO_PLAN
    await prisma.planFeature.upsert({
      where: {
        planId_featureId: {
          planId: proPlan.id,
          featureId: priorArtFeature.id
        }
      },
      update: {},
      create: {
        planId: proPlan.id,
        featureId: priorArtFeature.id,
        monthlyQuota: 1000,
        dailyQuota: 100
      }
    })

    console.log('✅ Plan features created')

    // Create LLM access for PRO_PLAN
    await prisma.planLLMAccess.upsert({
      where: {
        planId_taskCode: {
          planId: proPlan.id,
          taskCode: 'LLM1_PRIOR_ART'
        }
      },
      update: {},
      create: {
        planId: proPlan.id,
        taskCode: 'LLM1_PRIOR_ART',
        allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']),
        defaultClassId: proMClass.id
      }
    })

    console.log('✅ LLM access created')

    console.log('\n🎉 Basic features setup complete!')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  ensureFeatures()
}
