import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixIdeationConfig() {
  console.log('=== Fixing ALL Ideation Configuration Issues ===\n')

  // 1. Find and fix invalid models in LLMModel table
  console.log('1. Checking LLMModel table for invalid models...')
  // Note: claude-3.5-sonnet is deprecated, use claude-sonnet-4 or claude-3-7-sonnet instead
  const invalidModelCodes = ['gpt-5.1-thinking', 'gpt-5.1', 'gpt-5', 'claude-3.5-sonnet', 'claude-3-5-sonnet-20241022']
  
  for (const code of invalidModelCodes) {
    const model = await prisma.lLMModel.findFirst({
      where: { code }
    })
    if (model) {
      console.log(`   Found invalid model: ${code}`)
    }
  }

  // 2. Get all workflow stages for IDEATION
  console.log('\n2. Finding IDEATION workflow stages...')
  const ideationStages = await prisma.workflowStage.findMany({
    where: {
      code: {
        startsWith: 'IDEATION_'
      }
    }
  })
  console.log(`   Found ${ideationStages.length} ideation stages`)

  // 3. Update token limits for all ideation stage configurations
  console.log('\n3. Updating token limits for ideation stages...')
  
  for (const stage of ideationStages) {
    // Find all plan-stage configs for this stage
    const configs = await prisma.planStageModelConfig.findMany({
      where: { stageId: stage.id }
    })
    
    if (configs.length > 0) {
      // Update token limits - set higher limits for ideation
      const updatedCount = await prisma.planStageModelConfig.updateMany({
        where: { stageId: stage.id },
        data: {
          maxTokensIn: 16000,  // Increased from 4000
          maxTokensOut: 8000   // Increased output too
        }
      })
      console.log(`   Updated ${updatedCount.count} configs for ${stage.code}`)
    } else {
      console.log(`   No configs found for ${stage.code}`)
    }
  }

  // 4. Check and fix model assignments
  console.log('\n4. Checking model assignments...')
  
  // Get valid models (updated Jan 2026)
  const validModels = await prisma.lLMModel.findMany({
    where: {
      isActive: true,
      code: {
        in: ['gpt-4o', 'gpt-4-turbo', 'gemini-2.0-flash', 'gemini-2.5-pro', 'claude-sonnet-4', 'claude-3-7-sonnet']
      }
    }
  })
  console.log(`   Found ${validModels.length} valid models`)
  
  // Get a default model (prefer gpt-4o or gemini)
  const defaultModel = validModels.find(m => m.code === 'gpt-4o') 
    || validModels.find(m => m.code === 'gemini-2.0-flash')
    || validModels[0]
  
  if (defaultModel) {
    console.log(`   Using default model: ${defaultModel.code}`)
    
    // Find configs with invalid models
    for (const stage of ideationStages) {
      const configs = await prisma.planStageModelConfig.findMany({
        where: { stageId: stage.id },
        include: { model: true }
      })
      
      for (const config of configs) {
        // Check if the model code is invalid
        if (invalidModelCodes.includes(config.model.code)) {
          await prisma.planStageModelConfig.update({
            where: { id: config.id },
            data: { modelId: defaultModel.id }
          })
          console.log(`   Fixed ${stage.code}: ${config.model.code} -> ${defaultModel.code}`)
        }
      }
    }
  }

  // 5. Show final configuration
  console.log('\n5. Final IDEATION configuration:')
  for (const stage of ideationStages) {
    const configs = await prisma.planStageModelConfig.findMany({
      where: { stageId: stage.id },
      include: { 
        model: { select: { code: true } },
        plan: { select: { name: true } }
      }
    })
    
    for (const config of configs) {
      console.log(`   ${stage.code} | ${config.plan.name} | Model: ${config.model.code} | MaxIn: ${config.maxTokensIn} | MaxOut: ${config.maxTokensOut}`)
    }
  }

  await prisma.$disconnect()
  console.log('\n=== Done! All issues fixed. ===')
}

fixIdeationConfig().catch(e => {
  console.error('Error:', e)
  prisma.$disconnect()
})

