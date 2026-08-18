/**
 * Typed error for the funding-chat conversation service. Routes map it to its
 * HTTP status (see `routeErrors.ts`) instead of leaking `error.message` through
 * a generic 500. Mirrors `ProjectAccessError` in `src/lib/project-access.ts`.
 * Kept free of Next.js imports so the service and its unit tests stay light.
 */
export class RecommendationConversationError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'RecommendationConversationError'
    this.status = status
    this.code = code
  }
}

export function conversationNotFound() {
  return new RecommendationConversationError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND')
}

export function noPendingPatch() {
  return new RecommendationConversationError('No pending filter patch to confirm', 409, 'NO_PENDING_PATCH')
}

export function pendingPatchStale() {
  return new RecommendationConversationError(
    'Pending patch is stale and has been cleared',
    409,
    'PENDING_PATCH_STALE'
  )
}
