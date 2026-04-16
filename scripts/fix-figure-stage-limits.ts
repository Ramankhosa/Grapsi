import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const FIGURE_STAGE_LIMITS: Record<string, { maxTokensIn: number; maxTokensOut: number }> = {
  PAPER_DIAGRAM_GENERATOR:  { maxTokensIn: 32000, maxTokensOut: 8000 },
  PAPER_DIAGRAM_FROM_TEXT:  { maxTokensIn: 32000, maxTokensOut: 8000 },
  PAPER_CHART_GENERATOR:   { maxTokensIn: 24000, maxTokensOut: 8000 },
  PAPER_FIGURE_SUGGESTION: { maxTokensIn: 48000, maxTokensOut: 8000 },
  PAPER_FIGURE_METADATA_INFER: { maxTokensIn: 16000, maxTokensOut: 4000 },
  PAPER_SKETCH_GENERATION: { maxTokensIn: 24000, maxTokensOut: 8000 },
}

async function fixFigureStageLimits() {
  console.log('=== Fixing Figure-Generation Stage Token Limits ===\n')

  for (const [stageCode, limits] of Object.entries(FIGURE_STAGE_LIMITS)) {
    const stage = await prisma.workflowStage.findFirst({
      where: { code: stageCode },
    })

    if (!stage) {
      console.log(`  [SKIP] Stage ${stageCode} not found in DB`)
      continue
    }

    const configs = await prisma.planStageModelConfig.findMany({
      where: { stageId: stage.id },
      include: { model: { select: { code: true } } },
    })

    if (configs.length === 0) {
      console.log(`  [SKIP] No plan-stage configs for ${stageCode}`)
      continue
    }

    let updated = 0
    for (const cfg of configs) {
      const needsUpdate =
        !cfg.maxTokensIn ||
        cfg.maxTokensIn < limits.maxTokensIn ||
        !cfg.maxTokensOut ||
        cfg.maxTokensOut < limits.maxTokensOut

      if (needsUpdate) {
        await prisma.planStageModelConfig.update({
          where: { id: cfg.id },
          data: {
            maxTokensIn: Math.max(cfg.maxTokensIn ?? 0, limits.maxTokensIn),
            maxTokensOut: Math.max(cfg.maxTokensOut ?? 0, limits.maxTokensOut),
          },
        })
        console.log(
          `  [FIXED] ${stageCode} / model=${cfg.model?.code ?? cfg.modelId}: ` +
            `maxTokensIn ${cfg.maxTokensIn ?? 'NULL'} -> ${Math.max(cfg.maxTokensIn ?? 0, limits.maxTokensIn)}, ` +
            `maxTokensOut ${cfg.maxTokensOut ?? 'NULL'} -> ${Math.max(cfg.maxTokensOut ?? 0, limits.maxTokensOut)}`
        )
        updated++
      }
    }

    if (updated === 0) {
      console.log(`  [OK] ${stageCode} — all ${configs.length} config(s) already have adequate limits`)
    } else {
      console.log(`  [DONE] ${stageCode} — updated ${updated}/${configs.length} config(s)`)
    }
  }

  console.log('\n=== Finished ===')
}

fixFigureStageLimits()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
