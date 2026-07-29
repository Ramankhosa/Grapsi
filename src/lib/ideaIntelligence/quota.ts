import { NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'

const SERVICE_TYPE = 'FUNDING_DISCOVERY' as const

export type IdeaIntelligenceOperationType =
  | 'idea_intelligence_execute'
  | 'idea_intelligence_refine'
  // Reading the idea against one user-chosen funding call.
  | 'idea_intelligence_call_fit'

export async function reserveIdeaIntelligenceUsage(
  actor: FundingActor,
  operationId: string,
  operationType: IdeaIntelligenceOperationType
): Promise<{ reserved: false } | { reserved: true; tenantId: string; operationId: string } | { response: NextResponse }> {
  if (actor.isSuperAdmin || !actor.tenantId) {
    return { reserved: false }
  }

  try {
    await reserveServiceUsage({
      tenantId: actor.tenantId,
      userId: actor.id,
      serviceType: SERVICE_TYPE,
      operationId,
      operationType,
      metadata: { feature: 'idea_intelligence' },
    })
    return { reserved: true, tenantId: actor.tenantId, operationId }
  } catch (error) {
    if (error instanceof ServiceQuotaExceededError) {
      return {
        response: NextResponse.json(
          { error: error.message, message: error.message, code: error.code },
          { status: 429 }
        ),
      }
    }
    console.error('[IdeaIntelligenceQuota] Reservation failed:', error)
    return {
      response: NextResponse.json(
        { error: 'Funding intelligence quota could not be verified.', code: 'QUOTA_CHECK_FAILED' },
        { status: 503 }
      ),
    }
  }
}

export async function completeIdeaIntelligenceUsage(
  reservation: Awaited<ReturnType<typeof reserveIdeaIntelligenceUsage>>,
  actor: FundingActor,
  operationType: IdeaIntelligenceOperationType,
  metadata?: Record<string, unknown>
) {
  if (!('reserved' in reservation) || !reservation.reserved) return
  await trackServiceUsage({
    tenantId: reservation.tenantId,
    userId: actor.id,
    serviceType: SERVICE_TYPE,
    operationId: reservation.operationId,
    operationType,
    isCompleted: true,
    metadata: { feature: 'idea_intelligence', ...metadata },
  })
}

export async function releaseIdeaIntelligenceUsage(reservation: Awaited<ReturnType<typeof reserveIdeaIntelligenceUsage>>) {
  if (!('reserved' in reservation) || !reservation.reserved) return
  await releaseReservedServiceUsage(reservation.tenantId, SERVICE_TYPE, reservation.operationId)
}
