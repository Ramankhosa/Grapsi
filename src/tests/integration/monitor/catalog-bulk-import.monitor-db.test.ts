import AdmZip from 'adm-zip'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { EMPTY_SEARCH, approveImportRequests, importAllMatching, importWebsites, searchCatalogWebsites, type CatalogSearch } from '@/lib/monitor/catalogImport'
import { discoveryWorkbook } from '@/lib/monitor/discoveryExport'
import { BULK_SPREAD } from '@/lib/monitor/schedule'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/**
 * Bulk selection from the funding database (27 Oct 2026): filters by date,
 * title, category and research area; "add every match"; spread first checks;
 * bulk approval of operator requests; the Excel export for manual review.
 */

const FUNDER_TAG = 'bulk-import-fixture'
let operator = ''
let admin = ''
const days = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d }
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

async function call(host: string, title: string, extra: Record<string, unknown> = {}) {
  return db.fundingCall.create({
    data: {
      title, source_url: `https://${host}/funding/calls/${encodeURIComponent(title)}`, visibility: 'GLOBAL_PUBLISHED',
      opportunity_status: 'OPEN', createdByUserId: 'monitor-test', updatedByUserId: 'monitor-test', ...extra,
    },
  })
}

beforeEach(async () => {
  await resetMonitorTables()
  await db.funder.deleteMany({ where: { normalized_name: { startsWith: FUNDER_TAG } } })
  const user = (email: string) => db.user.upsert({ where: { email }, create: { email }, update: {} })
  operator = (await user('bulk-operator@monitor.invalid')).id
  admin = (await user('bulk-admin@monitor.invalid')).id
})
afterAll(async () => {
  await resetMonitorTables()
  await db.funder.deleteMany({ where: { normalized_name: { startsWith: FUNDER_TAG } } })
  await db.$disconnect()
})

const search = (patch: Partial<CatalogSearch>): CatalogSearch => ({ ...EMPTY_SEARCH, status: 'ANY', ...patch })
const hostsOf = async (patch: Partial<CatalogSearch>) => (await searchCatalogWebsites(search(patch))).websites.map((w) => w.host).sort()

describe('catalogue filters', () => {
  beforeEach(async () => {
    const funder = await db.funder.create({ data: { name: 'Fixture Science Fund', normalized_name: `${FUNDER_TAG} science`, country_code: 'GB', funder_type: 'GOVERNMENT' } })
    // a.invalid: fellowships with a deadline next month
    await call('a.invalid', 'Early career fellowship 2026', { funder_id: funder.id, funding_kinds: ['Fellowship'], career_stages: ['Postdoctoral'], next_deadline_at: days(20), amount_max_usd_est: 200000 })
    await call('a.invalid', 'Senior fellowship', { funder_id: funder.id, funding_kinds: ['Fellowship'], next_deadline_at: days(25) })
    // b.invalid: research grants, deadline in six months, added long ago
    await call('b.invalid', 'Project grant round 4', { funding_kinds: ['Research Grant'], next_deadline_at: days(180), createdAt: days(-400) })
    await call('b.invalid', 'Project grant round 5', { funding_kinds: ['Research Grant'], next_deadline_at: days(190), createdAt: days(-400), opportunity_status: 'CLOSED' })
  })

  it('a date range on the deadline keeps only websites with a call in it', async () => {
    expect(await hostsOf({ dateField: 'DEADLINE', dateFrom: isoDay(days(0)), dateTo: isoDay(days(30)) })).toEqual(['a.invalid'])
    expect(await hostsOf({ dateField: 'ADDED', dateFrom: isoDay(days(-30)) })).toEqual(['a.invalid'])
  })

  it('title words match in any order; categories, career stages and award size narrow the calls', async () => {
    expect(await hostsOf({ title: 'fellowship early' })).toEqual(['a.invalid'])
    expect(await hostsOf({ kinds: ['Research Grant'] })).toEqual(['b.invalid'])
    expect(await hostsOf({ careerStages: ['Postdoctoral'] })).toEqual(['a.invalid'])
    // One matching call is enough for the website to show, even when one-call websites are hidden.
    const [site] = (await searchCatalogWebsites(search({ minAwardUsd: 100000 }))).websites
    expect(site).toMatchObject({ host: 'a.invalid', matchedCalls: 1, calls: 2 })
  })

  it('reports the next deadline and sorts by it', async () => {
    const { websites } = await searchCatalogWebsites(search({ sort: 'DEADLINE' }))
    expect(websites.map((w) => w.host)).toEqual(['a.invalid', 'b.invalid'])
    expect(websites[0].nextDeadline).toBe(isoDay(days(20)))
  })

  it('research areas come from the call taxonomy', async () => {
    const upload = await db.researchAreaTaxonomyUpload.create({ data: { uploaded_by: admin } })
    const area = await db.researchAreaTaxonomyArea.create({ data: { upload_id: upload.id, level1_code: '3', level1_name: 'Medical & Health Sciences' } })
    const target = await db.fundingCall.findFirstOrThrow({ where: { title: 'Project grant round 4' } })
    await db.fundingCallResearchAreaTaxonomy.create({ data: { funding_call_id: target.id, taxonomy_area_id: area.id, taxonomy_level1_name: 'Medical & Health Sciences' } })
    try {
      expect(await hostsOf({ areas: ['Medical & Health Sciences'] })).toEqual(['b.invalid'])
    } finally {
      await db.researchAreaTaxonomyUpload.delete({ where: { id: upload.id } })
    }
  })
})

describe('bulk import', () => {
  it('adds every match with suggested settings, links every funder and skips file stores', async () => {
    const f1 = await db.funder.create({ data: { name: 'Fixture Fund One', normalized_name: `${FUNDER_TAG} one` } })
    const f2 = await db.funder.create({ data: { name: 'Fixture Fund Two', normalized_name: `${FUNDER_TAG} two` } })
    for (const host of ['one.invalid', 'two.invalid']) {
      await call(host, `${host} grant A`, { funder_id: f1.id })
      await call(host, `${host} grant B`, { funder_id: f2.id })
    }
    await call('one.invalid', 'one.invalid grant C', { funder_id: f2.id })
    await call('files.invalid', 'Guidelines A', { source_url: 'https://files.invalid/a.pdf' })
    await call('files.invalid', 'Guidelines B', { source_url: 'https://files.invalid/b.pdf' })

    const { results, matched } = await importAllMatching(search({}), { frequencyMinutes: null, priority: null, excludeKeywords: '' }, ['two.invalid'], { userId: admin, superAdmin: true })
    expect(matched).toBe(3)
    expect(results.find((r) => r.host === 'files.invalid')?.status).toBe('SKIPPED')
    expect(results.find((r) => r.host === 'one.invalid')).toMatchObject({ status: 'ADDED', funderLinks: 'CONFIRMED' })
    expect(results.some((r) => r.host === 'two.invalid')).toBe(false)
    const site = await db.monitorSite.findUniqueOrThrow({ where: { host: 'one.invalid' }, include: { funders: true } })
    expect(site.status).toBe('ACTIVE')
    expect(site.funders.map((f) => f.status)).toEqual(['CONFIRMED', 'CONFIRMED'])
    // Named after the funder publishing most calls there, not an arbitrary one.
    expect(site.display_name).toBe('Fixture Fund Two')
    // Saving a funder's official website is never done in bulk.
    expect((await db.funder.findUniqueOrThrow({ where: { id: f1.id } })).website_url).toBeNull()
  })

  it('watches a website once when both its bare and www hosts match, with the funders of both', async () => {
    const f1 = await db.funder.create({ data: { name: 'Fixture Fund Bare', normalized_name: `${FUNDER_TAG} bare` } })
    const f2 = await db.funder.create({ data: { name: 'Fixture Fund Www', normalized_name: `${FUNDER_TAG} www` } })
    for (const [host, funder] of [['dual.invalid', f1.id], ['www.dual.invalid', f2.id]] as const) {
      await call(host, `${host} grant A`, { funder_id: funder })
      await call(host, `${host} grant B`, { funder_id: funder })
    }
    const { results } = await importAllMatching(search({}), { frequencyMinutes: null, priority: null, excludeKeywords: '' }, [], { userId: admin, superAdmin: true })
    expect(results.filter((r) => r.status === 'ADDED')).toHaveLength(1)
    expect(results.find((r) => r.status === 'ALREADY_WATCHED')?.message).toMatch(/^Same website as/)
    expect(await db.monitoredSource.count()).toBe(1)
    expect(await db.monitorSiteFunder.count({ where: { status: 'CONFIRMED' } })).toBe(2)
  })

  it('spreads the first checks of a big batch so they do not all start at once', async () => {
    const count = BULK_SPREAD.freeUpTo + 5
    const items = Array.from({ length: count }, (_, i) => ({
      host: `s${i}.invalid`, watchUrl: `https://s${i}.invalid/calls`, pageKind: 'PAGE' as const, funderIds: [], officialWebsite: false, frequencyMinutes: 1440,
      priority: 'NORMAL' as const, relatedHosts: [], documentHosts: [], keywords: '', excludeKeywords: '', fetchMode: 'AUTO' as const, dailyBudgetUsd: null, note: null,
    }))
    const now = new Date()
    await importWebsites(items, { userId: admin, superAdmin: true }, now)
    const sources = await db.monitoredSource.findMany({ orderBy: { next_check_at: 'asc' } })
    expect(sources).toHaveLength(count)
    const spanMinutes = (sources.at(-1)!.next_check_at!.getTime() - sources[0].next_check_at!.getTime()) / 60_000
    expect(spanMinutes).toBeGreaterThan(count * BULK_SPREAD.minutesPerSite * 0.8)
    const tasks = await db.monitorTask.findMany({ where: { kind: 'DISCOVER_SITE' }, orderBy: { available_at: 'asc' } })
    expect(tasks).toHaveLength(count)
    expect(tasks.at(-1)!.available_at.getTime()).toBeGreaterThan(now.getTime() + 30 * 60_000)
  })

  it('a super admin approves many operator requests at once; a blocked site is reported, the rest go through', async () => {
    const items = ['p1.invalid', 'p2.invalid', 'p3.invalid'].map((host) => ({
      host, watchUrl: `https://${host}/calls`, pageKind: 'PAGE' as const, funderIds: [], officialWebsite: false, frequencyMinutes: 1440,
      priority: 'HIGH' as const, relatedHosts: [], documentHosts: [], keywords: '', excludeKeywords: '', fetchMode: 'AUTO' as const, dailyBudgetUsd: null, note: null,
    }))
    const results = await importWebsites(items, { userId: operator, superAdmin: false })
    expect(results.every((r) => r.status === 'PENDING_APPROVAL')).toBe(true)
    await db.monitorSite.update({ where: { host: 'p3.invalid' }, data: { status: 'BLOCKED' } })

    const ids = (await db.monitorSite.findMany({ orderBy: { host: 'asc' } })).map((s) => s.id)
    const outcome = await approveImportRequests(ids, admin)
    expect(outcome.approved).toBe(2)
    expect(outcome.failed).toEqual([expect.objectContaining({ host: 'p3.invalid' })])
    const sites = await db.monitorSite.findMany({ orderBy: { host: 'asc' } })
    expect(sites.map((s) => [s.host, s.status, s.priority, s.pending_scope === null])).toEqual([
      ['p1.invalid', 'ACTIVE', 'HIGH', true], ['p2.invalid', 'ACTIVE', 'HIGH', true], ['p3.invalid', 'BLOCKED', 'NORMAL', false],
    ])
  })
})

describe('Excel export for manual review', () => {
  it('writes one row per discovery with its result, drafted facts and empty review columns', async () => {
    const site = await db.monitorSite.create({ data: { host: 'export.invalid', display_name: 'Export Fund' } })
    const resource = await db.monitorResource.create({ data: { site_id: site.id, kind: 'PAGE', role: 'CALL_PAGE', canonical_url: 'https://export.invalid/call/1', dedup_key: 'https://export.invalid/call/1', last_validation_status: 'OK' } })
    await db.monitorOpportunity.create({
      data: {
        site_id: site.id, primary_resource_id: resource.id, title: 'Export & Review Grant <2027>', review_state: 'PENDING', processing_state: 'TRIAGED',
        triage_verdict: 'NEW_OPPORTUNITY', triage_confidence: 0.94, triage_reason: 'Applications invited',
        field_evidence: { payload: { fields: { close_date: { value: '2027-02-05' }, amount_max: { value: 50000 }, currency: { value: 'GBP' } } } },
      },
    })
    const bytes = await discoveryWorkbook('PENDING', 'reviewer@monitor.invalid')
    const zip = new AdmZip(Buffer.from(bytes))
    const sheet = zip.getEntry('xl/worksheets/sheet2.xml')!.getData().toString('utf8')
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('name="Opportunities"')
    expect(sheet).toContain('Funding found')
    expect(sheet).toContain('Export &amp; Review Grant &lt;2027&gt;')
    expect(sheet).toContain('2027-02-05')
    expect(sheet).toContain('50000 GBP')
    expect(sheet).toContain('Your decision')
  })
})
