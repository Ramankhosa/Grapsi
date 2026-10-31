import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => { const { testPrisma } = await import('../helpers/monitorTestPrisma'); return { prisma: testPrisma, default: testPrisma } })
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
vi.mock('@/lib/metering/model-resolver', () => ({ resolveModel: vi.fn(async () => ({ source: 'stage', modelCode: 'gemini-batch-fixture', fallbacks: [{ modelCode: 'glm-batch-fixture' }], maxTokensOut: 250 })) }))
vi.mock('@/lib/monitor/actor', () => ({ resolveMonitorActor: vi.fn(async () => ({ userId: 'fixture', tenantId: 'fixture', planId: 'fixture', tenantContext: { userId: 'fixture', tenantId: 'fixture', planId: 'fixture' } })), MonitorConfigError: class extends Error {} }))
import { llmGateway } from '@/lib/metering/gateway'
import { tokenMicros } from '@/lib/monitor/budget'
import { BatchPendingError, runPaidStage } from '@/lib/monitor/paidCall'
import { runPaidBatches, type BatchClient, type BatchJobView } from '@/lib/monitor/paidBatch'
import { enqueueTask, PRIORITY } from '@/lib/monitor/queue'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/** Provider batch mode (29 Oct 2026): screening requests wait for a half-price Gemini batch. */

const models = ['gemini-batch-fixture', 'glm-batch-fixture']
beforeAll(async () => { for (const code of models) await db.lLMModel.upsert({ where: { code }, create: { code, displayName: 'Batch fixture', provider: 'fixture', inputCostPer1M: 10, outputCostPer1M: 20 }, update: {} }) })
beforeEach(async () => { await resetMonitorTables(); await db.monitorPaidBatch.deleteMany(); vi.mocked(llmGateway.executeLLMOperation).mockReset(); vi.stubEnv('MONITOR_PAID_WORK_ENABLED', 'true'); vi.stubEnv('MONITOR_PAID_BATCH', 'true') })
afterEach(() => { vi.unstubAllEnvs() })
afterAll(async () => { await resetMonitorTables(); await db.monitorPaidBatch.deleteMany(); await db.lLMModel.deleteMany({ where: { code: { in: models } } }); await db.$disconnect() })

const members = [{ id: 'page-1', cacheKey: 'cache-page-1', completeness: 'available-text' }, { id: 'page-2', cacheKey: 'cache-page-2', completeness: 'PARTIAL' }]
const input = (key: string) => ({ stage: 'FUNDING_SOURCE_TRIAGE', operationKey: key, systemPrompt: 'Classify', prompt: 'Two pages', jsonSchema: { name: 'triage', schema: { type: 'object' } }, maxOutputTokens: 400, scopes: ['PLATFORM'], memberKeys: members.map(m => m.cacheKey), batchMembers: members })
const answer = JSON.stringify({ items: [
  { id: 'page-1', verdict: 'NEW_OPPORTUNITY', confidence: 0.95, reason: 'Open call', type: 'grant' },
  { id: 'page-2', verdict: 'NOT_FUNDING', confidence: 0.9, reason: 'News', type: 'news' },
] })
function fakeClient(views: BatchJobView[]) {
  const created: Array<{ model: string; count: number }> = []
  const client: BatchClient = {
    async create(model, requests) { created.push({ model, count: requests.length }); return `batches/${created.length}` },
    async get() { return views.shift() ?? { state: 'RUNNING', answers: [], error: null } },
    async cancel() {},
  }
  return { client, created }
}

describe('paid batch mode', () => {
  it('queues at half price, submits, files each page and answers the request without a second call', async () => {
    await expect(runPaidStage(input('batch-a'))).rejects.toBeInstanceOf(BatchPendingError)
    await expect(runPaidStage(input('batch-a'))).rejects.toBeInstanceOf(BatchPendingError)
    expect(llmGateway.executeLLMOperation).not.toHaveBeenCalled()
    const queued = await db.monitorLlmAttempt.findMany()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ status: 'BATCH_QUEUED', model: 'gemini-batch-fixture' })
    expect(queued[0].price_snapshot).toMatchObject({ batch: true, inputCentsPer1M: 5, outputCentsPer1M: 10 })

    // A task waiting on the answer is woken when it is filed.
    const { id: taskId } = await enqueueTask(db, { kind: 'TRIAGE', operationKey: 'triage:batch-a', payload: { resourceIds: ['page-1'] } })
    const task = { id: taskId! }
    await db.monitorTask.update({ where: { id: task.id }, data: { available_at: new Date(Date.now() + 6 * 3_600_000) } })
    await db.monitorLlmAttempt.update({ where: { id: queued[0].id }, data: { task_id: task.id } })

    const { client, created } = fakeClient([
      { state: 'RUNNING', answers: [], error: null },
      { state: 'SUCCEEDED', answers: [{ text: answer, usage: { inputTokens: 1000, outputTokens: 100 }, error: null }], error: null },
    ])
    expect(await runPaidBatches(client)).toMatchObject({ submitted: 1, jobs: 1, answered: 0 })
    expect(created).toEqual([{ model: 'gemini-batch-fixture', count: 1 }])
    expect((await db.monitorLlmAttempt.findFirstOrThrow()).status).toBe('BATCH_SUBMITTED')
    expect(await runPaidBatches(client)).toMatchObject({ answered: 0 })          // still running
    expect(await runPaidBatches(client)).toMatchObject({ answered: 1, filed: 2 })

    const settled = await db.monitorLlmAttempt.findFirstOrThrow()
    expect(settled.status).toBe('SUCCEEDED')
    expect(settled.actual_cost_micros).toBe(tokenMicros(1000, 5) + tokenMicros(100, 10))
    const cache = await db.monitorStageCache.findMany({ where: { stage: 'TRIAGE' }, orderBy: { cache_key: 'asc' } })
    expect(cache.map(c => (c.result as { verdict: string }).verdict)).toEqual(['NEW_OPPORTUNITY', 'NEEDS_EVIDENCE'])  // partial evidence cannot settle "not funding"
    const woken = await db.monitorTask.findUniqueOrThrow({ where: { id: task.id } })
    expect(woken.available_at.getTime()).toBeLessThanOrEqual(Date.now())
    expect(woken.priority).toBe(PRIORITY.CHECK_NOW)  // the paid-for answer is not left behind the queue

    const result = await runPaidStage(input('batch-a'))
    expect(result.text).toBe(answer)
    expect(llmGateway.executeLLMOperation).not.toHaveBeenCalled()
    expect(await db.monitorPaidBatch.findFirstOrThrow()).toMatchObject({ state: 'DONE' })
  })

  it('releases a failed batch unbilled and then sends the request normally', async () => {
    await expect(runPaidStage(input('batch-b'))).rejects.toBeInstanceOf(BatchPendingError)
    const { client } = fakeClient([{ state: 'FAILED', answers: [], error: 'JOB_STATE_EXPIRED' }])
    await runPaidBatches(client)
    expect(await runPaidBatches(client)).toMatchObject({ failed: 1 })
    expect(await db.monitorLlmAttempt.findFirstOrThrow()).toMatchObject({ status: 'FAILED_UNBILLED', actual_cost_micros: 0n })
    const ledger = await db.monitorBudgetLedger.findFirstOrThrow({ where: { scope: 'PLATFORM' } })
    expect(ledger.reserved_micros).toBe(0n)

    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ success: true, response: { output: answer, outputTokens: 50, modelClass: 'fixture', metadata: { inputTokens: 900, outputTokens: 50, thoughtTokens: 0 } } } as never)
    expect((await runPaidStage(input('batch-b'))).text).toBe(answer)
    expect(llmGateway.executeLLMOperation).toHaveBeenCalledTimes(1)
  })

  it('submits once when two runs overlap', async () => {
    await expect(runPaidStage(input('batch-d'))).rejects.toBeInstanceOf(BatchPendingError)
    const { client, created } = fakeClient([])
    const slow: BatchClient = { ...client, async create(model, requests, label) { await new Promise(r => setTimeout(r, 300)); return client.create(model, requests, label) } }
    const runs = await Promise.all([runPaidBatches(slow), runPaidBatches(slow)])
    expect(runs.filter(r => r.skipped)).toHaveLength(1)
    expect(created).toHaveLength(1)
    expect(await db.monitorPaidBatch.count()).toBe(1)
  })

  it('is off unless MONITOR_PAID_BATCH is true', async () => {
    vi.stubEnv('MONITOR_PAID_BATCH', 'false')
    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ success: true, response: { output: answer, outputTokens: 50, modelClass: 'fixture', metadata: { inputTokens: 900, outputTokens: 50, thoughtTokens: 0 } } } as never)
    expect((await runPaidStage(input('batch-c'))).text).toBe(answer)
    expect((await db.monitorLlmAttempt.findFirstOrThrow()).status).toBe('SUCCEEDED')
  })
})
