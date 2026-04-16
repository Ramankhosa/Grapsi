import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixRemainingModels() {
  console.log('=== Fixing Remaining Invalid Models ===\n')

  // Models that need to be fixed
  const invalidToValid: Record<string, string> = {
    'gpt-5-mini': 'gpt-4o-mini',
    'gpt-5.1-thinking': 'gpt-4o',
    'gpt-5.1': 'gpt-4o',
    'gpt-5': 'gpt-4o',
  }

  // Get all valid models first
  const validModels = await prisma.lLMModel.findMany({
    where: { isActive: true }
  })
  console.log('Available valid models:', validModels.map(m => m.code).join(', '))

  // Find the replacement models
  const gpt4o = validModels.find(m => m.code === 'gpt-4o')
  const gpt4oMini = validModels.find(m => m.code === 'gpt-4o-mini')
  
  if (!gpt4o) {
    console.log('ERROR: gpt-4o not found in database!')
    return
  }

  // Find and fix configs with invalid models
  for (const [invalidCode, validCode] of Object.entries(invalidToValid)) {
    const invalidModel = await prisma.lLMModel.findFirst({
      where: { code: invalidCode }
    })
    
    if (invalidModel) {
      const replacementModel = validModels.find(m => m.code === validCode) || gpt4o
      
      // Update all configs using this invalid model
      const configs = await prisma.planStageModelConfig.findMany({
        where: { modelId: invalidModel.id }
      })
      
      if (configs.length > 0) {
        await prisma.planStageModelConfig.updateMany({
          where: { modelId: invalidModel.id },
          data: { modelId: replacementModel.id }
        })
        console.log(`Fixed ${configs.length} configs: ${invalidCode} -> ${replacementModel.code}`)
      }
    }
  }

  // Show final config
  console.log('\n=== Final Configuration ===')
  const ideationStages = await prisma.workflowStage.findMany({
    where: { code: { startsWith: 'IDEATION_' } }
  })
  
  for (const stage of ideationStages) {
    const configs = await prisma.planStageModelConfig.findMany({
      where: { stageId: stage.id },
      include: { 
        model: { select: { code: true } },
        plan: { select: { name: true } }
      }
    })
    
    for (const config of configs) {
      console.log(`${stage.code} | ${config.plan.name} | ${config.model.code}`)
    }
  }

  await prisma.$disconnect()
  console.log('\nDone!')
}

fixRemainingModels().catch(console.error)

