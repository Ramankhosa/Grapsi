import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ context: vi.fn(), auth: vi.fn(), query: vi.fn(), units: vi.fn(), call: vi.fn(),
  areas: vi.fn(), searchPeople: vi.fn(), searchCalls: vi.fn(), directory: vi.fn(), placement: vi.fn(), profile: vi.fn(), org: vi.fn() }))
vi.mock('@/lib/auth/tenantAccess', () => ({ requireTenantScope: m.context, isAccessError: (value: any) => 'error' in value }))
vi.mock('@/lib/recommendations/request-auth', () => ({ requireRecommendationUser: m.auth, toRecommendationAccessScope: (actor: any) => ({ tenantId: actor.tenantId, isSuperAdmin: false }) }))
vi.mock('@/lib/catalogueProtection/guard', () => ({ withCatalogueProtection: (handler: any) => handler }))
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: m.query, tenantOrgUnit: { findMany: m.units }, fundingCall: { findFirst: m.call }, researcherProfile: { findMany: m.placement } } }))
vi.mock('@/lib/faculty/profile', () => ({ loadFacultyProfile: m.profile }))
vi.mock('@/lib/discovery/org', () => ({ loadDiscoveryOrg: m.org }))
vi.mock('@/lib/researchAreas/store', () => ({ loadStandardAreas: m.areas }))
vi.mock('@/lib/services/researcherSearchService', () => ({ researcherSearchService: { search: m.searchPeople } }))
vi.mock('@/lib/services/recommendationSearchService', () => ({ recommendationSearchService: { search: m.searchCalls, browseDirectory: m.directory } }))
import { GET as peopleOptions, POST as peopleSearch } from '@/app/api/discovery/people/route'
import { GET as callOptions, POST as callSearch } from '@/app/api/discovery/calls/route'
import { GET as profile } from '@/app/api/discovery/people/[userId]/route'
import { GET as org } from '@/app/api/discovery/org/route'

function context(wide = false) { return { tenantId: 'tenant-a', user: { id: 'officer' }, scope: {
  isTenantWide: wide, canAssign: true, canViewReports: true, managedUnitIds: ['biotech', 'bio-dept'],
} } }
const req = (body: unknown, path = 'people') => new NextRequest(`http://localhost/api/discovery/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  m.context.mockResolvedValue(context()); m.auth.mockResolvedValue({ actor: { tenantId: 'tenant-a' } })
  m.areas.mockResolvedValue([{ id: 'scientify:discipline:bio', label: 'Biotechnology' }])
  m.query.mockImplementation(async (sql: any) => sql.sql.includes('SELECT id FROM tenant_org_units') ? [{ id: 'biotech' }, { id: 'bio-dept' }, { id: 'outside' }] : sql.sql.includes('count(*)') ? [{ total: 1 }] : [{ id: 'p', name: 'Researcher', areas: [], standardAreas: [], savedAreas: [] }])
  m.units.mockResolvedValue([]); m.call.mockResolvedValue({ id: 'call' })
  m.searchPeople.mockResolvedValue({ results: [], degradedMode: null })
  m.placement.mockResolvedValue([])
  m.profile.mockResolvedValue({ userId: 'person', employeeId: null })
  m.org.mockResolvedValue({ roots: [], totalPeople: 0, unplacedCount: 0, areaFilter: 'importedAreaIds' })
  m.directory.mockResolvedValue({ results: [], totalResults: 0, page: 1, totalPages: 1 })
  m.searchCalls.mockResolvedValue({ results: [], degradedMode: null, lowConfidence: false })
})

describe('Research Discovery boundaries and searches', () => {
  it('lets ordinary members browse their whole organisation with limited action capabilities', async () => {
    m.context.mockResolvedValue({ ...context(), scope: { isTenantWide: false, canAssign: false, canViewReports: false, managedUnitIds: [] } })
    expect((await peopleSearch(req({ kind: 'person', query: 'Meera' }))).status).toBe(200)
    expect(m.query.mock.calls[0][0].sql).not.toContain('employee_id')
    m.query.mockResolvedValue([])
    const options = await peopleOptions(new NextRequest('http://localhost/api/discovery/people'))
    expect(await options.json()).toMatchObject({ canSearchPeople: true, capabilities: { canAssign: false, canOpenMatching: false, canSeeEmployeeIds: false } })
  })
  it('returns authentication errors before reading any profiles', async () => {
    m.context.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    expect((await peopleSearch(req({ kind: 'person', query: 'Meera' }))).status).toBe(401)
    expect(m.query).not.toHaveBeenCalled()
  })
  it('expands school descendants across the member’s organisation for semantic matching', async () => {
    await peopleSearch(req({ kind: 'semantic', query: 'cancer biosensors', unitId: 'biotech', careerStage: 'SENIOR' }))
    expect(m.searchPeople).toHaveBeenCalledWith(expect.objectContaining({ requesterTenantId: 'tenant-a', recordRun: false, limit: 50,
      filters: expect.objectContaining({ orgUnitIds: ['biotech', 'bio-dept', 'outside'], tenantOnly: true, includeSelf: true, exactCareerStage: 'SENIOR' }) }))
    const result = await (await peopleSearch(req({ kind: 'semantic', query: 'biosensors' }))).json()
    expect(result).toMatchObject({ bounded: true, basis: 'semantic' })
  })
  it('an unknown or foreign school becomes impossible rather than all schools', async () => {
    m.query.mockResolvedValue([])
    await peopleSearch(req({ kind: 'semantic', query: 'biosensors', unitId: 'outside' }))
    expect(m.searchPeople.mock.calls[0][0].filters.orgUnitIds).toEqual(['__none__'])
  })
  it('person search is literal, paginated, active and tenant-scoped without invoking embeddings', async () => {
    m.query.mockImplementation(async (sql: any) => sql.sql.includes('count(*)') ? [{ total: 25 }] : [])
    const result = await (await peopleSearch(req({ kind: 'person', query: 'Meera_%', page: 2 }))).json()
    expect(result).toMatchObject({ total: 25, page: 2, totalPages: 3, basis: 'identity' })
    for (const [sql] of m.query.mock.calls) {
      expect(sql.sql).toContain("u.status = 'ACTIVE'"); expect(sql.values).toContain('tenant-a')
      expect(sql.sql).toContain("'SUPER_ADMIN','SUPER_ADMIN_VIEWER'")
      expect(sql.sql).toContain('strpos('); expect(sql.values).toContain('Meera_%')
      expect(sql.sql).not.toContain('p.org_unit_id=ANY')
    }
    expect(m.searchPeople).not.toHaveBeenCalled()
  })
  it('standard people search uses saved-area links and individual profile labels, not school mappings', async () => {
    await peopleSearch(req({ kind: 'standard', areaIds: ['scientify:discipline:bio'] }))
    const sql = m.query.mock.calls[0][0]
    expect(sql.sql).toContain('effective_saved_research_area_links')
    expect(sql.sql).toContain('unnest(p.research_areas)')
    expect(sql.sql).not.toContain('effective_org_unit_research_area_links')
    expect(m.searchPeople).not.toHaveBeenCalled()
  })
  it('rejects stale/foreign area identifiers before retrieval', async () => {
    expect((await peopleSearch(req({ kind: 'standard', areaIds: ['not-a-standard-area'] }))).status).toBe(400)
    expect(m.query).not.toHaveBeenCalled()
    expect((await callSearch(req({ mode: 'standard', areaIds: ['not-a-standard-area'] }, 'calls'))).status).toBe(400)
    expect(m.directory).not.toHaveBeenCalled()
  })
  it('checks the call visibility before computing alignment and never records a DSR matching run', async () => {
    m.call.mockResolvedValueOnce(null)
    expect((await peopleSearch(req({ kind: 'call', callId: 'foreign-call' }))).status).toBe(404)
    expect(m.searchPeople).not.toHaveBeenCalled()
    expect((await peopleSearch(req({ kind: 'call', callId: 'call' }))).status).toBe(200)
    expect(m.searchPeople.mock.calls[0][0]).toMatchObject({ fundingCallId: 'call', recordRun: false })
    expect(JSON.stringify(m.call.mock.calls[1][0])).toContain('GLOBAL_CATALOG')
  })
  it('standard calls use exact area IDs, pagination and explicit lifecycle filters', async () => {
    await callSearch(req({ mode: 'standard', areaIds: ['scientify:discipline:bio'], page: 3 }, 'calls'))
    expect(m.directory).toHaveBeenCalledWith(expect.objectContaining({ page: 3, access: { tenantId: 'tenant-a', isSuperAdmin: false },
      filters: expect.objectContaining({ importedAreaIds: ['scientify:discipline:bio'], lifecycleStatuses: ['OPEN', 'ROLLING'], limit: 12 }) }))
    expect(m.searchCalls).not.toHaveBeenCalled()
  })
  it('own-words call searches preserve the topic without generative query expansion or hidden area filters', async () => {
    const result = await (await callSearch(req({ mode: 'semantic', query: 'biosensors', areaIds: ['scientify:discipline:bio'] }, 'calls'))).json()
    expect(m.searchCalls).toHaveBeenCalledWith(expect.objectContaining({ inputMode: 'paper_metadata', query: { title: 'biosensors' },
      filters: expect.objectContaining({ importedAreaIds: [], limit: 50 }) }))
    expect(result).toMatchObject({ bounded: true, basis: 'semantic' })
  })
  it('explains semantic outages and rejects malformed or excessive searches', async () => {
    m.searchCalls.mockRejectedValue(new Error('private provider error'))
    const response = await callSearch(req({ mode: 'semantic', query: 'biosensors' }, 'calls'))
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private provider')
    expect((await callSearch(req({ mode: 'standard', areaIds: Array(21).fill('x') }, 'calls'))).status).toBe(400)
    expect((await peopleSearch(req({ kind: 'person', query: 'M', tenantId: 'other' }))).status).toBe(400)
  })
  it('serves the live standard vocabulary rather than hardcoding an area count', async () => {
    expect(await (await callOptions(new NextRequest('http://localhost/api/discovery/calls'))).json()).toMatchObject({ areas: [{ id: 'scientify:discipline:bio' }] })
  })
  it('applies designation, stage and direct-unit filters to browsing, using its larger page size', async () => {
    m.query.mockImplementation(async (sql: any) => sql.sql.includes('SELECT id FROM tenant_org_units') ? [{ id: 'dept' }]
      : sql.sql.includes('count(*)') ? [{ total: 49 }] : [])
    const data = await (await peopleSearch(req({ kind: 'browse', unitId: 'dept', includeSubunits: false, designation: 'Professor', careerStage: 'SENIOR', page: 2 }))).json()
    expect(data).toMatchObject({ total: 49, page: 2, totalPages: 3, basis: 'directory' })
    expect(m.query.mock.calls[0][0].sql).toContain('id =')
    expect(m.query.mock.calls[0][0].sql).not.toContain('path &&')
    const sql = m.query.mock.calls[1][0]
    expect(sql.values).toEqual(expect.arrayContaining(['tenant-a', 'Professor', 'SENIOR', ['dept']]))
    expect(m.query.mock.calls[2][0].values).toEqual(expect.arrayContaining([24]))
    expect(m.searchPeople).not.toHaveBeenCalled()
  })
  it('browses unplaced colleagues without attributing them to a school', async () => {
    await peopleSearch(req({ kind: 'browse', unitId: '__unplaced__' }))
    expect(m.query.mock.calls[0][0].sql).toContain('AND NOT EXISTS')
    expect(m.query.mock.calls[0][0].sql).toContain('unit.is_active')
    expect((await peopleSearch(req({ kind: 'semantic', query: 'biosensors', unitId: '__unplaced__' }))).status).toBe(400)
  })
  it('keeps all directory filters on semantic calls and returns complete directory cards', async () => {
    m.searchCalls.mockResolvedValue({ results: [{ id: 'call' }], rawResults: [{ id: 'call', amountMin: 1000 }], degradedMode: null })
    const data = await (await callSearch(req({ mode: 'semantic', query: 'biosensors', filters: {
      eligibleCountries: ['India'], importedAreaIds: ['bio'], fundingKinds: ['GRANT'], citizenshipRequirements: ['India'], residencyRequirements: ['India'], applicationLanguages: ['English'],
    } }, 'calls'))).json()
    expect(m.searchCalls.mock.calls[0][0].filters).toMatchObject({ importedAreaIds: ['bio'], fundingKinds: ['GRANT'], limit: 50, citizenshipRequirements: ['India'], residencyRequirements: ['India'], applicationLanguages: ['English'] })
    expect(data.calls).toEqual([{ id: 'call', amountMin: 1000 }])
  })
  it('returns eligibility alongside research fit for a call, without assigning anyone', async () => {
    m.searchPeople.mockResolvedValue({ results: [{ userId: 'p', displayName: 'Person', researchAreas: [], evidence: [], eligibilityFlags: [],
      eligibility: { verdict: 'NEEDS_CHECK', reasons: [{ kind: 'conflict', text: 'Career stage conflicts' }, { kind: 'missing', text: 'Citizenship not recorded' }] } }], degradedMode: null })
    m.call.mockResolvedValue({ id: 'call', visibility: 'GLOBAL_CATALOG' })
    const data = await (await peopleSearch(req({ kind: 'call', callId: 'call' }))).json()
    expect(data).toMatchObject({ callRequiresRelease: true, bounded: true, people: [{ eligibility: { group: 'CONFLICT', conflicts: ['Career stage conflicts'], toCheck: ['Citizenship not recorded'] } }] })
    expect(m.searchPeople.mock.calls[0][0].recordRun).toBe(false)
  })
  it('serves tenant-fenced colleague profiles and hides employee IDs from ordinary members', async () => {
    m.context.mockResolvedValue({ ...context(), scope: { isTenantWide: false, canAssign: false, canViewReports: false, managedUnitIds: [] } })
    const response = await profile(new NextRequest('http://localhost/api/discovery/people/person'), { params: { userId: 'person' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(m.profile).toHaveBeenCalledWith({ tenantId: 'tenant-a', userId: 'person', activeOnly: true, includeEmployeeId: false })
    m.profile.mockResolvedValue(null)
    expect((await profile(new NextRequest('http://localhost/api/discovery/people/foreign'), { params: { userId: 'foreign' } })).status).toBe(404)
  })
  it('preserves privileged staff-ID access and authenticates org/profile endpoints before reading', async () => {
    await profile(new NextRequest('http://localhost/api/discovery/people/person'), { params: { userId: 'person' } })
    expect(m.profile.mock.calls[0][0].includeEmployeeId).toBe(true)
    expect((await org(new NextRequest('http://localhost/api/discovery/org'))).status).toBe(200)
    expect(m.org).toHaveBeenCalledWith('tenant-a')
    m.context.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    m.profile.mockClear(); m.org.mockClear()
    expect((await profile(new NextRequest('http://localhost/api/discovery/people/person'), { params: { userId: 'person' } })).status).toBe(401)
    expect((await org(new NextRequest('http://localhost/api/discovery/org'))).status).toBe(401)
    expect(m.profile).not.toHaveBeenCalled(); expect(m.org).not.toHaveBeenCalled()
  })
})
