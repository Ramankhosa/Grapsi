import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => { const { testPrisma } = await import('../helpers/monitorTestPrisma'); return { prisma: testPrisma, default: testPrisma } })
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
vi.mock('@/lib/metering/model-resolver', () => ({ resolveModel: vi.fn(async () => ({ source: 'stage', modelCode: 'glm-monitor-fixture', fallbacks: [{ modelCode: 'gemini-monitor-fixture' }], maxTokensOut: 250 })) }))
vi.mock('@/lib/monitor/actor', () => ({ resolveMonitorActor: vi.fn(async () => ({ userId: 'fixture', tenantId: 'fixture', planId: 'fixture', tenantContext: { userId: 'fixture', tenantId: 'fixture', planId: 'fixture' } })), MonitorConfigError: class extends Error {} }))
import { llmGateway } from '@/lib/metering/gateway'
import { runPaidStage } from '@/lib/monitor/paidCall'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'
const models = ['glm-monitor-fixture', 'gemini-monitor-fixture']
beforeAll(async () => { vi.stubEnv('MONITOR_PAID_WORK_ENABLED', 'true'); for (const code of models) await db.lLMModel.upsert({ where: { code }, create: { code, displayName: 'Monitor fixture', provider: 'fixture', inputCostPer1M: 10, outputCostPer1M: 20 }, update: {} }) })
beforeEach(async () => { await resetMonitorTables(); vi.mocked(llmGateway.executeLLMOperation).mockReset() })
afterAll(async () => { vi.unstubAllEnvs(); await resetMonitorTables(); await db.lLMModel.deleteMany({ where: { code: { in: models } } }); await db.$disconnect() })
const input = (key: string) => ({ stage: 'FUNDING_SOURCE_TRIAGE', operationKey: key, systemPrompt: 'Return JSON', prompt: 'Funding call', jsonSchema: { name: 'fixture', schema: { type: 'object' } }, maxOutputTokens: 250, scopes: ['PLATFORM'] })
const success = { success: true, response: { output: '{"ok":true}', outputTokens: 8, modelClass: 'fixture', metadata: { inputTokens: 12, outputTokens: 8, thoughtTokens: 0 } } }
describe('paid provider attempt accounting', () => {
  it('accepts a single valid fenced JSON response without adding a provider attempt', async () => {
    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ ...success, response: { ...success.response, output: '```json\n{"ok":true}\n```' } })
    expect((await runPaidStage(input('fenced'))).text).toBe('{"ok":true}')
    expect(await db.monitorLlmAttempt.count()).toBe(1)
    expect((await db.monitorLlmAttempt.findFirstOrThrow()).status).toBe('SUCCEEDED')
  })
  it('preserves prose around JSON for the stage validator to reject', async () => {
    const output = 'Untrusted commentary\n```json\n{"ok":true}\n```'
    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ ...success, response: { ...success.response, output } })
    expect((await runPaidStage(input('prose'))).text).toBe(output)
  })
  it('opens a billing breaker and uses the independent fallback as a second reservation', async () => {
    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ success: false, error: { message: 'Insufficient quota', details: { providerStatus: 402 } } } as any).mockResolvedValueOnce(success)
    expect((await runPaidStage(input('billing'))).model).toBe(models[1])
    const attempts = await db.monitorLlmAttempt.findMany({ orderBy: { attempt_no: 'asc' } })
    expect(attempts.map(a => a.status)).toEqual(['FAILED_UNBILLED', 'SUCCEEDED'])
    expect(await db.monitorProviderHealth.count({ where: { state: 'OPEN' } })).toBe(1)
    expect(await db.monitorEvent.count({ where: { kind: 'PROVIDER_OPEN' } })).toBe(1)
    const request = vi.mocked(llmGateway.executeLLMOperation).mock.calls[0][1]
    expect(request.metadata?.executionPolicy).toMatchObject({ maxProviderAttempts: 1, noDefaultRouting: true })
    expect(request.metadata?.disableModelFallbacks).toBe(true)
    const fallbackRequest = vi.mocked(llmGateway.executeLLMOperation).mock.calls[1][1]
    expect(fallbackRequest.prompt).toContain(JSON.stringify(input('billing').jsonSchema.schema))
    expect(fallbackRequest.prompt).toContain('without Markdown fences')
  })
  it('keeps usage for a billable empty response and records the successful fallback separately', async () => {
    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ success: false, error: { message: 'Empty billable response', details: { billableUsage: { inputTokens: 12, outputTokens: 2 } } } } as any).mockResolvedValueOnce(success)
    await runPaidStage(input('empty'))
    const attempts = await db.monitorLlmAttempt.findMany({ orderBy: { attempt_no: 'asc' } })
    expect(attempts.map(a => a.status)).toEqual(['FAILED_BILLABLE', 'SUCCEEDED'])
    expect(attempts.every(a => a.actual_cost_micros! > 0n)).toBe(true)
    const ledger = await db.monitorBudgetLedger.findFirstOrThrow()
    expect(ledger.reserved_micros).toBe(0n)
    expect(ledger.settled_micros).toBe(attempts.reduce((n, a) => n + a.actual_cost_micros!, 0n))
  })
  it('does not release an ambiguous timeout reservation when a fallback succeeds', async () => {
    vi.mocked(llmGateway.executeLLMOperation).mockResolvedValueOnce({ success: false, error: { message: 'ETIMEDOUT', details: {} } } as any).mockResolvedValueOnce(success)
    await runPaidStage(input('timeout'))
    const attempts = await db.monitorLlmAttempt.findMany({ orderBy: { attempt_no: 'asc' } })
    expect(attempts.map(a => a.status)).toEqual(['UNCERTAIN', 'SUCCEEDED'])
    expect((await db.monitorBudgetLedger.findFirstOrThrow()).reserved_micros).toBe(attempts[0].reserved_max_micros)
  })
})
