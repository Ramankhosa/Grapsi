import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { catalogFacets, parseCatalogSearch, searchCatalogIds } from '@/lib/funding/catalogSearch'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/** 29 Oct 2026: the admin catalogue shows where each call came from and filters the whole catalogue. */

const TAG = 'zq-catalog-search'
let userId = ''

async function cleanup() {
  await resetMonitorTables()
  const user = await db.user.findUnique({ where: { email: `${TAG}@monitor.invalid` } })
  if (user) {
    await db.fundingIntakeJob.deleteMany({ where: { submitted_by_user_id: user.id } })
    await db.fundingIntakeBatch.deleteMany({ where: { submitted_by_user_id: user.id } })
  }
}
beforeEach(async () => {
  await cleanup()
  userId = (await db.user.upsert({ where: { email: `${TAG}@monitor.invalid` }, create: { email: `${TAG}@monitor.invalid` }, update: {} })).id
})
afterAll(async () => { await cleanup(); await db.$disconnect() })

const days = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d }
async function call(title: string, extra: Record<string, unknown> = {}) {
  return db.fundingCall.create({ data: { title: `${TAG} ${title}`, scheme_title: `${TAG} ${title}`, agency_name: 'Fixture Foundation', visibility: 'GLOBAL_PUBLISHED',
    createdByUserId: 'monitor-test', updatedByUserId: 'monitor-test', uploaded_by: 'editor@monitor.invalid', ...extra } })
}
async function viaIntake(title: string, job: { batch?: boolean; handoff?: boolean; sourceWatch?: boolean; autoPublished?: boolean } = {}, extra: Record<string, unknown> = {}) {
  const batch = job.batch || job.handoff ? await db.fundingIntakeBatch.create({ data: { submitted_by_user_id: userId, label: title, ...(job.handoff ? { handoff_key: `${TAG}:${title}` } : {}) } }) : null
  const intake = await db.fundingIntakeJob.create({ data: { submitted_by_user_id: userId, input_type: 'url', batch_id: batch?.id,
    fetch_metadata_json: job.sourceWatch ? { origin: 'source_watch' } : {} } })
  if (job.autoPublished) await db.fundingIntakeJobEvent.create({ data: { job_id: intake.id, next_status: 'draft_created', event_type: 'auto_publish_completed' } })
  return call(title, { intake_job_id: intake.id, ...extra })
}
const search = (params: Record<string, string>) => parseCatalogSearch(new URLSearchParams({ q: TAG, ...params }))
const titles = async (params: Record<string, string>) =>
  (await fundingCatalogService.searchFundingCalls(search(params))).calls.map((c) => c.scheme_title.replace(`${TAG} `, '')).sort()

describe('admin catalogue origin and filters', () => {
  it('labels each call by where it came from and flags auto-published ones', async () => {
    await viaIntake('manual', {}, { catalog_status: 'PUBLISHED' })
    await viaIntake('bulk', { batch: true, autoPublished: true }, { catalog_status: 'PUBLISHED' })
    await viaIntake('pipeline', { handoff: true, sourceWatch: true })
    await call('imported', { source: 'catalog-import:fixture' })
    await call('seeded')
    const { calls } = await fundingCatalogService.searchFundingCalls(search({}))
    const byTitle = Object.fromEntries(calls.map((c) => [c.scheme_title.replace(`${TAG} `, ''), c]))
    expect(byTitle.manual).toMatchObject({ origin: 'MANUAL', auto_published: false, entered_by: 'editor@monitor.invalid' })
    expect(byTitle.bulk).toMatchObject({ origin: 'BATCH', auto_published: true })
    expect(byTitle.pipeline.origin).toBe('SOURCE_WATCH')
    expect(byTitle.imported.origin).toBe('IMPORT')
    expect(byTitle.seeded.origin).toBe('OTHER')
    expect(await titles({ origin: 'batch' })).toEqual(['bulk'])
    expect(await titles({ origin: 'SOURCE_WATCH' })).toEqual(['pipeline'])
    expect(await titles({ approval: 'AUTO' })).toEqual(['bulk'])
    expect(await titles({ approval: 'PERSON' })).toEqual(['manual'])
    expect(await titles({ approval: 'UNPUBLISHED' })).toEqual(['imported', 'pipeline', 'seeded'])
    const facets = await catalogFacets(search({}))
    expect(facets.origins).toMatchObject({ MANUAL: 1, BATCH: 1, SOURCE_WATCH: 1, IMPORT: 1, OTHER: 1 })
  })

  it('filters by status, deadline and funding type, searches text, and pages over the total', async () => {
    await call('open grant', { catalog_status: 'PUBLISHED', close_date: days(20), funding_kinds: ['GRANT'] })
    await call('closed fellowship', { catalog_status: 'PUBLISHED', close_date: days(-5), funding_kinds: ['FELLOWSHIP'] })
    await call('rolling scheme', { is_rolling: true })
    await call('undated draft')
    await call('imported elsewhere', { visibility: 'GLOBAL_CATALOG', close_date: days(10) })
    expect(await titles({ status: 'PUBLISHED' })).toEqual(['closed fellowship', 'open grant'])
    expect(await titles({ deadline: 'OPEN' })).toEqual(['open grant', 'rolling scheme'])
    expect(await titles({ deadline: 'CLOSED' })).toEqual(['closed fellowship'])
    expect(await titles({ deadline: 'NONE' })).toEqual(['undated draft'])
    expect(await titles({ kind: 'FELLOWSHIP' })).toEqual(['closed fellowship'])
    expect(await titles({ q: `${TAG} rolling` })).toEqual(['rolling scheme'])
    // Unknown values are ignored rather than matching nothing.
    expect((await titles({ status: 'NONSENSE', origin: 'x' })).length).toBe(4)
    const sorted = await fundingCatalogService.searchFundingCalls(search({ sort: 'DEADLINE' }))
    expect(sorted.calls[0].scheme_title).toContain('closed fellowship')
    const first = await searchCatalogIds({ ...search({}), pageSize: 3 })
    expect(first).toMatchObject({ total: 4 })
    expect(first.rows).toHaveLength(3)
    // A search value is matched literally, not as a LIKE pattern.
    expect(await titles({ q: `${TAG}%rolling` })).toEqual([])
  })
})
