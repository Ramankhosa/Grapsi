#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  console.log('🔍 Verifying seed data...\n');
  
  // Check models
  const models = await prisma.lLMModel.count();
  console.log(`📦 LLM Models: ${models}`);
  
  // Check stages
  const stages = await prisma.workflowStage.count();
  console.log(`📋 Workflow Stages: ${stages}`);
  
  // Check plan configs
  const plans = ['FREE_PLAN', 'PRO_PLAN', 'ENTERPRISE_PLAN'];
  
  for (const planCode of plans) {
    const configs = await prisma.planStageModelConfig.findMany({
      where: { plan: { code: planCode } },
      include: { plan: true, stage: true, model: true },
      orderBy: { stage: { sortOrder: 'asc' } }
    });
    
    console.log(`\n📝 ${planCode} (${configs.length} stage configs):`);
    console.log('   Stage                           | Model                  | In      | Out');
    console.log('   ' + '-'.repeat(80));
    
    // Show first 10
    configs.slice(0, 10).forEach(c => {
      const stageName = c.stage.code.padEnd(32);
      const modelName = c.model.code.padEnd(22);
      const tokIn = (c.maxTokensIn || '-').toString().padStart(7);
      const tokOut = (c.maxTokensOut || '-').toString().padStart(7);
      console.log(`   ${stageName} | ${modelName} | ${tokIn} | ${tokOut}`);
    });
    
    if (configs.length > 10) {
      console.log(`   ... and ${configs.length - 10} more`);
    }
  }
  
  console.log('\n✅ Verification complete!');
}

verify()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect());

