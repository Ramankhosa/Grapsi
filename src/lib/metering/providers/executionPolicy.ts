import type { LLMRequest } from '../types'

/**
 * A caller-supplied execution policy, carried in `request.metadata.executionPolicy`.
 *
 * Callers that account for every paid attempt themselves (Source Watch reserves
 * budget per attempt) need each gateway call to make exactly one provider
 * request: no provider retry loop, no SDK auto-retry, no default-routing
 * fallback. Without a policy, every provider behaves exactly as before.
 */
export interface ExecutionPolicy {
  /** Provider-level attempts allowed for this call (1 = no retries anywhere below). */
  maxProviderAttempts?: number
  /** Never fall back to hard-coded default routing when the pinned model is unavailable. */
  noDefaultRouting?: boolean
  requestTimeoutMs?: number
}

export function executionPolicyOf(request: Pick<LLMRequest, 'metadata'>): ExecutionPolicy | null {
  const policy = (request.metadata as Record<string, unknown> | undefined)?.executionPolicy
  return policy && typeof policy === 'object' ? (policy as ExecutionPolicy) : null
}

/** The provider's own attempt count, capped by the policy. */
export function allowedProviderAttempts(request: Pick<LLMRequest, 'metadata'>, configured: number): number {
  const cap = executionPolicyOf(request)?.maxProviderAttempts
  if (typeof cap === 'number' && cap >= 1) return Math.max(1, Math.min(configured, Math.floor(cap)))
  return configured
}

/**
 * Re-wrap a provider error with a new message WITHOUT losing what callers
 * classify on: HTTP status, provider error code, request id, retry-after and
 * any billable usage reported for a failed-but-charged request.
 */
export function withErrorDetails(message: string, cause: unknown): Error {
  const source = (cause ?? {}) as Record<string, unknown>
  const details: Record<string, unknown> = { cause }
  for (const key of ['status', 'code', 'requestId', 'request_id', 'retryAfterMs', 'billableUsage', 'errorDetails', 'error']) {
    if (source[key] !== undefined) details[key] = source[key]
  }
  return Object.assign(new Error(message), details)
}

/**
 * Per-request SDK options (OpenAI/Anthropic SDKs retry twice by default). With
 * a one-attempt policy the SDK must not retry on its own.
 */
export function sdkRetryOptions(request: Pick<LLMRequest, 'metadata'>): { maxRetries?: number; timeout?: number } {
  const cap = executionPolicyOf(request)?.maxProviderAttempts
  const timeout = executionPolicyOf(request)?.requestTimeoutMs
  return { ...(typeof cap === 'number' && cap >= 1 ? { maxRetries: Math.max(0, Math.floor(cap) - 1) } : {}), ...(typeof timeout === 'number' && timeout > 0 ? { timeout: Math.min(timeout, 120_000) } : {}) }
}
