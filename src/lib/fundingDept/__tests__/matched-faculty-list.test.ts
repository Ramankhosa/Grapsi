import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: mocks.query } }))
vi.mock('@/lib/services/researcherSearchService', () => ({ researcherSearchService: {} }))

import { storedCallMatches } from '../callMatchCensus'
import { currentQualifyingMatchSql } from '../reportDefinitions'

describe('school matched-faculty list uses the counted population', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue([]) })

  it.each(['NARROW', 'BALANCED', 'WIDE'] as const)('filters by the report predicate before limiting at %s width', async width => {
    await storedCallMatches('tenant', 'call', ['biotech'], 30, width)
    const query = mocks.query.mock.calls[0][0]
    const counted = currentQualifyingMatchSql('m', width)
    expect(query.sql).toContain(counted.sql)
    expect(query.sql.indexOf(counted.sql)).toBeLessThan(query.sql.indexOf('LIMIT'))
    expect(query.values).toEqual(expect.arrayContaining(['tenant', 'call', 'biotech', 30]))
  })

  it('can list every counted researcher rather than silently stopping at 30', async () => {
    await storedCallMatches('tenant', 'call', ['biotech'], null, 'NARROW')
    const query = mocks.query.mock.calls[0][0]
    expect(query.sql).not.toContain('LIMIT')
    expect(query.sql).toContain('m.school_id = ANY(')
    expect(query.sql).toContain('m.funding_call_id = ')
    expect(query.sql).toContain('m.tenant_id = ')
  })

  it('excludes inactive and foreign-tenant users from both the count and list predicate', () => {
    const query = currentQualifyingMatchSql('m')
    expect(query.sql).toContain("current_match_user.status = 'ACTIVE'")
    expect(query.sql).toContain('current_match_user."tenantId" = m.tenant_id')
    expect(query.sql).toContain('m.is_current')
    expect(query.sql).toContain('m.inferred = false')
    expect(query.sql).toContain('manual-allocation-v1')
    expect(query.sql).toContain('person-call-census-v1')
  })

  it('does not broaden an empty school scope into an institution-wide list', async () => {
    expect(await storedCallMatches('tenant', 'call', [], null)).toEqual([])
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
