import prisma from '@/lib/prisma'
import type { TenantContext } from '@/lib/metering/types'

const GRANT_WORKFLOW_STAGE_CODES = [
  'GRANT_PREP_CHAT',
  'GRANT_BLUEPRINT_GEN',
  'GRANT_BLUEPRINT_GENERATE',
  'GRANT_SECTION_GENERATE',
]

async function getGrantWorkflowControlPlanId(): Promise<string | null> {
  const configuredPlan = (
    process.env.GRANT_WORKFLOW_CONTROL_PLAN_ID ||
    process.env.GRANT_WORKFLOW_CONTROL_PLAN_CODE ||
    process.env.FUNDING_LLM_CONTROL_PLAN_ID ||
    process.env.FUNDING_LLM_CONTROL_PLAN_CODE ||
    ''
  ).trim()

  if (configuredPlan) {
    const plan = await prisma.plan.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [{ id: configuredPlan }, { code: configuredPlan }],
      },
      select: { id: true },
    })

    if (plan?.id) {
      return plan.id
    }

    console.warn(`[GrantWorkflow] Configured control plan was not found or inactive: ${configuredPlan}`)
  }

  for (const code of ['PRO_PLAN', 'ENTERPRISE_PLAN', 'FREE_PLAN']) {
    const preferredPlan = await prisma.plan.findFirst({
      where: { status: 'ACTIVE', code },
      select: { id: true },
    })

    if (preferredPlan?.id) {
      return preferredPlan.id
    }
  }

  const planWithGrantConfig = await prisma.planStageModelConfig.findFirst({
    where: {
      isActive: true,
      plan: { status: 'ACTIVE' },
      stage: { code: { in: GRANT_WORKFLOW_STAGE_CODES } },
    },
    orderBy: { createdAt: 'asc' },
    select: { planId: true },
  })

  if (planWithGrantConfig?.planId) {
    return planWithGrantConfig.planId
  }

  const firstActivePlan = await prisma.plan.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { code: 'asc' },
    select: { id: true },
  })

  return firstActivePlan?.id || null
}

export async function resolveGrantWorkflowTenantContext(
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

  if (!tenant || tenant.status !== 'ACTIVE') {
    return null
  }

  const planId = tenant.tenantPlans[0]?.planId || await getGrantWorkflowControlPlanId()
  if (!planId) {
    return null
  }

  return {
    tenantId: tenant.id,
    planId,
    tenantStatus: tenant.status,
    userId,
  }
}
