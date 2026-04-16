const { PrismaClient } = require('@prisma/client');

async function checkProblematicStages() {
  const prisma = new PrismaClient();

  try {
    console.log('Checking stages that might be affected by the old token capping logic...\n');

    const configs = await prisma.planStageModelConfig.findMany({
      where: {
        maxTokensIn: {
          lte: 2000
        }
      },
      include: {
        plan: true,
        stage: true,
        model: true
      },
      orderBy: [
        { stage: { code: 'asc' } },
        { plan: { code: 'asc' } }
      ]
    });

    console.log(`Found ${configs.length} stage configurations with maxTokensIn <= 2000:\n`);

    configs.forEach(c => {
      console.log(`${c.stage.code} (${c.plan.code}): maxTokensIn=${c.maxTokensIn}, maxTokensOut=${c.maxTokensOut}, Model=${c.model.code}`);

      if (c.maxTokensIn < 2000) {
        console.log(`  ⚠️  This stage has maxTokensIn < 2000, so it was NOT affected by the capping bug`);
      } else if (c.maxTokensIn === 2000) {
        console.log(`  ⚠️  This stage has maxTokensIn = 2000, so it was NOT capped (equal to default)`);
      }
    });

    console.log('\n=== ANALYSIS ===');
    console.log('Stages with maxTokensIn < 2000: These were not affected by the bug');
    console.log('Stages with maxTokensIn = 2000: These would work but not benefit from higher limits');
    console.log('Stages with maxTokensIn > 2000: These were being capped at 2000 (now fixed)');

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkProblematicStages();































