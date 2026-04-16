#!/usr/bin/env node

/**
 * Add Diagram Generation feature and access to PRO_PLAN
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  try {
    console.log('🔧 Ensuring DIAGRAM_GENERATION feature and LLM3_DIAGRAM access on PRO_PLAN...')

    // Ensure feature exists
    const diagramFeature = await prisma.feature.upsert({
      where: { code: 'DIAGRAM_GENERATION' },
      update: {},
      create: { code: 'DIAGRAM_GENERATION', name: 'Diagram Generation', unit: 'calls' }
    })
    console.log('✅ Feature DIAGRAM_GENERATION:', diagramFeature.id)

    // Ensure task exists and is linked to feature
    const diagramTask = await prisma.task.upsert({
      where: { code: 'LLM3_DIAGRAM' },
      update: {},
      create: { code: 'LLM3_DIAGRAM', name: 'Diagram Generation', linkedFeatureId: diagramFeature.id }
    })
    console.log('✅ Task LLM3_DIAGRAM:', diagramTask.id)

    // Ensure plan exists
    const proPlan = await prisma.plan.upsert({
      where: { code: 'PRO_PLAN' },
      update: {},
      create: { code: 'PRO_PLAN', name: 'Professional Plan', cycle: 'MONTHLY', status: 'ACTIVE' }
    })
    console.log('✅ Plan PRO_PLAN:', proPlan.id)

    // Link feature to plan
    await prisma.planFeature.upsert({
      where: { planId_featureId: { planId: proPlan.id, featureId: diagramFeature.id } },
      update: {},
      create: { planId: proPlan.id, featureId: diagramFeature.id, monthlyQuota: 1000, dailyQuota: 100 }
    })
    console.log('✅ Linked DIAGRAM_GENERATION to PRO_PLAN (100/day, 1000/month)')

    // Ensure model classes (reuse existing if present)
    const baseS = await prisma.lLMModelClass.upsert({ where: { code: 'BASE_S' }, update: {}, create: { code: 'BASE_S', name: 'Base Small' } })
    const proM = await prisma.lLMModelClass.upsert({ where: { code: 'PRO_M' }, update: {}, create: { code: 'PRO_M', name: 'Pro Medium' } })

    // Grant LLM access for the diagram task on PRO_PLAN
    await prisma.planLLMAccess.upsert({
      where: { planId_taskCode: { planId: proPlan.id, taskCode: 'LLM3_DIAGRAM' } },
      update: { allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']), defaultClassId: proM.id },
      create: { planId: proPlan.id, taskCode: 'LLM3_DIAGRAM', allowedClasses: JSON.stringify(['BASE_S', 'PRO_M']), defaultClassId: proM.id }
    })
    console.log('✅ LLM access for LLM3_DIAGRAM granted on PRO_PLAN')

    console.log('🎉 Done.')
  } catch (e) {
    console.error('❌ Error updating plan:', e)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}


