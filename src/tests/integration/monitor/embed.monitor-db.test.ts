import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => { const { testPrisma } = await import('../helpers/monitorTestPrisma'); return { prisma: testPrisma, default: testPrisma } })
const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/lib/services/embeddingService', () => ({ areStoredEmbeddingJobsEnabled: async () => true, EmbeddingService: class { getHealth() { return { configured: true, provider: 'google', modelName: 'monitor-embedding-fixture' } } generateEmbedding(...args: unknown[]) { return mocks.generate(...args) } } }))
vi.mock('@/lib/services/fundingCatalogService', () => ({ fundingCallEmbeddingTarget: () => ({ modelName: 'monitor-embedding-fixture', outputDimensionality: 3, column: 'embedding', taskType: 'RETRIEVAL_DOCUMENT', version: 'fixture' }), fundingCallEmbeddingInput: () => ({ text: '', title: '' }) }))
vi.mock('@/lib/monitor/actor', () => ({ resolveMonitorActor: async () => ({ userId: 'fixture', tenantId: 'fixture' }), MonitorConfigError: class extends Error {} }))
import { embeddingForText } from '@/lib/monitor/embed'
import { enqueueTask, claimNextTask, type Lease } from '@/lib/monitor/queue'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'
let lease: Lease
beforeAll(async () => {
  vi.stubEnv('MONITOR_PAID_WORK_ENABLED', 'true')
  await db.lLMModel.upsert({ where: { code: 'monitor-embedding-fixture' }, create: { code: 'monitor-embedding-fixture', displayName: 'Fixture', provider: 'fixture', inputCostPer1M: 100, outputCostPer1M: 0 }, update: {} })
})
beforeEach(async () => { await resetMonitorTables(); mocks.generate.mockReset(); await enqueueTask(db, { kind: 'EMBED', operationKey: 'embedding-fixture', payload: {} }); lease = (await claimNextTask({ owner: 'fixture' }))! })
afterAll(async () => { vi.unstubAllEnvs(); await resetMonitorTables(); await db.lLMModel.delete({ where: { code: 'monitor-embedding-fixture' } }); await db.$disconnect() })
it('charges missing usage conservatively and reuses the vector without a second paid request', async () => {
  mocks.generate.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
  await embeddingForText('Research grant for universities', 'Alpha', lease, 'RETRIEVAL_DOCUMENT')
  await embeddingForText('Research grant for universities', 'Alpha', lease, 'RETRIEVAL_DOCUMENT')
  expect(mocks.generate).toHaveBeenCalledTimes(1)
  const attempt = await db.monitorLlmAttempt.findFirstOrThrow()
  expect(attempt.status).toBe('SUCCEEDED')
  expect(attempt.actual_cost_micros).toBe(attempt.reserved_max_micros)
  expect((await db.monitorBudgetLedger.findFirstOrThrow()).reserved_micros).toBe(0n)
})
it('keeps an opaque failed request reserved and never caches an invalid vector', async () => {
  mocks.generate.mockResolvedValue({ embedding: [], error: 'Connection reset after dispatch' })
  await expect(embeddingForText('New funding research grant', '', lease, 'RETRIEVAL_QUERY')).rejects.toThrow()
  expect((await db.monitorLlmAttempt.findFirstOrThrow()).status).toBe('UNCERTAIN')
  expect(await db.monitorStageCache.count()).toBe(0)
  expect((await db.monitorBudgetLedger.findFirstOrThrow()).reserved_micros).toBeGreaterThan(0n)
})
