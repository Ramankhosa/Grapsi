const { PrismaClient } = require('@prisma/client');

async function checkAllStageLimits() {
  const prisma = new PrismaClient();

  try {
    // All draft stages that use LLM
    const draftStages = [
      'DRAFT_IDEA_ENTRY',
      'DRAFT_CLAIM_GENERATION',
      'DRAFT_PRIOR_ART_ANALYSIS',
      'DRAFT_CLAIM_REFINEMENT',
      'DRAFT_FIGURE_PLANNER',
      'DRAFT_SKETCH_GENERATION',
      'DRAFT_DIAGRAM_GENERATION',
      'DRAFT_ANNEXURE_TITLE',
      'DRAFT_ANNEXURE_PREAMBLE',
      'DRAFT_ANNEXURE_FIELD',
      'DRAFT_ANNEXURE_BACKGROUND',
      'DRAFT_ANNEXURE_OBJECTS',
      'DRAFT_ANNEXURE_SUMMARY',
      'DRAFT_ANNEXURE_TECHNICAL_PROBLEM',
      'DRAFT_ANNEXURE_TECHNICAL_SOLUTION',
      'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS',
      'DRAFT_ANNEXURE_DRAWINGS',
      'DRAFT_ANNEXURE_DESCRIPTION',
      'DRAFT_ANNEXURE_BEST_MODE',
      'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY',
      'DRAFT_ANNEXURE_CLAIMS',
      'DRAFT_ANNEXURE_ABSTRACT',
      'DRAFT_ANNEXURE_NUMERALS',
      'DRAFT_ANNEXURE_CROSS_REFERENCE',
      'DRAFT_REVIEW'
    ];

    console.log('Checking token limits for all draft stages...\n');

    for (const stageCode of draftStages) {
      console.log(`\n=== ${stageCode} ===`);

      const configs = await prisma.planStageModelConfig.findMany({
        where: {
          stage: { code: stageCode }
        },
        include: {
          plan: true,
          stage: true,
          model: true
        },
        orderBy: { priority: 'desc' }
      });

      if (configs.length === 0) {
        console.log(`❌ No configurations found for ${stageCode}`);
        continue;
      }

      configs.forEach(c => {
        console.log(`Plan: ${c.plan.code}, Model: ${c.model.code}, maxTokensIn: ${c.maxTokensIn}, maxTokensOut: ${c.maxTokensOut}, priority: ${c.priority}`);

        // Check for potentially problematic limits
        if (c.maxTokensIn < 1000) {
          console.log(`⚠️  WARNING: maxTokensIn ${c.maxTokensIn} seems very low for ${stageCode}`);
        }
        if (c.maxTokensOut < 1000 && stageCode !== 'DRAFT_ANNEXURE_TITLE' && stageCode !== 'DRAFT_ANNEXURE_ABSTRACT') {
          console.log(`⚠️  WARNING: maxTokensOut ${c.maxTokensOut} seems low for ${stageCode}`);
        }
      });
    }

    console.log('\n=== SUMMARY ===');
    console.log('All stages checked. Any warnings above indicate potential issues.');

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllStageLimits();































