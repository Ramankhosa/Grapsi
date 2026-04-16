const { PrismaClient } = require('@prisma/client');

async function checkAllLLMStages() {
  const prisma = new PrismaClient();

  try {
    console.log('Checking ALL stages that use LLM operations...\n');

    // Get all workflow stages that have LLM configurations
    const allStages = await prisma.workflowStage.findMany({
      include: {
        stageConfigs: {
          include: {
            plan: true,
            model: true
          }
        }
      },
      orderBy: { code: 'asc' }
    });

    console.log(`Found ${allStages.length} total workflow stages:\n`);

    for (const stage of allStages) {
      if (stage.stageConfigs && stage.stageConfigs.length > 0) {
        console.log(`\n=== ${stage.code} ===`);
        console.log(`Description: ${stage.description || 'N/A'}`);

        const configsByPlan = {};
        stage.stageConfigs.forEach(config => {
          if (!configsByPlan[config.plan.code]) {
            configsByPlan[config.plan.code] = [];
          }
          configsByPlan[config.plan.code].push(config);
        });

        Object.keys(configsByPlan).forEach(planCode => {
          const configs = configsByPlan[planCode];
          console.log(`  ${planCode}:`);
          configs.forEach(config => {
            console.log(`    Model: ${config.model.code}, maxTokensIn: ${config.maxTokensIn}, maxTokensOut: ${config.maxTokensOut}`);

            // Check for potential issues
            if (config.maxTokensIn > 2000) {
              console.log(`    ✅ This stage benefits from the token limit fix (was capped at 2000, now uses ${config.maxTokensIn})`);
            } else if (config.maxTokensIn === 2000) {
              console.log(`    ⚪ This stage is at default limit (2000) - not affected by capping bug`);
            } else {
              console.log(`    ⚪ This stage has low limit (${config.maxTokensIn}) - may need review`);
            }
          });
        });
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log('✅ Stages with maxTokensIn > 2000: These were being capped and are now fixed');
    console.log('⚪ Stages with maxTokensIn = 2000: These work at default limit');
    console.log('⚪ Stages with maxTokensIn < 2000: These have intentionally low limits');

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllLLMStages();
