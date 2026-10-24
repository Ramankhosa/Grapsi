import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})
import { triageCandidates, queueCandidates } from '@/lib/monitor/candidates'
import { extractOpportunity, groundedValue } from '@/lib/monitor/extract'
import { selectedPdf } from '@/lib/monitor/ocr'
import { assertReviewWrite, MonitorConflictError } from '@/lib/monitor/writeGuard'
import { enqueueTask, claimNextTask } from '@/lib/monitor/queue'
import type { SafeFetch } from '@/lib/monitor/safeFetch'
import type { PaidStageInput, PaidStageResult } from '@/lib/monitor/paidCall'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })
async function resource(host = 'pipeline.example') {
  const site = await db.monitorSite.create({ data: { host, min_delay_ms: 0 } })
  const r = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: `https://${host}/call`, canonical_url: `https://${host}/call`, title: 'Alpha Research Grant 2026' } })
  return { site, r }
}
function fixture(pages: Record<string, string | Buffer>): SafeFetch {
  return async url => {
    const content = pages[url]
    if (content === undefined) throw new Error('Missing fixture ' + url)
    const pdf = Buffer.isBuffer(content)
    const body = Buffer.from(content)
    return { requestedUrl: url, finalUrl: url, status: 200, headers: {}, body, byteLength: body.length, truncated: false, contentKind: pdf ? 'pdf' : 'html', contentType: pdf ? 'application/pdf' : 'text/html', notModified: false, redirects: [], tlsExceptionUsed: false }
  }
}
function paidResult(text: string): PaidStageResult { return { text, model: 'fixture', attemptId: 'fixture', actualMicros: 1n, attemptNo: 1 } }
describe('screening and evidence integration', () => {
  it('caches per item and never reopens a human rejection on a rerun', async () => {
    const { site, r } = await resource()
    const fetch = fixture({ [r.canonical_url!]: '<main><h1>Alpha Research Grant 2026</h1><p>Applications for the research grant are invited from eligible university researchers before 30 November 2026.</p></main>' })
    const paid = vi.fn(async (_input: PaidStageInput) => paidResult(JSON.stringify({ items: [{ id: r.id, verdict: 'NEW_OPPORTUNITY', confidence: 0.95, reason: 'Official application call', type: 'grant' }] })))
    await queueCandidates(db, site.id, [r.id], true, 'first')
    const first = await claimNextTask({ owner: 'fixture', kinds: ['TRIAGE'] })
    await triageCandidates(first!, { fetch, paid })
    const opportunity = await db.monitorOpportunity.findFirstOrThrow({ where: { primary_resource_id: r.id } })
    await db.monitorOpportunity.update({ where: { id: opportunity.id }, data: { review_state: 'REJECTED' } })
    await queueCandidates(db, site.id, [r.id], false, 'second-occurrence')
    const second = await claimNextTask({ owner: 'fixture', kinds: ['TRIAGE'] })
    await triageCandidates(second!, { fetch, paid })
    expect(paid).toHaveBeenCalledTimes(1)
    expect((await db.monitorOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).review_state).toBe('REJECTED')
    expect(await db.monitorEvent.count({ where: { kind: 'NEW_DISCOVERY' } })).toBe(1)
  })
  it('does not lose other batch members when one detail URL is unreadable', async () => {
    const { site, r } = await resource('batch-failure.example')
    const bad = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'bad', canonical_url: 'https://batch-failure.example/bad', title: 'Research Grant missing' } })
    const fetch = fixture({ [r.canonical_url!]: '<main>Research grant applications are invited from researchers. This is the official funding announcement for the 2026 round.</main>' })
    await queueCandidates(db, site.id, [bad.id, r.id], false, 'mixed')
    const lease = await claimNextTask({ owner: 'fixture', kinds: ['TRIAGE'] })
    await triageCandidates(lease!, { fetch, paid: async () => paidResult(JSON.stringify({ items: [{ id: r.id, verdict: 'NEW_OPPORTUNITY', confidence: 0.9, reason: 'Official funding call', type: 'grant' }] })) })
    expect((await db.monitorOpportunity.findFirstOrThrow({ where: { primary_resource_id: bad.id } })).processing_state).toBe('NEEDS_EVIDENCE')
    expect((await db.monitorOpportunity.findFirstOrThrow({ where: { primary_resource_id: r.id } })).triage_verdict).toBe('NEW_OPPORTUNITY')
  })
  it('extracts facts from a guideline PDF with no intake extract-all pass', async () => {
    const { site, r } = await resource('pdf-evidence.example')
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800]); const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Alpha Foundation: Alpha Research Grant 2026.', { x: 20, y: 750, size: 12, font })
    page.drawText('Applications close on 30 November 2026.', { x: 20, y: 720, size: 12, font })
    const pdfUrl = 'https://pdf-evidence.example/guidelines.pdf'
    const fetch = fixture({ [r.canonical_url!]: `<main>Official funding announcement. The full call details and the application deadline are in the linked document.<a href="${pdfUrl}">Call guidelines</a></main>`, [pdfUrl]: Buffer.from(await doc.save()) })
    const opportunity = await db.monitorOpportunity.create({ data: { site_id: site.id, primary_resource_id: r.id, title: r.title, review_state: 'PENDING', match_type: 'NEW' } })
    await enqueueTask(db, { kind: 'EXTRACT', operationKey: 'pdf-extract', siteId: site.id, payload: { opportunityId: opportunity.id, reviewRevision: 0 } })
    const lease = await claimNextTask({ owner: 'fixture', kinds: ['EXTRACT'] })
    await extractOpportunity(lease!, { fetch, paid: async input => {
      const manifest = JSON.parse(input.prompt.split('\n')[0]).manifest as Array<{ id: string; role: string }>
      const guideline = manifest.find(s => s.role === 'GUIDELINES')!
      expect(input.prompt).toContain('30 November 2026')
      return paidResult(JSON.stringify({ fields: {
        close_date: { value: '2026-11-30', citations: [{ segment: guideline.id, quote: 'Applications close on 30 November 2026.', coverage: 'COMPLETE' }] },
        amount_max: { value: 9000000, citations: [{ segment: guideline.id, quote: 'Applications close on 30 November 2026.', coverage: 'COMPLETE' }] },
      } }))
    } })
    const saved = await db.monitorOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } })
    const payload = saved.field_evidence as unknown as { payload: { fields: Record<string, { value: unknown }> } }
    expect(payload.payload.fields.close_date.value).toBe('2026-11-30')
    expect(payload.payload.fields.amount_max.value).toBeNull()
    expect(await db.monitorOpportunityEvidence.count({ where: { opportunity_id: saved.id, role: 'GUIDELINES' } })).toBe(1)
  })
  it('supplies only the requested pages from a 30-page scanned document', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 30; i++) doc.addPage()
    const subset = await selectedPdf(Buffer.from(await doc.save()), [3, 4])
    expect((await PDFDocument.load(subset)).getPageCount()).toBe(2)
  })
  it('requires recent successful unchanged evidence and rejects a changed review revision', async () => {
    const { site, r } = await resource('freshness.example')
    const call = await db.fundingCall.create({ data: { title: 'Guarded call', visibility: 'GLOBAL_PUBLISHED', createdByUserId: 'monitor-test', updatedByUserId: 'monitor-test' } })
    const opportunity = await db.monitorOpportunity.create({ data: { site_id: site.id, primary_resource_id: r.id, funding_call_id: call.id, match_type: 'UPDATE_OF' } })
    const version = await db.monitorResourceVersion.create({ data: { resource_id: r.id, raw_hash: 'fixture', meaningful_hash: 'fixture' } })
    await db.monitorResource.update({ where: { id: r.id }, data: { current_version_id: version.id, last_validated_at: new Date(), last_validation_status: 'NOT_MODIFIED' } })
    await db.monitorOpportunityEvidence.create({ data: { opportunity_id: opportunity.id, resource_id: r.id, version_id: version.id, role: 'CALL_NOTICE' } })
    const expected = { opportunityId: opportunity.id, callRevision: call.revision, reviewRevision: 0, evidenceManifestVersion: 0 }
    await expect(assertReviewWrite(db, call, expected, true)).resolves.toBeUndefined()
    await db.monitorResource.update({ where: { id: r.id }, data: { last_validation_status: 'UNREACHABLE' } })
    await expect(assertReviewWrite(db, call, expected, true)).rejects.toBeInstanceOf(MonitorConflictError)
    await db.monitorOpportunity.update({ where: { id: opportunity.id }, data: { review_revision: 1 } })
    await expect(assertReviewWrite(db, call, expected)).rejects.toBeInstanceOf(MonitorConflictError)
  })
  it('does not accept an invented numeric fact merely because the quote exists', () => {
    expect(groundedValue('amount_max', 500000, 'Funding up to 5 lakh')).toBe(true)
    expect(groundedValue('amount_max', 9000000, 'Funding up to 5 lakh')).toBe(false)
    expect(groundedValue('close_date', '2027-11-30', 'Applications close 30 November 2026')).toBe(false)
  })
  it('applies only selected reviewed fields and refuses a stale retry without changing catalog origin or status', async () => {
    const { site, r } = await resource('reviewed-update.example')
    const call = await db.fundingCall.create({ data: { title: 'Alpha Research Grant 2026', source_url: r.canonical_url, visibility: 'GLOBAL_PUBLISHED', catalog_status: 'PUBLISHED', description: 'Original curator description', metadata: { origin: 'catalog_import' }, createdByUserId: 'monitor-test', updatedByUserId: 'monitor-test' } })
    const opportunity = await db.monitorOpportunity.create({ data: { site_id: site.id, primary_resource_id: r.id, title: call.title, funding_call_id: call.id, match_type: 'UPDATE_OF' } })
    const version = await db.monitorResourceVersion.create({ data: { resource_id: r.id, raw_hash: 'update', meaningful_hash: 'update' } })
    await db.monitorResource.update({ where: { id: r.id }, data: { current_version_id: version.id, last_validated_at: new Date(), last_validation_status: 'OK' } })
    await db.monitorOpportunityEvidence.create({ data: { opportunity_id: opportunity.id, resource_id: r.id, version_id: version.id, role: 'CALL_NOTICE' } })
    const expected = { opportunityId: opportunity.id, callRevision: call.revision, reviewRevision: 0, evidenceManifestVersion: 0 }
    const operator = { userId: 'monitor-test', tenantId: null, email: 'fixture@system.invalid', role: 'CURATOR' as const }
    await fundingCatalogService.applyReviewedUpdate(call.id, { close_date: '2026-12-31' }, operator, expected)
    const updated = await db.fundingCall.findUniqueOrThrow({ where: { id: call.id } })
    expect(updated.catalog_status).toBe('PUBLISHED')
    expect(updated.description).toBe('Original curator description')
    expect((updated.metadata as { origin: string }).origin).toBe('catalog_import')
    expect(updated.revision).toBeGreaterThan(call.revision)
    await expect(fundingCatalogService.applyReviewedUpdate(call.id, { close_date: '2027-01-01' }, operator, expected)).rejects.toBeInstanceOf(MonitorConflictError)
  })
})
