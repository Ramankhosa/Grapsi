import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), select: vi.fn(), start: vi.fn(), step: vi.fn() }))
vi.mock('@/lib/funding/access', () => ({ requireFundingActor: mocks.auth }))
vi.mock('@/lib/prisma', () => ({ default: {} }))
vi.mock('@/lib/fundingCatalogImport/aiReview', async importOriginal => {
  const actual = await importOriginal<any>()
  return { ...actual, selectAiReviewItems: mocks.select, createAiBatch: mocks.start, runAiReviewStep: mocks.step }
})
import { GET, POST } from '@/app/api/admin/funding/ai-review/route'
function request(body: unknown) { return new NextRequest('http://localhost/api/admin/funding/ai-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
describe('AI review superadmin boundary', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects unauthenticated requests before touching data', async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({}, { status: 401 }) })
    expect((await POST(request({ action: 'preview' }))).status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each(['tenant admin', 'funding operator', 'superadmin viewer'])('rejects %s', async () => {
    mocks.auth.mockResolvedValue({ actor: { id: 'user', isSuperAdminWriter: false } })
    expect((await GET(new NextRequest('http://localhost/api/admin/funding/ai-review'))).status).toBe(403)
    expect((await POST(request({ action: 'start' }))).status).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('requires preview confirmation and validates batch limits', async () => {
    mocks.auth.mockResolvedValue({ actor: { id: 'admin', isSuperAdminWriter: true } })
    expect((await POST(request({ action: 'start', limit: 10001 }))).status).toBe(400)
    expect((await POST(request({ action: 'start' }))).status).toBe(400)
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('does not silently interpret an empty selected list as all matches', async () => {
    mocks.auth.mockResolvedValue({ actor: { id: 'admin', isSuperAdminWriter: true } })
    mocks.select.mockResolvedValue([])
    const response = await POST(request({ action: 'preview', ids: [] }))
    expect(response.status).toBe(200)
    expect((await response.json()).reviewItems).toBe(0)
    expect(mocks.select).toHaveBeenCalledWith({}, {}, [])
  })
})
