import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireFundingImporterRequest: vi.fn(),
}))

vi.mock('@/lib/fundingIntake/routeAuth', () => ({
  requireFundingImporterRequest: mocks.requireFundingImporterRequest,
}))

import { POST as advisorPost } from '@/app/api/chatbot/funding-advisor/route'
import { POST as fallbackPost } from '@/app/api/chatbot/funding-advisor-fallback/route'

function makeRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// The pre-finder advisor chatbot ran an open-ended "general conversation" prompt
// and an application-writing coach. Both are retired so the only chat surface is
// the finder, which is held to finding funding and answering call questions.
describe('legacy advisor chatbot routes', () => {
  beforeEach(() => {
    mocks.requireFundingImporterRequest.mockReset()
  })

  it.each([
    ['funding-advisor', advisorPost, { action: 'conversation', query: 'what do you think about the election?' }],
    ['funding-advisor', advisorPost, { action: 'advice', params: { opportunityDetails: 'Scheme X' } }],
    ['funding-advisor-fallback', fallbackPost, { query: 'tell me a joke' }],
  ])('%s answers 410 LEGACY_CHATBOT_DISABLED for an authorised caller instead of chatting', async (name, handler, body) => {
    mocks.requireFundingImporterRequest.mockResolvedValue({
      actor: { id: 'user-1', email: 'u@example.com', tenantId: 'tenant-1' },
    })

    const response = await handler(makeRequest(`/api/chatbot/${name}`, body))

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({ code: 'LEGACY_CHATBOT_DISABLED' })
  })

  it('still rejects unauthenticated callers before saying anything', async () => {
    mocks.requireFundingImporterRequest.mockResolvedValue({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const response = await advisorPost(makeRequest('/api/chatbot/funding-advisor', { action: 'conversation', query: 'hi' }))

    expect(response.status).toBe(401)
  })
})
