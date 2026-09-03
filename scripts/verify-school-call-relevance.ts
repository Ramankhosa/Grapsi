/**
 * Verification harness for school ↔ call discipline relevance.
 *
 * Read-only unless --map is passed. Exercises the same functions the queue
 * endpoint calls, so it proves the relevance logic without going through HTTP
 * auth.
 *
 *   (no flags)  report the discipline profile of every school and how many open
 *               calls are relevant to each
 *   --map       map every unmapped school from its own name (what an admin
 *               would confirm in the structure page), so the report has
 *               something to show on a fresh database
 *   --unmap     remove every unit mapping, to re-test the unmapped fallback
 *
 * Usage: node ./node_modules/tsx/dist/cli.cjs scripts/verify-school-call-relevance.ts
 */
import 'dotenv/config'

import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import {
  loadUnitAreaProfile,
  relevanceForCalls,
  relevantCallWhereSql,
} from '@/lib/funding/callUnitRelevance'
import { loadActiveAreas } from '@/lib/funding/disciplineClassifier'
import { matchAreas } from '@/lib/funding/disciplineMatcher'

async function mapSchoolsFromName() {
  const areas = await loadActiveAreas()
  if (areas.length === 0) throw new Error('No active taxonomy. Run `npm run seed:research-areas`.')

  const units = await prisma.tenantOrgUnit.findMany({
    where: { is_active: true },
    select: { id: true, tenant_id: true, name: true, depth: true },
    orderBy: [{ depth: 'asc' }, { name: 'asc' }],
  })

  for (const unit of units) {
    const existing = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM tenant_org_unit_research_areas WHERE org_unit_id = $1`,
      unit.id
    )
    if ((existing[0]?.count ?? 0) > 0) continue

    const matches = matchAreas({ title: unit.name }, areas)
    if (matches.length === 0) {
      console.log(`   (no name match) ${'  '.repeat(unit.depth)}${unit.name}`)
      continue
    }

    for (const match of matches) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenant_org_unit_research_areas
           (id, tenant_id, org_unit_id, taxonomy_area_id, source, created_at)
         VALUES ($1, $2, $3, $4, 'suggested_name', now())
         ON CONFLICT (org_unit_id, taxonomy_area_id) DO NOTHING`,
        `toura_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        unit.tenant_id,
        unit.id,
        match.areaId
      )
    }
    console.log(`   mapped ${'  '.repeat(unit.depth)}${unit.name} → ${matches.length} area(s)`)
  }
}

async function main() {
  if (process.argv.includes('--unmap')) {
    const removed = await prisma.$executeRawUnsafe(`DELETE FROM tenant_org_unit_research_areas`)
    console.log(`Removed ${removed} unit mappings.\n`)
  }

  if (process.argv.includes('--map')) {
    console.log('1) Mapping unmapped units from their names:')
    await mapSchoolsFromName()
    console.log('')
  }

  console.log('2) Discipline profile and relevant open calls, per school:\n')

  const schools = await prisma.tenantOrgUnit.findMany({
    where: { depth: 0, is_active: true },
    select: { id: true, tenant_id: true, name: true },
    orderBy: { name: 'asc' },
  })

  for (const school of schools) {
    const profile = await loadUnitAreaProfile(school.tenant_id, [school.id])
    const predicate = relevantCallWhereSql(profile, 'fc')

    const rows = await prisma.$queryRaw<Array<{ id: string; title: string }>>(Prisma.sql`
      SELECT fc.id, COALESCE(fc.scheme_title, fc.title) AS title
        FROM funding_calls fc
       WHERE (
              (fc."tenantId" = ${school.tenant_id} AND (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED'))
              OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED')
             )
         AND (COALESCE(fc.close_date, fc."deadlineAt") IS NULL OR COALESCE(fc.close_date, fc."deadlineAt") >= now())
         AND ${predicate}
       ORDER BY title
    `)

    const total = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM funding_calls fc
       WHERE (
              (fc."tenantId" = ${school.tenant_id} AND (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED'))
              OR (fc."tenantId" IS NULL AND fc.visibility = 'GLOBAL_PUBLISHED' AND fc.status = 'PUBLISHED')
             )
         AND (COALESCE(fc.close_date, fc."deadlineAt") IS NULL OR COALESCE(fc.close_date, fc."deadlineAt") >= now())
    `)

    const relevance = await relevanceForCalls(profile, rows.map((row) => row.id))

    console.log(
      `── ${school.name}  [${profile.areaIds.length} areas, ${profile.keywords.length} keywords]` +
        (profile.isUnmapped ? '  ⚠ UNMAPPED — falls back to the whole catalog' : '')
    )
    console.log(`   ${rows.length} of ${total[0]?.count ?? 0} open calls relevant`)
    for (const row of rows) {
      const match = relevance.get(row.id)
      console.log(`     · [${match?.tier ?? 'none'}] ${row.title} — ${match?.reason ?? ''}`)
    }
    console.log('')
  }

  console.log('3) Calls with no classification (must be visible to every school):')
  const unclassified = await prisma.$queryRaw<Array<{ title: string }>>(Prisma.sql`
    SELECT COALESCE(fc.scheme_title, fc.title) AS title
      FROM funding_calls fc
     WHERE NOT EXISTS (
       SELECT 1 FROM funding_call_research_area_taxonomies m WHERE m.funding_call_id = fc.id
     )
  `)
  console.log(
    unclassified.length === 0
      ? '   (none — every call is classified)'
      : unclassified.map((row) => `   · ${row.title}`).join('\n')
  )
}

main()
  .catch((error) => {
    console.error('Failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
