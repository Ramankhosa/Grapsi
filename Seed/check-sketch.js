const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  console.log('🎨 Sketch Generation Model Config:\n');
  const configs = await p.planStageModelConfig.findMany({
    where: { stage: { code: 'DRAFT_SKETCH_GENERATION' } },
    include: { plan: true, stage: true, model: true }
  });
  configs.forEach(c => {
    console.log(`  ${c.plan.code}: ${c.model.code} (${c.model.displayName})`);
  });
  await p.$disconnect();
})();

