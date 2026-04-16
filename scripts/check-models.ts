import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Check available models
  const models = await prisma.lLMModel.findMany({
    where: { isActive: true },
    select: { id: true, code: true, displayName: true, isDefault: true },
    orderBy: { displayName: 'asc' }
  })
  
  console.log('\n📊 Available LLM Models:')
  console.log('═'.repeat(60))
  models.forEach(m => {
    const marker = m.isDefault ? '⭐ DEFAULT' : '  '
    console.log(`  ${marker} ${m.code}`)
  })
  
  // Check current stage configurations
  const configs = await prisma.planStageModelConfig.findMany({
    include: {
      stage: { select: { code: true, displayName: true } },
      model: { select: { code: true, displayName: true } },
      plan: { select: { name: true } }
    },
    where: {
      stage: {
        code: { startsWith: 'PAPER_' }
      }
    },
    orderBy: [
      { plan: { name: 'asc' } },
      { stage: { sortOrder: 'asc' } }
    ]
  })
  
  console.log('\n📋 Current Paper Writing Stage Configurations:')
  console.log('═'.repeat(80))
  
  let currentPlan = ''
  for (const config of configs) {
    if (config.plan.name !== currentPlan) {
      currentPlan = config.plan.name
      console.log(`\n🏷️  ${currentPlan}:`)
      console.log('─'.repeat(70))
    }
    console.log(`  ${config.stage.displayName.padEnd(30)} → ${config.model.code} (${config.maxTokensIn}/${config.maxTokensOut} tokens)`)
  }
  
  console.log('\n')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

