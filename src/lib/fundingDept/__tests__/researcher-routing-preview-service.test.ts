import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), call: vi.fn(), fingerprint: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: { $transaction: m.transaction } }))
vi.mock('@/lib/fundingDept/callMatchFingerprint', () => ({ callFingerprint: m.fingerprint }))
vi.mock('@/lib/tenant/locale', () => ({ getTenantTimeZone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/fundingDept/settings', () => ({ getMatchWidth: async () => 'NARROW' }))
vi.mock('@/lib/services/researcherSearchService', () => { throw Error('A read-only preview must never import the search/provider module') })
import { researcherRoutingPreview } from '../researcherRoutingPreview'
import { CALL_MATCH_CENSUS_VERSION } from '@/lib/researcherMatching/config'

beforeEach(() => {
  vi.clearAllMocks()
  m.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.query, $executeRawUnsafe: m.execute, fundingCall: { findFirst: m.call } }))
  m.execute.mockResolvedValue(0); m.fingerprint.mockResolvedValue('fingerprint')
  m.call.mockResolvedValue({ id: 'call', title: 'Research call', scheme_title: null, career_stages: [], institution_types: [] })
  m.query.mockImplementation(async (sql: { text: string }) => {
    if (sql.text.includes('count(*)::int total')) return [{ total: 1 }]
    if (sql.text.includes('title FROM funding_calls')) return [{ id: 'call', title: 'Research call' }]
    if (sql.text.includes('::int profiles')) return [{ profiles: 9, unplaced: 1, invalidPlacement: 0, missingEmbedding: 0, missingResearch: 0 }]
    if (sql.text.includes('ORDER BY name,u.id')) return [{ id: 'unplaced', name: 'Unplaced person', issue: 'School placement missing' }]
    if (sql.text.includes('AS open')) return [{ open: true }]
    if (sql.text.includes('FROM dsr_call_match_state')) return [{ version: CALL_MATCH_CENSUS_VERSION, fingerprint: 'fingerprint', basis: 'rerank', refreshedAt: new Date() }]
    if (sql.text.includes('SELECT s.id,s.name')) return [{ id: 's', name: 'School', coordinator: 'Officer', institutional: false }]
    if (sql.text.includes('FROM funding_opportunity_matches')) return [{ userId: 'person', name: 'Person', schoolId: 's', unitId: 'd', unitName: 'Department', actualSchoolId: 's',
      score: .8, storedBand: 'weak', reason: 'Relevant research', inferred: false, sourceVersion: CALL_MATCH_CENSUS_VERSION, current: true, careerStage: null, institutionType: null }]
    throw Error(`Unexpected preview read: ${sql.text}`)
  })
})

describe('routing preview reads only the existing result census', () => {
  it('uses a repeatable read-only transaction and never activates routing', async () => {
    const result = await researcherRoutingPreview('lpu')
    expect(m.execute).toHaveBeenCalledTimes(1)
    expect(m.execute).toHaveBeenCalledWith('SET TRANSACTION READ ONLY')
    expect(m.transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'RepeatableRead' })
    expect(result).toMatchObject({ previewOnly: true, activationEnabled: false, snapshotStatus: 'RECORDED', coverage: { unplaced: 1 } })
    expect(result.schools[0].matchingPeople).toBe(result.schools[0].people.length)
  })
  it('binds call values inside coordinator SQL rather than injecting positional SQL fragments', async () => {
    await researcherRoutingPreview('lpu', { callId: "call' OR true --" })
    const sql = m.query.mock.calls.find(([s]) => s.text.includes('SELECT s.id,s.name'))![0]
    expect(sql.values).toContain('call'); expect(sql.text).not.toContain("call' OR true")
    expect(m.call.mock.calls[0][0].where.AND[0].id).toBe("call' OR true --")
  })
  it('fences match and issue reads to active users in the authenticated tenant', async () => {
    await researcherRoutingPreview('lpu')
    for (const sql of m.query.mock.calls.map(([s]) => s).filter(s => s.text.includes('JOIN users u ON'))) {
      expect(sql.values).toContain('lpu'); expect(sql.text).toContain("u.status='ACTIVE'")
    }
    const matchSql = m.query.mock.calls.find(([s]) => s.text.includes('FROM funding_opportunity_matches'))![0]
    expect(matchSql.text).not.toContain('LIMIT'); expect(matchSql.text).toContain('m.is_current')
  })
  it('does not load details or census for a private, inactive or catalogue-only inaccessible call', async () => {
    m.call.mockResolvedValue(null)
    await expect(researcherRoutingPreview('lpu', { callId: 'foreign' })).rejects.toMatchObject({ status: 404 })
    expect(m.fingerprint).not.toHaveBeenCalled()
    const where = JSON.stringify(m.call.mock.calls[0][0].where)
    expect(where).toContain('TENANT_PRIVATE'); expect(where).not.toContain('GLOBAL_CATALOG')
  })
  it('rejects a closed entry deadline before fetching researcher details', async () => {
    const original = m.query.getMockImplementation()!
    m.query.mockImplementation(async sql => sql.text.includes('AS open') ? [{ open: false }] : original(sql))
    await expect(researcherRoutingPreview('lpu')).rejects.toMatchObject({ status: 409 })
    expect(m.fingerprint).not.toHaveBeenCalled()
  })
  it('shows missing matching separately from a successful zero result', async () => {
    const original = m.query.getMockImplementation()!
    m.query.mockImplementation(async sql => sql.text.includes('FROM dsr_call_match_state') ? [] : original(sql))
    expect((await researcherRoutingPreview('lpu')).snapshotStatus).toBe('MISSING')
  })
  it('marks results outdated as soon as any fingerprint input changes', async () => {
    m.fingerprint.mockResolvedValue('changed-roster')
    expect((await researcherRoutingPreview('lpu')).snapshotStatus).toBe('STALE')
  })
})
