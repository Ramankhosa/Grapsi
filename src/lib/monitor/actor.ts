import { resolveFundingLlmTenantContext } from '@/lib/funding/llmRouting'
import type { TenantContext } from '@/lib/metering/types'
import { prisma } from '@/lib/prisma'

/**
 * Who Source Watch's paid work is billed to: a dedicated service user in the
 * platform tenant. Usage rows carry real tenant and user ids (they have
 * foreign keys — the old 'platform-funding-ingestion' / 'system' placeholders
 * made every row fail to save), and nothing borrows a person's identity.
 *
 * Created by `npm run monitor:service-actor`, which needs the platform tenant
 * (atiId PLATFORM, or MONITOR_PLATFORM_TENANT_ATI) to exist already.
 */

export const SERVICE_USER_EMAIL = () => process.env.MONITOR_SERVICE_USER_EMAIL?.trim() || 'source-watch@system.invalid'
export const PLATFORM_TENANT_ATI = () => process.env.MONITOR_PLATFORM_TENANT_ATI?.trim() || 'PLATFORM'

export class MonitorConfigError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MonitorConfigError'
    this.code = code
  }
}

export interface MonitorActor {
  tenantId: string
  userId: string
  planId: string
  tenantContext: TenantContext
}

let cached: { actor: MonitorActor; at: number } | null = null
const CACHE_MS = 10 * 60 * 1000

export async function resolveMonitorActor(): Promise<MonitorActor> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.actor
  const tenant = await prisma.tenant.findFirst({ where: { atiId: PLATFORM_TENANT_ATI() }, select: { id: true } })
  if (!tenant) {
    throw new MonitorConfigError(
      'PLATFORM_TENANT_MISSING',
      `No tenant with atiId "${PLATFORM_TENANT_ATI()}" exists. Source Watch bills its AI work to the platform tenant; create it or set MONITOR_PLATFORM_TENANT_ATI.`
    )
  }
  const user = await prisma.user.findUnique({ where: { email: SERVICE_USER_EMAIL() }, select: { id: true, tenantId: true } })
  if (!user) {
    throw new MonitorConfigError(
      'SERVICE_USER_MISSING',
      `The Source Watch service user (${SERVICE_USER_EMAIL()}) does not exist. Run: npm run monitor:service-actor`
    )
  }
  if (user.tenantId !== tenant.id) throw new MonitorConfigError('SERVICE_TENANT_MISMATCH', 'The Source Watch actor must belong to the platform tenant')
  const tenantContext = await resolveFundingLlmTenantContext({ tenantId: tenant.id, userId: user.id })
  if (!tenantContext?.planId) {
    throw new MonitorConfigError('NO_CONTROL_PLAN', 'No active plan resolves for the platform tenant; Source Watch cannot pick a model.')
  }
  const actor = { tenantId: tenant.id, userId: user.id, planId: tenantContext.planId, tenantContext }
  cached = { actor, at: Date.now() }
  return actor
}

/** Test seam. */
export function resetMonitorActorCache(): void {
  cached = null
}
