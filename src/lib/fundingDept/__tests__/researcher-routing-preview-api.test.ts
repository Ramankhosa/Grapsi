import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const m = vi.hoisted(() => ({ access: vi.fn(), preview: vi.fn() }))
vi.mock('@/lib/fundingDept/managementAccess', () => ({ managementAccess: m.access }))
vi.mock('@/lib/fundingDept/researcherRoutingPreview', () => ({ researcherRoutingPreview: m.preview,
  RoutingPreviewError: class extends Error { constructor(message: string, public status: number) { super(message) } } }))
import { GET } from '@/app/api/funding-dept/routing-preview/route'
import { RoutingPreviewError } from '../researcherRoutingPreview'
beforeEach(() => { vi.clearAllMocks(); m.access.mockResolvedValue({ department: true, context: { tenantId: 'lpu' } }); m.preview.mockResolvedValue({ previewOnly: true, activationEnabled: false }) })
const get = (query = '') => GET(new NextRequest(`http://localhost/api/funding-dept/routing-preview${query}`))

describe('read-only head-only routing preview endpoint', () => {
  it('derives the tenant from authentication and disables response caching', async () => {
    const response = await get('?callId=call&page=2')
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(m.preview).toHaveBeenCalledWith('lpu', { callId: 'call', page: 2 })
    expect(await response.json()).toMatchObject({ activationEnabled: false })
  })
  it('rejects an ordinary coordinator before loading personal data', async () => {
    m.access.mockResolvedValue({ department: false })
    expect((await get()).status).toBe(403); expect(m.preview).not.toHaveBeenCalled()
  })
  it('preserves an authentication failure and private cache headers', async () => {
    m.access.mockResolvedValue({ response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) })
    const response = await get(); expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it.each(['?tenantId=other', '?page=0', '?page=1.5', '?callId=', '?activate=true'])('rejects unsupported or invalid filters %s', async query => {
    expect((await get(query)).status).toBe(400); expect(m.preview).not.toHaveBeenCalled()
  })
  it.each([404, 409])('does not expose unavailable/closed calls (%s)', async status => {
    m.preview.mockRejectedValue(new RoutingPreviewError('Unavailable', status))
    expect((await get('?callId=x')).status).toBe(status)
  })
})
