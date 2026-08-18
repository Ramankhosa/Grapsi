import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route-level contract tests for the funding chat conversation routes: response
 * envelopes, error mapping (no leaked internals), rate limiting.
 */

class ServiceQuotaExceededErrorMock extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ServiceQuotaExceededError'
  }
}

const mocks = vi.hoisted(() => ({
  requireFundingActor: vi.fn(),
  service: {
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    processMessage: vi.fn(),
    applyFilters: vi.fn(),
    resetFilters: vi.fn(),
    confirmPendingPatch: vi.fn(),
  },
}))

vi.mock('@/lib/service-usage-tracker', () => ({
  reserveServiceUsage: vi.fn(),
  releaseReservedServiceUsage: vi.fn(),
  trackServiceUsage: vi.fn(),
  ServiceQuotaExceededError: ServiceQuotaExceededErrorMock,
}))

vi.mock('@/lib/geminiService', () => ({
  isGeminiRateLimitErrorLike: (error: unknown) => (error as { code?: string })?.code === 'GEMINI_RATE_LIMITED',
  getGeminiRetryAfterMs: () => 4000,
}))

// Stub authentication one level down so the real request-auth (rate limiter,
// tenant check, access scope) runs in the normal module graph. A partial
// `importActual` mock of request-auth would give the routes a *different*
// rate-limiter instance than the one the tests reset.
vi.mock('@/lib/funding/access', () => ({
  requireFundingActor: mocks.requireFundingActor,
}))

vi.mock('@/lib/services/recommendationConversationService', () => ({
  recommendationConversationService: mocks.service,
}))

const ACTOR = { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false }
const CONVERSATION = { id: 'conv-1', messages: [], runs: [], currentFilters: {}, title: 'x' }
const MUTATION = { conversation: CONVERSATION, stale: false, clientTurnId: null }

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('recommendation conversation routes', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.requireFundingActor.mockResolvedValue({ actor: ACTOR, user: { id: 'user-1' } })
    mocks.service.resetFilters.mockResolvedValue(MUTATION)
    mocks.service.applyFilters.mockResolvedValue(MUTATION)
    mocks.service.confirmPendingPatch.mockResolvedValue(MUTATION)
    mocks.service.processMessage.mockResolvedValue(MUTATION)
    mocks.service.createConversation.mockResolvedValue(CONVERSATION)
    mocks.service.getConversation.mockResolvedValue(CONVERSATION)
    // Fresh rate-limit windows per test (module registry was just reset, but be explicit).
    const rateLimit = await import('@/lib/recommendations/rateLimit')
    rateLimit.__resetRateLimitWindowsForTests()
  })

  it('reset-filters returns the mutation response unwrapped (conversation at the top level)', async () => {
    const { POST } = await import('@/app/api/recommendations/conversations/[id]/reset-filters/route')
    const response = await POST(jsonRequest('/api/recommendations/conversations/conv-1/reset-filters', {}), {
      params: { id: 'conv-1' },
    })
    const payload = await response.json()
    expect(response.status).toBe(200)
    // The client reads `payload.conversation.messages`; the old route double-wrapped
    // this as `{ conversation: { conversation, stale } }` and crashed the finder.
    expect(payload.conversation.id).toBe('conv-1')
    expect(Array.isArray(payload.conversation.messages)).toBe(true)
    expect(payload.stale).toBe(false)
  })

  it('maps quota exhaustion on /messages to 429 QUOTA_EXCEEDED with the tracker code', async () => {
    mocks.service.processMessage.mockRejectedValueOnce(new ServiceQuotaExceededErrorMock('DAILY_QUOTA_EXCEEDED', 'internal detail'))
    const { POST } = await import('@/app/api/recommendations/conversations/[id]/messages/route')
    const response = await POST(jsonRequest('/api/recommendations/conversations/conv-1/messages', { message: 'hi' }), {
      params: { id: 'conv-1' },
    })
    const payload = await response.json()
    expect(response.status).toBe(429)
    expect(payload.code).toBe('QUOTA_EXCEEDED')
    expect(payload.quotaCode).toBe('DAILY_QUOTA_EXCEEDED')
    expect(JSON.stringify(payload)).not.toContain('internal detail')
  })

  it('maps a missing conversation to 404 and never leaks generic error internals', async () => {
    const { conversationNotFound } = await import('@/lib/recommendations/errors')
    mocks.service.getConversation.mockRejectedValueOnce(conversationNotFound())
    const { GET } = await import('@/app/api/recommendations/conversations/[id]/route')
    const notFound = await GET(new NextRequest('http://localhost/api/recommendations/conversations/other'), {
      params: { id: 'other' },
    })
    expect(notFound.status).toBe(404)
    expect((await notFound.json()).code).toBe('CONVERSATION_NOT_FOUND')

    mocks.service.getConversation.mockRejectedValueOnce(new Error('PrismaClientKnownRequestError: relation "x" does not exist'))
    const internal = await GET(new NextRequest('http://localhost/api/recommendations/conversations/conv-1'), {
      params: { id: 'conv-1' },
    })
    const payload = await internal.json()
    expect(internal.status).toBe(500)
    expect(payload.code).toBe('INTERNAL')
    expect(payload.details).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('Prisma')
  })

  it('rejects an oversized manualQueryPatch and unbounded filter lists with 400', async () => {
    const { POST } = await import('@/app/api/recommendations/conversations/[id]/messages/route')
    const tooLong = await POST(
      jsonRequest('/api/recommendations/conversations/conv-1/messages', {
        message: 'x',
        manualQueryPatch: { researchArea: 'a'.repeat(2001) },
      }),
      { params: { id: 'conv-1' } }
    )
    expect(tooLong.status).toBe(400)
    expect(mocks.service.processMessage).not.toHaveBeenCalled()

    const filtersRoute = await import('@/app/api/recommendations/conversations/[id]/filters/route')
    const tooMany = await filtersRoute.POST(
      jsonRequest('/api/recommendations/conversations/conv-1/filters', {
        filters: { eligibleCountries: Array.from({ length: 51 }, (_, i) => `c${i}`), amountMax: Infinity },
      }),
      { params: { id: 'conv-1' } }
    )
    expect(tooMany.status).toBe(400)
    expect(mocks.service.applyFilters).not.toHaveBeenCalled()
  })

  it('rate-limits filter routes on a per-user bucket that ignores IP and conversation id', async () => {
    const constants = await import('@/lib/recommendations/constants')
    const { POST } = await import('@/app/api/recommendations/conversations/[id]/filters/route')
    let last: Response | null = null
    for (let i = 0; i < constants.CHAT_RATE_LIMIT_MAX_REQUESTS + 1; i += 1) {
      // Rotate both the conversation id and the forwarded IP: neither must open a new bucket.
      const request = new NextRequest(`http://localhost/api/recommendations/conversations/conv-${i}/filters`, {
        method: 'POST',
        body: JSON.stringify({ filters: {} }),
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}` },
      })
      last = await POST(request, { params: { id: `conv-${i}` } })
    }
    expect(last?.status).toBe(429)
    expect((await last!.json()).code).toBe('RATE_LIMITED')
    expect(mocks.service.applyFilters).toHaveBeenCalledTimes(constants.CHAT_RATE_LIMIT_MAX_REQUESTS)
  })

  it('rate-limits conversation creation on its own bucket', async () => {
    const constants = await import('@/lib/recommendations/constants')
    const { POST } = await import('@/app/api/recommendations/conversations/route')
    let last: Response | null = null
    for (let i = 0; i < constants.CHAT_CREATE_RATE_LIMIT_MAX_REQUESTS + 1; i += 1) {
      last = await POST(jsonRequest('/api/recommendations/conversations', {}))
    }
    expect(last?.status).toBe(429)
    expect(mocks.service.createConversation).toHaveBeenCalledTimes(constants.CHAT_CREATE_RATE_LIMIT_MAX_REQUESTS)
  })

  it('emits a QUOTA_EXCEEDED error event on the SSE route without persisting', async () => {
    mocks.service.processMessage.mockRejectedValueOnce(new ServiceQuotaExceededErrorMock('MONTHLY_QUOTA_EXCEEDED', 'nope'))
    const { POST } = await import('@/app/api/recommendations/conversations/[id]/messages/stream/route')
    const response = await POST(jsonRequest('/api/recommendations/conversations/conv-1/messages/stream', { message: 'hi' }), {
      params: { id: 'conv-1' },
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('event: error')
    expect(text).toContain('"code":"QUOTA_EXCEEDED"')
    expect(text).toContain('"quotaCode":"MONTHLY_QUOTA_EXCEEDED"')
    expect(text).toContain('"persisted":false')
    expect(text).not.toContain('nope')
  })
})
