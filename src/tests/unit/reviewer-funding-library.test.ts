import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), jwt: vi.fn(), session: vi.fn(), feature: vi.fn(),
  begin: vi.fn(), check: vi.fn(), reserve: vi.fn(), commit: vi.fn(), end: vi.fn(),
  findMany: vi.fn(), findFirst: vi.fn(), buildContext: vi.fn(), createReview: vi.fn(),
  rows: [] as Array<Record<string, any>>,
}))

vi.mock('@/lib/auth', () => ({ verifyJWT: mocks.jwt }))
vi.mock('@/lib/funding/access', () => ({ requireFundingActor: mocks.auth }))
vi.mock('@/lib/reviewer-auth-api', () => ({
  getReviewerSession: mocks.session, requireGrantReviewFeature: mocks.feature,
}))
vi.mock('@/lib/fundingIntake/routeAuth', async () => {
  const { visibleFundingCallWhere } = await import('@/lib/funding/callVisibility')
  return {
    actorCanSeeTenantDrafts: async () => false,
    buildFundingCallAccessWhere: (actor: any) => visibleFundingCallWhere(actor.tenantId, { includeCatalog: true }),
  }
})
vi.mock('@/lib/prisma', () => ({ default: { fundingCall: { findMany: mocks.findMany, findFirst: mocks.findFirst } } }))
vi.mock('@/lib/catalogueProtection/store', () => ({
  beginCatalogueRequest: mocks.begin, checkCatalogueSession: mocks.check,
  reserveCatalogueExposure: mocks.reserve, commitCatalogueExposure: mocks.commit,
  endCatalogueRequest: mocks.end,
}))
vi.mock('@/lib/reviewer/callContext', () => ({
  buildReviewerContextFromStoredCall: mocks.buildContext, normalizeReviewerCallContext: vi.fn(),
}))
vi.mock('@/lib/reviewer/callExtraction', () => ({ extractReviewerContextFromUrls: vi.fn() }))
vi.mock('@/lib/reviewer/template-bridge', () => ({ createReviewerCallFromContext: mocks.createReview }))

import fundingLibrary from '../../../pages/api/reviewer/funding-calls'
import reviewerCalls from '../../../pages/api/reviewer/calls/index'

// Evaluate the small subset of Prisma predicates used by these reads against
// fixture rows, so list selection and the real guard see the same records.
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every((part: any) => matches(row, part))
    if (key === 'OR') return condition.some((part: any) => matches(row, part))
    if (condition && typeof condition === 'object') {
      if ('in' in condition) return condition.in.includes(row[key])
      if ('contains' in condition) return String(row[key] || '').toLowerCase().includes(condition.contains.toLowerCase())
    }
    return row[key] === condition
  })
}

function call(id: string, extra: Record<string, any> = {}) {
  return {
    id, title: id, scheme_title: id, agency_name: 'Research Foundation', agencyName: null,
    description: 'Research purpose', summary: null, visibility: 'GLOBAL_PUBLISHED', tenantId: null,
    status: 'PUBLISHED', catalog_status: 'PUBLISHED', is_active: true,
    close_date: null, deadlineAt: null, active_template: null, template: null,
    active_template_id: null, active_guideline_id: null, template_status: 'missing', guideline_status: 'missing',
    ...extra,
  }
}

async function request(handler: any, body?: Record<string, any>, query: Record<string, string> = { limit: '100' }) {
  const res: any = { headers: {}, statusCode: 200, body: null }
  res.setHeader = (key: string, value: unknown) => { res.headers[key.toLowerCase()] = value; return res }
  res.status = (code: number) => { res.statusCode = code; return res }
  res.send = (value: string) => { res.body = JSON.parse(value); return res }
  await handler({
    method: body ? 'POST' : 'GET', url: body ? '/api/reviewer/calls' : '/api/reviewer/funding-calls',
    headers: { authorization: 'Bearer tracked-session', ...(body ? { 'content-type': 'application/json' } : {}) },
    query, body,
  }, res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows = []
  mocks.auth.mockResolvedValue({ actor: { id: 'user', tenantId: 'tenant', roles: ['MEMBER'] } })
  mocks.jwt.mockReturnValue({ sub: 'user', catalog_session: 'session' })
  mocks.session.mockResolvedValue({ user: { id: 'user', tenantId: 'tenant', roles: ['MEMBER'] } })
  mocks.feature.mockResolvedValue(true)
  mocks.begin.mockResolvedValue('lease')
  mocks.check.mockResolvedValue({})
  mocks.reserve.mockResolvedValue(undefined)
  mocks.commit.mockResolvedValue(undefined)
  mocks.end.mockResolvedValue(undefined)
  mocks.findMany.mockImplementation(async ({ where, take }: any) => {
    const rows = mocks.rows.filter(row => matches(row, where))
    return take ? rows.slice(0, take) : rows
  })
  mocks.findFirst.mockImplementation(async ({ where }: any) => mocks.rows.find(row => matches(row, where)) || null)
  mocks.buildContext.mockResolvedValue({ context: { rules_source: 'call_fields' }, templateSnapshot: null })
  mocks.createReview.mockResolvedValue({ id: 'review', fundingCallId: 'imported' })
})

describe('reviewer funding library through the real catalogue guard', () => {
  it('excludes inactive, draft and other-tenant calls instead of failing the entire library', async () => {
    mocks.rows = [
      call('inactive', { is_active: false, catalog_status: 'ARCHIVED' }),
      call('global-draft', { status: 'READY_FOR_REVIEW', catalog_status: 'DRAFT', is_active: false }),
      call('private-draft', { visibility: 'TENANT_PRIVATE', tenantId: 'tenant', status: 'READY_FOR_REVIEW', catalog_status: 'DRAFT', is_active: false }),
      call('other-tenant', { visibility: 'TENANT_PRIVATE', tenantId: 'other' }),
      call('curated'), call('legacy-active', { is_active: null }),
      call('own-tenant', { visibility: 'TENANT_PRIVATE', tenantId: 'tenant' }),
    ]
    const res = await request(fundingLibrary)
    expect(res.statusCode).toBe(200)
    expect(res.body.calls.map((c: any) => c.id).sort()).toEqual(['curated', 'legacy-active', 'own-tenant'])
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(mocks.commit).toHaveBeenCalled()
  })

  it('includes released imported calls, excludes staged imports, and preserves search and the 50-call bound', async () => {
    mocks.rows = [call('imported', { visibility: 'GLOBAL_CATALOG' }), call('staged', { visibility: 'GLOBAL_CATALOG', catalog_status: 'STAGED', status: 'READY_FOR_REVIEW', is_active: false }), ...Array.from({ length: 60 }, (_, i) => call(`curated-${i}`))]
    const res = await request(fundingLibrary, undefined, { limit: '100', search: 'imported' })
    expect(res.statusCode).toBe(200)
    expect(res.body.calls.map((c: any) => c.id)).toEqual(['imported'])
    expect((await request(fundingLibrary)).body.calls).toHaveLength(50)
  })

  it('can start a review from the same released imported call shown by the library', async () => {
    mocks.rows = [call('imported', { visibility: 'GLOBAL_CATALOG' })]
    const res = await request(reviewerCalls, { fundingCallId: 'imported', project_title: 'Research project' })
    expect(res.statusCode).toBe(201)
    expect(mocks.buildContext).toHaveBeenCalledWith(expect.objectContaining({ fundingCallId: 'imported' }))
    expect(mocks.createReview).toHaveBeenCalledOnce()
  })

  it.each([
    { visibility: 'GLOBAL_CATALOG', status: 'READY_FOR_REVIEW', catalog_status: 'STAGED', is_active: false },
    { visibility: 'TENANT_PRIVATE', tenantId: 'other' },
    { is_active: false },
  ])('cannot start a review from an unavailable or other-tenant source', async extra => {
    mocks.rows = [call('unavailable', extra)]
    const res = await request(reviewerCalls, { fundingCallId: 'unavailable', project_title: 'Research project' })
    expect(res.statusCode).toBe(404)
    expect(mocks.buildContext).not.toHaveBeenCalled()
    expect(mocks.createReview).not.toHaveBeenCalled()
  })

  it('keeps anonymous users and untracked logins outside the library', async () => {
    mocks.auth.mockResolvedValueOnce({ response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await request(fundingLibrary)).statusCode).toBe(401)
    mocks.jwt.mockReturnValue({ sub: 'user' })
    const res = await request(fundingLibrary)
    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe('REAUTH_REQUIRED')
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
