/** Targeted, idempotent setup. Never rewrites another module's models/configs. */
import dotenv from 'dotenv'
dotenv.config()

async function main() {
  const { prisma } = await import('../src/lib/prisma')
  const { PLATFORM_TENANT_ATI, SERVICE_USER_EMAIL } = await import('../src/lib/monitor/actor')
  const { resolveFundingLlmTenantContext } = await import('../src/lib/funding/llmRouting')
  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { atiId: PLATFORM_TENANT_ATI() } })
    const old = await prisma.user.findUnique({ where: { email: SERVICE_USER_EMAIL() } })
    if (old && (old.roles.length || old.tenantId !== tenant.id)) throw new Error('Existing service identity has unexpected ownership or roles; setup stopped')
    const user = await prisma.user.upsert({ where: { email: SERVICE_USER_EMAIL() }, create: { email: SERVICE_USER_EMAIL(), name: 'Source Watch (system)', tenantId: tenant.id, roles: [] }, update: {} })
    const context = await resolveFundingLlmTenantContext({ tenantId: tenant.id, userId: user.id })
    if (!context?.planId) throw new Error('Platform billing has no active control plan')
    const stages = [
      { code: 'FUNDING_SOURCE_TRIAGE', name: 'Source Watch Screening', primary: 'glm-5.3-flash', fallback: 'gemini-3.1-flash', input: 32000, output: 4000 },
      { code: 'FUNDING_SOURCE_EXTRACT', name: 'Source Watch Evidence Extraction', primary: 'deepseek-v4-flash', fallback: 'gpt-5.2', input: 128000, output: 16000 },
      { code: 'FUNDING_SOURCE_OCR', name: 'Source Watch Selected Page OCR', primary: 'gemini-3.1-flash', fallback: 'claude-haiku-4.5', input: 128000, output: 12000 },
    ]
    await prisma.$transaction(async tx => {
      for (const item of stages) {
        const primary = await tx.lLMModel.findUniqueOrThrow({ where: { code: item.primary } })
        const fallback = await tx.lLMModel.findUniqueOrThrow({ where: { code: item.fallback } })
        if (!primary.isActive || !fallback.isActive || primary.provider === fallback.provider || primary.inputCostPer1M <= 0 || fallback.inputCostPer1M <= 0) throw new Error(`Invalid active model prices/fallback for ${item.code}`)
        const stage = await tx.workflowStage.upsert({ where: { code: item.code }, create: { code: item.code, displayName: item.name, featureCode: 'FUNDING_DISCOVERY' }, update: {} })
        await tx.planStageModelConfig.upsert({ where: { planId_stageId: { planId: context.planId!, stageId: stage.id } }, create: { planId: context.planId!, stageId: stage.id, modelId: primary.id, fallbackModelIds: JSON.stringify([fallback.id]), maxTokensIn: item.input, maxTokensOut: item.output, temperature: 0 }, update: {} })
      }
    })
    console.log('Source Watch identity and missing stage configurations are ready. Existing settings were preserved. No paid request was made.')
  } finally { await prisma.$disconnect() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Setup failed'); process.exitCode = 1 })
