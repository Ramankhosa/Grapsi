import { prisma } from '@/lib/prisma'
import { llmGateway, type TenantContext } from '@/lib/metering'

export const GRANT_PREP_CHAT_TASK_CODE = 'GRANT_PREP_CHAT'
export const GRANT_PREP_CHAT_STAGE_CODE = 'GRANT_PREP_CHAT'

export async function resolveGrantPrepTenantContext(
  tenantId: string,
  userId: string
): Promise<TenantContext | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      tenantPlans: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  })

  if (!tenant || tenant.status !== 'ACTIVE' || !tenant.tenantPlans[0]) {
    return null
  }

  return {
    tenantId: tenant.id,
    planId: tenant.tenantPlans[0].planId,
    tenantStatus: tenant.status,
    userId,
  }
}

export async function generateGrantPrepText(input: {
  prompt: string
  tenantContext: TenantContext | null
  action?: string
  idempotencyKey?: string
  parameters?: Record<string, any>
  metadata?: Record<string, any>
}) {
  if (!input.tenantContext) {
    throw new Error('Grant Prep LLM usage requires an active tenant plan.')
  }

  const result = await llmGateway.executeLLMOperation(
    { tenantContext: input.tenantContext },
    {
      taskCode: GRANT_PREP_CHAT_TASK_CODE,
      stageCode: GRANT_PREP_CHAT_STAGE_CODE,
      prompt: input.prompt,
      parameters: {
        purpose: 'grant_prep_chat',
        temperature: 0.4,
        ...input.parameters,
      },
      idempotencyKey: input.idempotencyKey || crypto.randomUUID(),
      metadata: {
        module: 'grantPrep',
        action: input.action || 'chat',
        ...input.metadata,
      },
    }
  )

  if (!result.success || !result.response?.output) {
    throw new Error(result.error?.message || 'Grant Prep LLM request failed before returning output.')
  }

  return result.response.output
}
