/**
 * Funding chat usage recording.
 *
 * Two things are worth counting for the chatbot: how many conversations a
 * tenant opens, and how many turns it sends into them. Only the turns cost
 * money — a session with no messages runs no model — so the turn is the unit
 * the `FUNDING_CHAT` quota is enforced against, and it is the only thing
 * written to the ledger. Session counts come from the conversations table (see
 * `usage/service-usage-metrics.ts`); putting them in the ledger too would make
 * opening a chat window eat the tenant's message quota.
 *
 * A turn's operation id carries a per-turn nonce (the user message id, or a
 * random id for confirm turns). Retries are de-duplicated one level up via
 * `client_turn_id`; the nonce keeps a cleared-and-restarted conversation (turn
 * indices reset to 1) from re-using old completed ledger rows for free.
 */

import type { Prisma } from '@prisma/client'

import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'

const SERVICE_TYPE = 'FUNDING_CHAT' as const

export interface FundingChatUsageReservation {
  reserved: boolean
  tenantId?: string
  userId?: string
  operationId?: string
}

export function fundingChatMessageOperationId(conversationId: string, turnIndex: number, nonce: string): string {
  return `funding-chat-message:${conversationId}:${turnIndex}:${nonce}`
}

/**
 * Hold a quota slot for one chat turn. Throws `ServiceQuotaExceededError` when
 * the tenant is out of funding chat quota. Pass `tx` to reserve inside the
 * caller's transaction so a quota failure rolls the whole turn back with it.
 */
export async function reserveFundingChatMessage(params: {
  tenantId: string | null | undefined
  userId: string
  conversationId: string
  turnIndex: number
  /** Per-turn unique id (user message id, or a random id for confirm turns). */
  nonce: string
  tx?: Prisma.TransactionClient
}): Promise<FundingChatUsageReservation> {
  if (!params.tenantId) return { reserved: false }

  const operationId = fundingChatMessageOperationId(params.conversationId, params.turnIndex, params.nonce)

  await reserveServiceUsage({
    tenantId: params.tenantId,
    userId: params.userId,
    serviceType: SERVICE_TYPE,
    operationId,
    operationType: 'funding_chat_message',
    metadata: {
      feature: 'funding_chat',
      conversationId: params.conversationId,
      turnIndex: params.turnIndex,
    },
    tx: params.tx,
  })

  return { reserved: true, tenantId: params.tenantId, userId: params.userId, operationId }
}

export async function completeFundingChatMessage(
  reservation: FundingChatUsageReservation,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!reservation.reserved || !reservation.tenantId || !reservation.userId || !reservation.operationId) return

  await trackServiceUsage({
    tenantId: reservation.tenantId,
    userId: reservation.userId,
    serviceType: SERVICE_TYPE,
    operationId: reservation.operationId,
    operationType: 'funding_chat_message',
    isCompleted: true,
    metadata: { feature: 'funding_chat', ...metadata },
  })
}

export async function releaseFundingChatMessage(reservation: FundingChatUsageReservation): Promise<void> {
  if (!reservation.reserved || !reservation.tenantId || !reservation.operationId) return
  await releaseReservedServiceUsage(reservation.tenantId, SERVICE_TYPE, reservation.operationId)
}

export { ServiceQuotaExceededError }
