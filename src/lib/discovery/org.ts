import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { levelNameForDepth, loadLevelNames } from '@/lib/orgUnits/tree'
import { canonicalAreasEnabled } from '@/lib/researchAreas/core'
import { orgAreaRowsSql } from '@/lib/researchAreas/queries'
import { discoverablePersonSql } from './server'

export interface DiscoveryOrgUnit {
  id: string
  name: string
  code: string | null
  parentId: string | null
  depth: number
  /** Root-first ids, the unit itself last. */
  path: string[]
  levelLabel: string
  /** Faculty placed directly in this unit. */
  directCount: number
  /** Faculty in this unit and everything below it. */
  rollupCount: number
  heads: Array<{ userId: string; name: string; title: string | null }>
  /** The unit's research areas, in the form the calls directory filters on. */
  areas: Array<{ id: string; label: string }>
  children: DiscoveryOrgUnit[]
}

export interface DiscoveryOrg {
  roots: DiscoveryOrgUnit[]
  /** Which directory filter the unit areas belong to. */
  areaFilter: 'importedAreaIds' | 'taxonomyAreaIds'
  /** Faculty with no active unit: they exist, they just sit outside the tree. */
  unplacedCount: number
  totalPeople: number
}

/**
 * The organisation as Research Discovery browses it: active units only, with
 * counts of discoverable faculty (active, not platform staff) — the same people
 * a browse of that unit lists, so a count and its list never disagree.
 */
export async function loadDiscoveryOrg(tenantId: string): Promise<DiscoveryOrg> {
  const canonical = canonicalAreasEnabled()
  const [units, counts, unplaced, heads, areas, levels] = await Promise.all([
    prisma.tenantOrgUnit.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: [{ depth: 'asc' }, { sort_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, parent_id: true, depth: true, path: true, level_label: true },
    }),
    prisma.$queryRaw<Array<{ unit_id: string; n: number }>>(Prisma.sql`
      SELECT p.org_unit_id unit_id, count(*)::int n
        FROM users u JOIN researcher_profiles p ON p.user_id = u.id
        JOIN tenant_org_units unit ON unit.id = p.org_unit_id AND unit.tenant_id = ${tenantId} AND unit.is_active
       WHERE u."tenantId" = ${tenantId} AND ${discoverablePersonSql('u')}
       GROUP BY 1`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int n FROM users u LEFT JOIN researcher_profiles p ON p.user_id = u.id
        LEFT JOIN tenant_org_units unit ON unit.id = p.org_unit_id AND unit.tenant_id = ${tenantId} AND unit.is_active
       WHERE u."tenantId" = ${tenantId} AND ${discoverablePersonSql('u')} AND unit.id IS NULL`),
    prisma.orgUnitManager.findMany({
      where: { tenant_id: tenantId, is_active: true, user: { tenantId, status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF'] } } } },
      select: { org_unit_id: true, title: true, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.$queryRaw<Array<{ unit_id: string; id: string; label: string }>>(canonical
      ? Prisma.sql`SELECT DISTINCT r.org_unit_id unit_id, a.id, a.label FROM ${orgAreaRowsSql()} r
          JOIN catalogue_areas a ON a.id = r.taxonomy_area_id WHERE r.tenant_id = ${tenantId}`
      : Prisma.sql`SELECT DISTINCT r.org_unit_id unit_id, a.id,
            coalesce(nullif(a.level2_name, ''), a.level1_name) label FROM ${orgAreaRowsSql()} r
          JOIN research_area_taxonomy_areas a ON a.id = r.taxonomy_area_id WHERE r.tenant_id = ${tenantId}`),
    loadLevelNames(tenantId),
  ])

  const direct = new Map(counts.map((row) => [row.unit_id, row.n]))
  const pathById = new Map(units.map((unit) => [unit.id, unit.path]))
  const rollup = new Map<string, number>()
  for (const [unitId, n] of direct) {
    for (const ancestor of pathById.get(unitId) || [unitId]) rollup.set(ancestor, (rollup.get(ancestor) || 0) + n)
  }
  const headsByUnit = new Map<string, DiscoveryOrgUnit['heads']>()
  for (const head of heads) {
    const list = headsByUnit.get(head.org_unit_id) || []
    list.push({ userId: head.user.id, name: head.user.name || head.user.email, title: head.title })
    headsByUnit.set(head.org_unit_id, list)
  }
  const areasByUnit = new Map<string, DiscoveryOrgUnit['areas']>()
  for (const area of areas) {
    const list = areasByUnit.get(area.unit_id) || []
    if (list.length < 20) list.push({ id: area.id, label: area.label })
    areasByUnit.set(area.unit_id, list)
  }

  const nodes = new Map<string, DiscoveryOrgUnit>(units.map((unit) => [unit.id, {
    id: unit.id,
    name: unit.name,
    code: unit.code,
    parentId: unit.parent_id,
    depth: unit.depth,
    path: unit.path,
    levelLabel: unit.level_label || levelNameForDepth(unit.depth, levels),
    directCount: direct.get(unit.id) || 0,
    rollupCount: rollup.get(unit.id) || 0,
    heads: headsByUnit.get(unit.id) || [],
    areas: areasByUnit.get(unit.id) || [],
    children: [],
  }]))
  // An active unit under an inactive parent surfaces as a root rather than vanishing.
  const roots: DiscoveryOrgUnit[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const unplacedCount = unplaced[0]?.n || 0
  const placed = [...direct.values()].reduce((sum, n) => sum + n, 0)
  return { roots, areaFilter: canonical ? 'importedAreaIds' : 'taxonomyAreaIds', unplacedCount, totalPeople: placed + unplacedCount }
}
