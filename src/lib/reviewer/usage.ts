/**
 * Reviewer usage recording.
 *
 * A "reviewer run" is one AI review the tenant paid for: a section review, or
 * the final report that scores the whole proposal. Each run is written to the
 * `ServiceCompletionUsage` ledger under `GRANT_REVIEW` so plan quotas apply to
 * the reviewer the same way they apply to every other service.
 *
 * Operation ids are deterministic, so re-running the same review does not count
 * twice: a section run is keyed by section version, a report by its call.
 */

import { prisma } from '@/lib/prisma'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'

const SERVICE_TYPE = 'GRANT_REVIEW' as const

export type ReviewerOperationType = 'reviewer_section_review' | 'reviewer_final_report'

export interface ReviewerUsageReservation {
  reserved: boolean
  tenantId?: string
  userId?: string
  operationId?: string
  operationType?: ReviewerOperationType
}

export function reviewerSectionOperationId(sectionId: string, version: number | null | undefined): string {
  return `reviewer-section:${sectionId}:v${version ?? 1}`
}

export function reviewerReportOperationId(callId: string): string {
  return `reviewer-report:${callId}`
}

/**
 * Resolve who a reviewer call belongs to. Standalone reviewer calls predate
 * tenanting and can still carry a null `tenantId`, in which case the owning
 * user's tenant is authoritative.
 */
export async function resolveReviewerCallOwner(
  callId: string
): Promise<{ tenantId: string | null; userId: string | null }> {
  const call = await prisma.reviewerCall.findUnique({
    where: { id: callId },
    select: { tenantId: true, user_id: true },
  })

  if (!call) return { tenantId: null, userId: null }
  if (call.tenantId) return { tenantId: call.tenantId, userId: call.user_id }

  const user = await prisma.user.findUnique({
    where: { id: call.user_id },
    select: { tenantId: true },
  })

  return { tenantId: user?.tenantId ?? null, userId: call.user_id }
}

/**
 * Hold a slot before the LLM runs. Returns `{ reserved: false }` for callers
 * with no tenant (platform admins, legacy untenanted calls) so the review still
 * proceeds — those runs are simply not billable to anyone.
 *
 * Throws `ServiceQuotaExceededError` when the tenant is out of quota.
 */
export async function reserveReviewerUsage(params: {
  callId: string
  operationId: string
  operationType: ReviewerOperationType
  metadata?: Record<string, unknown>
}): Promise<ReviewerUsageReservation> {
  const owner = await resolveReviewerCallOwner(params.callId)
  if (!owner.tenantId || !owner.userId) {
    return { reserved: false }
  }

  await reserveServiceUsage({
    tenantId: owner.tenantId,
    userId: owner.userId,
    serviceType: SERVICE_TYPE,
    operationId: params.operationId,
    operationType: params.operationType,
    metadata: { feature: 'grant_reviewer', callId: params.callId, ...params.metadata },
  })

  return {
    reserved: true,
    tenantId: owner.tenantId,
    userId: owner.userId,
    operationId: params.operationId,
    operationType: params.operationType,
  }
}

export async function completeReviewerUsage(
  reservation: ReviewerUsageReservation,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!reservation.reserved || !reservation.tenantId || !reservation.userId || !reservation.operationId) return

  await trackServiceUsage({
    tenantId: reservation.tenantId,
    userId: reservation.userId,
    serviceType: SERVICE_TYPE,
    operationId: reservation.operationId,
    operationType: reservation.operationType || 'reviewer_section_review',
    isCompleted: true,
    metadata: { feature: 'grant_reviewer', ...metadata },
  })
}

export async function releaseReviewerUsage(reservation: ReviewerUsageReservation): Promise<void> {
  if (!reservation.reserved || !reservation.tenantId || !reservation.operationId) return
  await releaseReservedServiceUsage(reservation.tenantId, SERVICE_TYPE, reservation.operationId)
}

export { ServiceQuotaExceededError }
