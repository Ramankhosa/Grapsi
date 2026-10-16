/**
 * Finder parity around the existing-call backfill.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/finder-parity.ts capture --out parity-before.json
 *   node ./node_modules/tsx/dist/cli.cjs scripts/finder-parity.ts compare --before parity-before.json
 *
 * Records, for a fixed set of queries, which LEGACY calls the finder's text
 * match returns, the directory totals for a fixed set of filters, and the
 * My areas counts of a few profiled researchers. compare exits 1 when a
 * legacy call drops out of a text match or a filter total changes. Text
 * matches may only grow (the backfill indexes a call's summary). Read-only.
 */
import fs from 'node:fs'

import { Prisma } from '@prisma/client'

import prisma from '../src/lib/prisma'
import { findCallsInMyAreas } from '../src/lib/funding/myAreasService'
import { buildFundingCallTextSearchCondition, recommendationSearchService } from '../src/lib/services/recommendationSearchService'

const QUERIES = [
  'cancer immunotherapy', 'climate adaptation', 'machine learning', 'artificial intelligence', 'public health',
  'agriculture', 'quantum materials', 'renewable energy', 'neuroscience', 'biodiversity',
  'education technology', 'women in science', 'travel grant', 'conference', 'fellowship',
  'manufacturing', 'policy', 'genomics', 'imaging', 'infrastructure',
  'innovation', 'social innovation', 'data reuse', 'collaboration mobility', 'seed grant',
  'clinical', 'rural', 'storage', 'leadership', 'photonics',
]

const FILTERS: Array<Record<string, unknown>> = [
  { eligibleCountries: ['India'] },
  { eligibleCountries: ['Germany'] },
  { eligibleCountries: ['United States'] },
  { hostCountries: ['India'] },
  { fundingKinds: ['Fellowship'] },
  { fundingKinds: ['Research Grant'] },
  { careerStages: ['Early Career'] },
  { eligibleRegions: ['Asia'] },
  { amountMin: 10000 },
  { amountMax: 100000 },
  { amountMin: 10000, amountCurrency: 'USD' },
  { rollingOnly: true },
  { includeExpired: true },
]

type Snapshot = {
  takenAt: string
  text: Record<string, string[]>
  filters: Record<string, number>
  myAreas: Record<string, { active: number; expired: number; total: number }>
}

async function capture(): Promise<Snapshot> {
  const text: Snapshot['text'] = {}
  for (const query of QUERIES) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM funding_calls
      WHERE import_run_id IS NULL AND ${buildFundingCallTextSearchCondition(query)}
      ORDER BY id
    `)
    text[query] = rows.map((row) => row.id)
  }
  const tenant = await prisma.user.findFirst({ where: { tenantId: { not: null } }, select: { tenantId: true }, orderBy: { createdAt: 'asc' } })
  const access = { tenantId: tenant?.tenantId || null, isSuperAdmin: false } as never
  const filters: Snapshot['filters'] = {}
  for (const filter of FILTERS) {
    const result = await recommendationSearchService.browseDirectory({ query: '', access, filters: { limit: 5, ...filter } } as never)
    filters[JSON.stringify(filter)] = result.totalResults
  }
  const researchers = await prisma.researcherProfile.findMany({
    where: { embedding_voyage_1024: { not: null } } as never,
    select: { user_id: true, user: { select: { tenantId: true } } },
    orderBy: { user_id: 'asc' },
    take: 3,
  }).catch(async () =>
    prisma.researcherProfile.findMany({ select: { user_id: true, user: { select: { tenantId: true } } }, orderBy: { user_id: 'asc' }, take: 3 })
  )
  const myAreas: Snapshot['myAreas'] = {}
  for (const researcher of researchers) {
    const result = await findCallsInMyAreas(researcher.user_id, researcher.user.tenantId ?? null, { status: 'all' })
    myAreas[researcher.user_id] = result.counts
  }
  return { takenAt: new Date().toISOString(), text, filters, myAreas }
}

async function main() {
  const command = process.argv[2]
  const option = (name: string) => {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : undefined
  }
  if (command === 'capture') {
    const snapshot = await capture()
    const out = option('out') || 'finder-parity.json'
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2))
    console.log(`Captured ${QUERIES.length} text queries, ${FILTERS.length} filters, ${Object.keys(snapshot.myAreas).length} My areas → ${out}`)
    return
  }
  if (command !== 'compare') throw new Error('Usage: finder-parity.ts capture --out f.json | compare --before f.json')
  const before = JSON.parse(fs.readFileSync(option('before') || 'finder-parity.json', 'utf8')) as Snapshot
  const after = await capture()
  let failures = 0
  let added = 0
  for (const query of QUERIES) {
    const was = new Set(before.text[query] || [])
    const now = new Set(after.text[query] || [])
    const lost = [...was].filter((id) => !now.has(id))
    const gained = [...now].filter((id) => !was.has(id))
    added += gained.length
    if (lost.length > 0) {
      failures++
      console.log(`LOST  "${query}": ${lost.length} legacy call(s) no longer match`)
    }
    if (gained.length > 0) console.log(`added "${query}": ${gained.length} legacy call(s) now match`)
  }
  for (const [filter, total] of Object.entries(before.filters)) {
    if (after.filters[filter] !== total) {
      failures++
      console.log(`DIFF  filter ${filter}: ${total} → ${after.filters[filter]}`)
    }
  }
  for (const [userId, counts] of Object.entries(before.myAreas)) {
    const now = after.myAreas[userId]
    if (!now) continue
    if (now.total < counts.total) {
      failures++
      console.log(`DIFF  My areas ${userId}: ${JSON.stringify(counts)} → ${JSON.stringify(now)}`)
    } else if (now.total !== counts.total) {
      console.log(`grew  My areas ${userId}: ${counts.total} → ${now.total}`)
    }
  }
  console.log(`${QUERIES.length} text queries (${added} legacy matches added), ${FILTERS.length} filters, ${Object.keys(before.myAreas).length} My areas: ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
