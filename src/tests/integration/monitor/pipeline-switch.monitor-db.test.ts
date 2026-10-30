import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => { const { testPrisma } = await import('../helpers/monitorTestPrisma'); return { prisma: testPrisma, default: testPrisma } })
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
import { llmGateway } from '@/lib/metering/gateway'
import { runPaidStage } from '@/lib/monitor/paidCall'
import { runPaidBatches, type BatchClient } from '@/lib/monitor/paidBatch'
import { pipelineSwitch, setPipelineSwitch } from '@/lib/monitor/pipelineSwitch'
import { planDueChecks } from '@/lib/monitor/planner'
import { claimNextTask, enqueueTask } from '@/lib/monitor/queue'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/** The master switch (30 Oct 2026): one row stops crawling, screening, extraction and paid AI at once. */

beforeEach(async () => { await resetMonitorTables(); vi.mocked(llmGateway.executeLLMOperation).mockReset(); vi.stubEnv('MONITOR_PAID_WORK_ENABLED', 'true') })
afterEach(() => { vi.unstubAllEnvs() })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })

describe('pipeline master switch', () => {
  it('reads as running until someone stops it, and records who and why', async () => {
    expect((await pipelineSwitch()).paused).toBe(false)
    await setPipelineSwitch('STOPPED', { by: 'ops@example.org', reason: '  checking costs ' })
    expect(await pipelineSwitch()).toMatchObject({ paused: true, by: 'ops@example.org', reason: 'checking costs' })
    await setPipelineSwitch('RUNNING', { by: 'ops@example.org', reason: 'ignored when starting' })
    expect(await pipelineSwitch()).toMatchObject({ mode: 'RUNNING', paused: false, crawlPaused: false, reason: null })
  })

  it('reads a row written before the crawl-only position', async () => {
    await db.monitorSyncCursor.create({ data: { name: 'pipeline-switch', cursor: { paused: true, by: 'old@example.org' } } })
    expect(await pipelineSwitch()).toMatchObject({ mode: 'STOPPED', paused: true, crawlPaused: true })
  })

  it('crawl paused: finishes screening and extraction, fetches no new pages, plans no checks', async () => {
    const site = await db.monitorSite.create({ data: { host: 'crawl.example', status: 'ACTIVE', origin: 'MANUAL', min_delay_ms: 0 } })
    await db.monitoredSource.create({ data: { name: 'crawl', url: 'https://crawl.example/calls', site_id: site.id, next_check_at: new Date(Date.now() - 60_000), fetch_mode: 'FETCH' } })
    await enqueueTask(db, { kind: 'CHECK_SOURCE', operationKey: 'check:crawl:1', payload: {}, priority: 1 })
    await enqueueTask(db, { kind: 'REVISIT', operationKey: 'revisit:crawl:1', payload: {}, priority: 1 })
    await enqueueTask(db, { kind: 'EXTRACT', operationKey: 'extract:crawl:1', payload: {}, priority: 50 })
    await setPipelineSwitch('CRAWL_PAUSED', { by: 'ops@example.org', reason: 'finish the queue' })
    expect(await pipelineSwitch()).toMatchObject({ mode: 'CRAWL_PAUSED', paused: false, crawlPaused: true })
    expect((await claimNextTask({ owner: 'test' }))?.operationKey).toBe('extract:crawl:1')
    expect(await claimNextTask({ owner: 'test' })).toBeNull()
    const planned = await planDueChecks()
    expect(planned.enqueued).toBe(0)
    expect(await db.monitorTask.count({ where: { kind: { in: ['CHECK_SOURCE', 'REVISIT', 'DISCOVER_SITE'] } } })).toBe(2)
    await setPipelineSwitch('RUNNING', { by: 'ops@example.org' })
    expect((await claimNextTask({ owner: 'test' }))?.operationKey).toMatch(/^(check|revisit):crawl:1$/)
  })

  it('stops workers claiming, keeps the task queued, and resumes when switched on', async () => {
    await enqueueTask(db, { kind: 'REFRESH_URL_INDEX', operationKey: 'url-index:switch', payload: {} })
    await setPipelineSwitch('STOPPED', { by: 'ops@example.org' })
    expect(await claimNextTask({ owner: 'test' })).toBeNull()
    expect((await db.monitorTask.findFirstOrThrow({ where: { operation_key: 'url-index:switch' } })).status).toBe('QUEUED')
    await setPipelineSwitch('RUNNING', { by: 'ops@example.org' })
    expect((await claimNextTask({ owner: 'test' }))?.operationKey).toBe('url-index:switch')
  })

  it('queues no scheduled checks while stopped', async () => {
    const site = await db.monitorSite.create({ data: { host: 'switch.example', status: 'ACTIVE', origin: 'MANUAL', min_delay_ms: 0 } })
    await db.monitoredSource.create({ data: { name: 'switch', url: 'https://switch.example/calls', site_id: site.id, next_check_at: new Date(Date.now() - 60_000), fetch_mode: 'FETCH' } })
    await setPipelineSwitch('STOPPED', { by: 'ops@example.org' })
    expect((await planDueChecks()).enqueued).toBe(0)
    expect(await db.monitorTask.count()).toBe(0)
    await setPipelineSwitch('RUNNING', { by: 'ops@example.org' })
    expect((await planDueChecks()).enqueued).toBe(1)
  })

  it('makes no paid AI call and submits no provider batch while stopped', async () => {
    await setPipelineSwitch('STOPPED', { by: 'ops@example.org' })
    await expect(runPaidStage({ stage: 'FUNDING_SOURCE_EXTRACT', operationKey: 'extract:switch', systemPrompt: 's', prompt: 'p', jsonSchema: { name: 'x', schema: { type: 'object' } }, maxOutputTokens: 100, scopes: ['PLATFORM'] })).rejects.toThrow(/switched off/)
    expect(llmGateway.executeLLMOperation).not.toHaveBeenCalled()
    await db.monitorLlmAttempt.create({ data: { operation_key: 'triage:switch', attempt_no: 1, stage: 'FUNDING_SOURCE_TRIAGE', model: 'gemini-x', reserved_max_micros: 10n, ledger_day: new Date(), status: 'BATCH_QUEUED', batch_request: {} } })
    const create = vi.fn(async () => 'batches/1')
    const client: BatchClient = { create, async get() { return { state: 'RUNNING', answers: [], error: null } }, async cancel() {} }
    expect((await runPaidBatches(client)).submitted).toBe(0)
    expect(create).not.toHaveBeenCalled()
  })
})
