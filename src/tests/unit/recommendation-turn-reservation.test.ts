import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Turn reservation for the funding chat: user message + turn index + quota slot
 * must land (or fail) together, and a repeated clientTurnId must replay instead
 * of creating and charging a second turn.
 */

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
    recommendationConversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    recommendationConversationMessage: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  }
  return {
    tx,
    transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    reserveFundingChatMessage: vi.fn(),
    completeFundingChatMessage: vi.fn(),
    releaseFundingChatMessage: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => {
  const client = {
    $transaction: mocks.transaction,
    recommendationConversation: mocks.tx.recommendationConversation,
    recommendationConversationMessage: mocks.tx.recommendationConversationMessage,
  }
  return { default: client, prisma: client }
})

vi.mock('@/lib/recommendations/usage', () => ({
  reserveFundingChatMessage: mocks.reserveFundingChatMessage,
  completeFundingChatMessage: mocks.completeFundingChatMessage,
  releaseFundingChatMessage: mocks.releaseFundingChatMessage,
}))

vi.mock('@/lib/funding/llmRouting', () => ({
  FUNDING_CHAT_ANSWER_STAGE_CODE: 'answer',
  FUNDING_CHAT_NARRATIVE_STAGE_CODE: 'narrative',
  FUNDING_CHAT_ORCHESTRATOR_STAGE_CODE: 'orchestrator',
  FUNDING_CHAT_TASK_CODE: 'funding-chat',
  runFundingGatewayText: vi.fn(async () => ({ rawText: '' })),
}))

import { RecommendationConversationService } from '@/lib/services/recommendationConversationService'

class QuotaError extends Error {
  code = 'DAILY_QUOTA_EXCEEDED'
}

describe('RecommendationConversationService.reserveTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tx.recommendationConversation.findFirst.mockResolvedValue({ id: 'conv-1' })
    mocks.tx.recommendationConversation.update.mockResolvedValue({ last_turn_index: 7 })
    mocks.tx.recommendationConversationMessage.findFirst.mockResolvedValue(null)
    mocks.tx.recommendationConversationMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'msg-1',
      ...data,
    }))
    mocks.reserveFundingChatMessage.mockResolvedValue({
      reserved: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
      operationId: 'op-1',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('claims the turn atomically and reserves quota inside the same transaction', async () => {
    const service = new RecommendationConversationService()
    const reserved = await (service as any).reserveTurn('user-1', 'tenant-1', 'conv-1', {
      message: 'hello',
      clientTurnId: 'client-1',
    })

    expect(reserved.replay).toBe(false)
    expect(reserved.turnIndex).toBe(7)
    expect(reserved.userMessageId).toBe('msg-1')

    // Atomic increment, not read-then-write.
    expect(mocks.tx.recommendationConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ last_turn_index: { increment: 1 } }) })
    )
    // Quota reserved on the transaction client, keyed by the user message id.
    expect(mocks.reserveFundingChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tx: mocks.tx, turnIndex: 7, nonce: 'msg-1', conversationId: 'conv-1' })
    )
    // Per-conversation advisory lock taken first.
    expect(mocks.tx.$queryRaw).toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ timeout: expect.any(Number) }))
  })

  it('propagates a quota failure from inside the transaction (nothing to release, everything rolls back)', async () => {
    mocks.reserveFundingChatMessage.mockRejectedValueOnce(new QuotaError('quota'))
    const service = new RecommendationConversationService()

    await expect(
      (service as any).reserveTurn('user-1', 'tenant-1', 'conv-1', { message: 'hello', clientTurnId: 'client-2' })
    ).rejects.toBeInstanceOf(QuotaError)

    // The message create happened inside the (rolled-back) transaction; no release
    // is attempted because no reservation ever escaped the transaction.
    expect(mocks.releaseFundingChatMessage).not.toHaveBeenCalled()
  })

  it('treats a repeated clientTurnId as a replay: no new message, no quota', async () => {
    mocks.tx.recommendationConversationMessage.findFirst.mockResolvedValueOnce({ id: 'existing' })
    const service = new RecommendationConversationService()

    const reserved = await (service as any).reserveTurn('user-1', 'tenant-1', 'conv-1', {
      message: 'hello',
      clientTurnId: 'client-1',
    })

    expect(reserved).toEqual({ replay: true })
    expect(mocks.tx.recommendationConversation.update).not.toHaveBeenCalled()
    expect(mocks.tx.recommendationConversationMessage.create).not.toHaveBeenCalled()
    expect(mocks.reserveFundingChatMessage).not.toHaveBeenCalled()
  })

  it('processMessage answers a replay with the current conversation and runs no turn', async () => {
    const service = new RecommendationConversationService()
    vi.spyOn(service as any, 'reserveTurn').mockResolvedValue({ replay: true })
    const detail = { id: 'conv-1', messages: [], runs: [] }
    vi.spyOn(service, 'getConversation').mockResolvedValue(detail as any)
    const outcomeSpy = vi.spyOn(service as any, 'createTurnOutcome')
    const events = vi.fn()

    const response = await service.processMessage('user-1', 'tenant-1', 'conv-1', { message: 'x', clientTurnId: 'c' }, undefined, events)

    expect(response).toEqual({ conversation: detail, stale: false, clientTurnId: 'c' })
    expect(outcomeSpy).not.toHaveBeenCalled()
    expect(events).not.toHaveBeenCalled()
    expect(mocks.completeFundingChatMessage).not.toHaveBeenCalled()
  })

  it('throws a typed 404 when the conversation does not belong to the caller', async () => {
    mocks.tx.recommendationConversation.findFirst.mockResolvedValueOnce(null)
    const service = new RecommendationConversationService()
    await expect(
      (service as any).reserveTurn('user-2', 'tenant-1', 'conv-1', { message: 'hello' })
    ).rejects.toMatchObject({ status: 404, code: 'CONVERSATION_NOT_FOUND' })
  })
})
