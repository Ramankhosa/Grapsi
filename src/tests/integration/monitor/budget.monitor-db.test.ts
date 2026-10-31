import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})
import { BudgetExceededError, ledgerDay, markDispatched, markUncertain, recoverAttempts, reserveAttempt, settleAttempt } from '@/lib/monitor/budget'
import { claimNextTask, enqueueTask, LeaseLostError } from '@/lib/monitor/queue'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'
import { assertContentCapacity, assertResourceCapacity } from '@/lib/monitor/capacity'
const price = { modelCode: 'fixture', inputCentsPer1M: 10, outputCentsPer1M: 20 }
function input(key: string, scopes = ['PLATFORM']) { return { operationKey: key, attemptNo: 1, stage: 'TRIAGE', model: 'fixture', provider: 'fixture', price, scopes, reservedMaxMicros: 50_000n } }
beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })
describe('attempt-level budget contracts', () => {
  it('concurrent attempts cannot exceed a site allowance or leave partial platform reservations', async () => {
    const site = await db.monitorSite.create({ data: { host: 'budget.example', daily_budget_micros: 250_000n } })
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => reserveAttempt(input(`parallel-${i}`, ['PLATFORM', `SITE:${site.id}`]))))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5)
    expect(results.filter(r => r.status === 'rejected').every(r => r.status === 'rejected' && r.reason instanceof BudgetExceededError)).toBe(true)
    const ledgers = await db.monitorBudgetLedger.findMany()
    expect(ledgers.every(row => row.reserved_micros === 250_000n)).toBe(true)
  })
  it('settles exactly once against the reservation day, across IST midnight', async () => {
    const before = new Date('2026-10-24T18:29:00Z')
    const id = await reserveAttempt(input('midnight'), before)
    expect(ledgerDay(before).toISOString().slice(0, 10)).toBe('2026-10-24')
    expect(ledgerDay(new Date('2026-10-24T18:31:00Z')).toISOString().slice(0, 10)).toBe('2026-10-25')
    expect(await settleAttempt(id, { status: 'SUCCEEDED', actualMicros: 10_000n })).toBe(true)
    expect(await settleAttempt(id, { status: 'SUCCEEDED', actualMicros: 10_000n })).toBe(false)
    const ledger = await db.monitorBudgetLedger.findFirstOrThrow()
    expect(ledger.day.toISOString().slice(0, 10)).toBe('2026-10-24')
    expect([ledger.reserved_micros, ledger.settled_micros]).toEqual([0n, 10_000n])
  })
  it('retains uncertainty and books it at the maximum after 24 hours', async () => {
    const old = new Date(Date.now() - 25 * 3600_000)
    const id = await reserveAttempt(input('uncertain'), old)
    await markDispatched(id)
    await markUncertain(id, 'timeout after dispatch')
    await db.monitorLlmAttempt.update({ where: { id }, data: { created_at: old } })
    expect((await recoverAttempts()).booked).toBe(1)
    expect((await db.monitorLlmAttempt.findUniqueOrThrow({ where: { id } })).actual_cost_micros).toBe(50_000n)
  })
  it('cannot reserve or dispatch on an expired lease', async () => {
    await enqueueTask(db, { kind: 'TRIAGE', operationKey: 'lease-budget', payload: {} })
    const lease = await claimNextTask({ owner: 'fixture', leaseMs: 60_000 })
    const reservation = { ...input('lease-paid'), taskId: lease!.taskId, leaseGeneration: lease!.generation }
    const id = await reserveAttempt(reservation)
    await db.monitorTask.update({ where: { id: lease!.taskId }, data: { lease_until: new Date(0) } })
    await expect(markDispatched(id)).rejects.toBeInstanceOf(LeaseLostError)
    await expect(reserveAttempt({ ...reservation, attemptNo: 2 })).rejects.toBeInstanceOf(LeaseLostError)
    expect(await db.monitorLlmAttempt.count()).toBe(1)
  })
  it('does not permit an unmetered scope or double dispatch', async () => {
    await expect(reserveAttempt(input('empty', []))).rejects.toThrow('platform budget')
    const id = await reserveAttempt(input('once'))
    await markDispatched(id)
    await expect(markDispatched(id)).rejects.toThrow('once')
  })
  it('caps a member even if repeated requests regroup it into different batches', async () => {
    const reservation = { ...input('batch-one'), memberKeys: ['stable-member', 'other'], memberAttemptLimit: 2 }
    await reserveAttempt(reservation)
    await reserveAttempt({ ...reservation, operationKey: 'different-batch', memberKeys: ['stable-member'] })
    await expect(reserveAttempt({ ...reservation, operationKey: 'third-batch' })).rejects.toThrow('attempt')
    expect(await db.monitorLlmAttempt.count()).toBe(2)
  })
  it('defers new inventory and stored evidence at their limits while allowing existing resources', async () => {
    const site = await db.monitorSite.create({ data: { host: 'capacity.example' } })
    await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'existing' } })
    vi.stubEnv('MONITOR_SITE_RESOURCE_LIMIT', '1')
    try {
      await db.$transaction(tx => assertResourceCapacity(tx, site.id, ['existing']))
      await expect(db.$transaction(tx => assertResourceCapacity(tx, site.id, ['new']))).rejects.toThrow('inventory limit')
      await expect(db.$transaction(tx => assertContentCapacity(tx, site.id, 101, 100n))).rejects.toThrow('storage limit')
    } finally { vi.unstubAllEnvs() }
  })
})
