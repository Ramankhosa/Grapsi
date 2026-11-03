import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ units: vi.fn(), query: vi.fn(), heads: vi.fn(), canonical: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: { tenantOrgUnit: { findMany: m.units }, $queryRaw: m.query, orgUnitManager: { findMany: m.heads } } }))
vi.mock('@/lib/orgUnits/tree', () => ({ loadLevelNames: async () => ['School', 'Department'], levelNameForDepth: (depth: number, levels: string[]) => levels[depth] }))
vi.mock('@/lib/researchAreas/core', () => ({ canonicalAreasEnabled: m.canonical }))
vi.mock('@/lib/researchAreas/queries', async () => { const { Prisma } = await import('@prisma/client'); return { orgAreaRowsSql: () => Prisma.raw('unit_areas') } })
import { loadDiscoveryOrg } from '@/lib/discovery/org'
beforeEach(() => {
  vi.clearAllMocks(); m.canonical.mockReturnValue(true)
  m.units.mockResolvedValue([
    { id: 'school', name: 'School', code: null, parent_id: null, depth: 0, path: ['school'], level_label: null },
    { id: 'dept', name: 'Department', code: 'D', parent_id: 'school', depth: 1, path: ['school', 'dept'], level_label: null },
    { id: 'orphan', name: 'Active unit under an inactive parent', code: null, parent_id: 'inactive', depth: 1, path: ['inactive', 'orphan'], level_label: 'Centre' },
  ])
  m.heads.mockResolvedValue([{ org_unit_id: 'school', title: 'Dean', user: { id: 'head', name: 'Head', email: 'head@example.test' } }])
  m.query.mockImplementation(async (sql: any) => sql.sql.includes('GROUP BY 1') ? [{ unit_id: 'school', n: 2 }, { unit_id: 'dept', n: 3 }, { unit_id: 'orphan', n: 1 }]
    : sql.sql.includes('unit.id IS NULL') ? [{ n: 4 }] : [{ unit_id: 'school', id: 'bio', label: 'Biotechnology' }])
})
describe('Discovery organisation directory', () => {
  it('rolls up direct people counts, retains unplaced colleagues and surfaces orphaned active units', async () => {
    const data = await loadDiscoveryOrg('tenant')
    expect(data).toMatchObject({ totalPeople: 10, unplacedCount: 4, areaFilter: 'importedAreaIds' })
    expect(data.roots).toHaveLength(2)
    expect(data.roots[0]).toMatchObject({ id: 'school', directCount: 2, rollupCount: 5, levelLabel: 'School',
      heads: [{ userId: 'head', name: 'Head', title: 'Dean' }], areas: [{ id: 'bio', label: 'Biotechnology' }], children: [{ id: 'dept', directCount: 3, rollupCount: 3 }] })
    expect(data.roots[1]).toMatchObject({ id: 'orphan', levelLabel: 'Centre', rollupCount: 1 })
  })
  it('uses the same active member and tenant fence for its counts as people browsing', async () => {
    await loadDiscoveryOrg('tenant')
    expect(m.units.mock.calls[0][0].where).toEqual({ tenant_id: 'tenant', is_active: true })
    for (const [sql] of m.query.mock.calls.slice(0, 2)) {
      expect(sql.values).toContain('tenant')
      expect(sql.sql).toContain("u.status = 'ACTIVE'")
      expect(sql.sql).toContain("'SUPER_ADMIN','SUPER_ADMIN_VIEWER','PLATFORM_STAFF'")
    }
    expect(m.heads.mock.calls[0][0].where.user).toMatchObject({ tenantId: 'tenant', status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF'] } } })
  })
  it('routes legacy unit taxonomy links into the matching directory filter', async () => {
    m.canonical.mockReturnValue(false)
    expect((await loadDiscoveryOrg('tenant')).areaFilter).toBe('taxonomyAreaIds')
    expect(m.query.mock.calls[2][0].sql).toContain('research_area_taxonomy_areas')
  })
})
