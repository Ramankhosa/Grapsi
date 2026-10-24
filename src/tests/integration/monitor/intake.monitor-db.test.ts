import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => { const { testPrisma } = await import('../helpers/monitorTestPrisma'); return { prisma: testPrisma, default: testPrisma } })
vi.mock('@/lib/monitor/actor', () => ({ resolveMonitorActor: vi.fn(), MonitorConfigError: class extends Error {} }))
import { fundingIntakeService } from '@/lib/fundingIntake/service'
import { resolveMonitorActor } from '@/lib/monitor/actor'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'
import type { FundingExtractionPayload } from '@/lib/fundingIntake/types'

let userId: string
let tenantId: string
const text = 'Alpha Foundation invites applications for the Alpha Research Grant 2026. The programme funds university research projects in health and climate. Applications close on 30 November 2026.'
function field(value: unknown) { return { value, status: 'supported', confidence: 0.95, evidence: [{ sourceType: 'segment', segmentId: 'fixture:1', quote: text }] } }
const payload = { fields: { agency_name: field('Alpha Foundation'), scheme_title: field('Alpha Research Grant 2026'), description: field('The programme funds university research projects in health and climate.'), close_date: field('2026-11-30') }, warnings: [] } as unknown as FundingExtractionPayload
beforeAll(async () => {
  const tenant = await db.tenant.upsert({ where: { atiId: 'MONITOR_FIXTURE' }, create: { name: 'Monitor Fixture', atiId: 'MONITOR_FIXTURE' }, update: {} })
  tenantId = tenant.id
  const user = await db.user.upsert({ where: { email: 'monitor-service-fixture@system.invalid' }, create: { email: 'monitor-service-fixture@system.invalid', name: 'Fixture', tenantId, roles: [] }, update: {} })
  userId = user.id
  vi.mocked(resolveMonitorActor).mockResolvedValue({ userId, tenantId, planId: 'fixture', tenantContext: { tenantId, userId, planId: 'fixture' } } as Awaited<ReturnType<typeof resolveMonitorActor>>)
  vi.spyOn(fundingIntakeService, 'enqueue').mockImplementation(() => undefined)
})
beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => {
  const batches = await db.fundingIntakeBatch.findMany({ where: { handoff_key: { startsWith: 'monitor-fixture:' } } })
  await db.fundingCall.deleteMany({ where: { createdByUserId: userId } })
  await db.fundingIntakeJob.deleteMany({ where: { batch_id: { in: batches.map(b => b.id) } } })
  await db.fundingIntakeBatch.deleteMany({ where: { id: { in: batches.map(b => b.id) } } })
  await db.user.deleteMany({ where: { id: userId } })
  await db.tenant.deleteMany({ where: { id: tenantId } })
  await resetMonitorTables(); await db.$disconnect()
})
describe('internal Source Watch intake policy', () => {
  it('creates one atomic batch/job under concurrent duplicate handoffs and preserves the origin URL', async () => {
    const input = { jobs: [{ sources: [{ sourceKey: 'source_1', inputType: 'text' as const, sourceText: text, originUrl: 'https://funder.example/Call?ID=Alpha' }], detailsSourceKey: 'source_1', autoPublish: true, extractAll: true }] }
    const context = { handoffKey: 'monitor-fixture:concurrent', opportunityId: 'fixture', funderId: null, payload }
    const operator = { userId, tenantId, email: 'monitor-service-fixture@system.invalid', role: 'CURATOR' as const }
    const [a, b] = await Promise.all([fundingIntakeService.createBatch(operator, input, context), fundingIntakeService.createBatch(operator, input, context)])
    expect(a.id).toBe(b.id)
    const jobs = await db.fundingIntakeJob.findMany({ where: { batch_id: a.id } })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].source_url).toBe('https://funder.example/Call?ID=Alpha')
    const meta = jobs[0].fetch_metadata_json as { origin: string; batch_intake: { auto_publish: boolean; extract_all: boolean } }
    expect(meta.origin).toBe('source_watch')
    expect(meta.batch_intake).toMatchObject({ auto_publish: false, extract_all: false })
    expect(await db.fundingIntakeJobSource.count({ where: { job_id: jobs[0].id } })).toBe(1)
  })
  it('uses the pre-extracted bundle and makes a global unpublished draft without giving the service user login roles', async () => {
    const batch = await fundingIntakeService.createBatch({ userId, tenantId, email: 'monitor-service-fixture@system.invalid', role: 'CURATOR' }, {
      jobs: [{ sources: [{ sourceKey: 'source_1', inputType: 'text', sourceText: text, originUrl: 'https://funder.example/second' }], detailsSourceKey: 'source_1', autoPublish: true }],
    }, { handoffKey: 'monitor-fixture:process', opportunityId: 'fixture', funderId: null, payload })
    const job = await db.fundingIntakeJob.findFirstOrThrow({ where: { batch_id: batch.id } })
    await fundingIntakeService.processJob(job.id)
    const saved = await db.fundingIntakeJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(saved.status, saved.error_message ?? 'job status').toBe('draft_created')
    const call = await db.fundingCall.findUniqueOrThrow({ where: { id: saved.linked_funding_call_id! } })
    expect(call.catalog_status).toBe('DRAFT')
    expect(call.is_active).toBe(false)
    expect(call.visibility).toBe('GLOBAL_PUBLISHED')
    expect((call.metadata as { origin: string }).origin).toBe('source_watch')
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).roles).toEqual([])
    await fundingIntakeService.processJob(job.id)
    expect(await db.fundingCall.count({ where: { intake_job_id: job.id } })).toBe(1)
  })
})
