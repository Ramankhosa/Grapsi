/**
 * Seed script for Ideation Engine workflow stages
 * 
 * Run with: npx tsx scripts/seed-ideation-workflow-stages.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Seeding Ideation workflow stages...')

  // Ideation workflow stages
  const ideationStages = [
    {
      code: 'IDEATION_NORMALIZE',
      displayName: 'Seed Normalization',
      featureCode: 'IDEATION',
      description: 'Extracts structured information from the seed input (core entity, goal, constraints, unknowns, contradictions)',
      sortOrder: 1,
    },
    {
      code: 'IDEATION_CLASSIFY',
      displayName: 'Invention Classification',
      featureCode: 'IDEATION',
      description: 'Classifies the invention into categories (Product/Method/System/etc.) with multi-label support',
      sortOrder: 2,
    },
    {
      code: 'IDEATION_CONTRADICTION_MAPPING',
      displayName: 'Contradiction Mapping (Stage 2.5)',
      featureCode: 'IDEATION',
      description: 'Maps technical contradictions to TRIZ inventive principles and resolution strategies',
      sortOrder: 3,
    },
    {
      code: 'IDEATION_EXPAND',
      displayName: 'Dimension Expansion',
      featureCode: 'IDEATION',
      description: 'Expands dimension nodes with specific options based on the invention context',
      sortOrder: 4,
    },
    {
      code: 'IDEATION_OBVIOUSNESS_FILTER',
      displayName: 'Obviousness Filter (Stage 3.5)',
      featureCode: 'IDEATION',
      description: 'Scores selected dimensions for novelty before generation, suggests wildcards for obvious combinations',
      sortOrder: 5,
    },
    {
      code: 'IDEATION_GENERATE',
      displayName: 'Idea Frame Generation',
      featureCode: 'IDEATION',
      description: 'Generates structured invention ideas (IdeaFrames) from selected components, dimensions, and operators with inventive logic',
      sortOrder: 6,
    },
    {
      code: 'IDEATION_NOVELTY',
      displayName: 'Novelty Assessment',
      featureCode: 'IDEATION',
      description: 'Analyzes search results to assess novelty, provides mutation instructions for weak ideas',
      sortOrder: 7,
    },
  ]

  for (const stage of ideationStages) {
    await prisma.workflowStage.upsert({
      where: { code: stage.code },
      update: {
        displayName: stage.displayName,
        featureCode: stage.featureCode,
        description: stage.description,
        sortOrder: stage.sortOrder,
        isActive: true,
      },
      create: stage,
    })
    console.log(`  ✅ Created/updated stage: ${stage.code}`)
  }

  // Get the default model (or create mapping for plans)
  const defaultModel = await prisma.lLMModel.findFirst({
    where: { isDefault: true, isActive: true },
  })

  if (!defaultModel) {
    console.log('⚠️  No default LLM model found. Skipping plan-stage configuration.')
    console.log('   Run the LLM model seeding script first, then re-run this script.')
  } else {
    // Get all active plans
    const plans = await prisma.plan.findMany({
      where: { status: 'ACTIVE' },
    })

    console.log(`\n📋 Configuring ${plans.length} plans with ideation stages...`)

    for (const plan of plans) {
      // Get lightweight model for frequent tasks
      const lightweightModel = await prisma.lLMModel.findFirst({
        where: {
          OR: [
            { code: { contains: 'flash' } },
            { code: { contains: 'mini' } },
            { code: { contains: 'haiku' } },
          ],
          isActive: true,
        },
      }) || defaultModel

      // Get advanced model for heavy tasks
      const advancedModel = await prisma.lLMModel.findFirst({
        where: {
          OR: [
            { code: { contains: 'pro' } },
            { code: { contains: 'sonnet' } },
            { code: { contains: 'gpt-4o' } },
          ],
          isActive: true,
        },
      }) || defaultModel

      for (const stage of ideationStages) {
        const workflowStage = await prisma.workflowStage.findUnique({
          where: { code: stage.code },
        })

        if (!workflowStage) continue

        // Use lightweight model for normalize, classify, contradiction mapping, expand, obviousness filter
        // Use advanced model for generate, novelty (heavy reasoning tasks)
        const modelToUse = ['IDEATION_GENERATE', 'IDEATION_NOVELTY'].includes(stage.code)
          ? advancedModel
          : lightweightModel

        await prisma.planStageModelConfig.upsert({
          where: {
            planId_stageId: {
              planId: plan.id,
              stageId: workflowStage.id,
            },
          },
          update: {
            modelId: modelToUse.id,
            maxTokensIn: stage.code === 'IDEATION_GENERATE' ? 8000 : 4000,
            maxTokensOut: stage.code === 'IDEATION_GENERATE' ? 8192 : 4096,
            temperature: 0.7,
            isActive: true,
          },
          create: {
            planId: plan.id,
            stageId: workflowStage.id,
            modelId: modelToUse.id,
            maxTokensIn: stage.code === 'IDEATION_GENERATE' ? 8000 : 4000,
            maxTokensOut: stage.code === 'IDEATION_GENERATE' ? 8192 : 4096,
            temperature: 0.7,
            isActive: true,
          },
        })
      }

      console.log(`  ✅ Configured plan: ${plan.name}`)
    }
  }

  // Ensure the IDEATION feature exists
  const ideationFeature = await prisma.feature.upsert({
    where: { code: 'IDEATION' },
    update: {},
    create: {
      code: 'IDEATION',
      name: 'Patent Ideation Engine',
      unit: 'sessions',
    },
  })
  console.log(`\n✅ Feature: ${ideationFeature.code}`)

  // Create ideation tasks
  const tasks = [
    { code: 'IDEATION_NORMALIZE', name: 'Seed Normalization' },
    { code: 'IDEATION_CLASSIFY', name: 'Invention Classification' },
    { code: 'IDEATION_CONTRADICTION_MAPPING', name: 'Contradiction Mapping' },
    { code: 'IDEATION_EXPAND', name: 'Dimension Expansion' },
    { code: 'IDEATION_OBVIOUSNESS_FILTER', name: 'Obviousness Filter' },
    { code: 'IDEATION_GENERATE', name: 'Idea Frame Generation' },
    { code: 'IDEATION_NOVELTY', name: 'Novelty Assessment' },
  ]

  for (const task of tasks) {
    await prisma.task.upsert({
      where: { code: task.code as any },
      update: {
        name: task.name,
        linkedFeatureId: ideationFeature.id,
      },
      create: {
        code: task.code as any,
        name: task.name,
        linkedFeatureId: ideationFeature.id,
      },
    })
    console.log(`  ✅ Task: ${task.code}`)
  }

  console.log('\n✨ Ideation workflow stages seeded successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

