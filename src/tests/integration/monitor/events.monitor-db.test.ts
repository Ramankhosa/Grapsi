import { afterAll, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => { const { testPrisma } = await import('../helpers/monitorTestPrisma'); return { prisma: testPrisma, default: testPrisma } })
vi.mock('@/lib/mailer', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/notifications/notificationService', () => ({ notifyQuietly: vi.fn() }))
import { aggregateDiscoveryDigest, dispatchPendingEvents } from '@/lib/monitor/events'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'
beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => { vi.unstubAllEnvs(); await resetMonitorTables(); await db.$disconnect() })
it('collapses an IST day exactly once under competing dispatchers and keeps today pending', async () => {
  await db.monitorEvent.createMany({ data: [
    { kind: 'NEW_DISCOVERY', payload: {}, event_key: 'one', created_at: new Date('2026-10-23T18:29:00Z') },
    { kind: 'NEW_DISCOVERY', payload: {}, event_key: 'two', created_at: new Date('2026-10-22T19:00:00Z') },
    { kind: 'NEW_DISCOVERY', payload: {}, event_key: 'today', created_at: new Date('2026-10-23T18:31:00Z') },
  ] })
  await Promise.all([aggregateDiscoveryDigest(new Date('2026-10-24T08:00:00Z')), aggregateDiscoveryDigest(new Date('2026-10-24T08:00:00Z'))])
  const rows = await db.monitorEvent.findMany({ where: { kind: 'NEW_DISCOVERY_DIGEST' } })
  expect(rows).toHaveLength(1)
  expect(rows[0].payload).toEqual({ day: '2026-10-23', count: 2 })
  expect(await db.monitorEvent.count({ where: { kind: 'NEW_DISCOVERY', dispatched_at: null } })).toBe(1)
})
it('keeps the outbox untouched when notifications are disabled', async () => {
  vi.stubEnv('MONITOR_NOTIFICATIONS_ENABLED', 'false')
  await db.monitorEvent.create({ data: { kind: 'PROVIDER_OPEN', payload: {}, event_key: 'disabled' } })
  expect(await dispatchPendingEvents()).toEqual({ events: 0, sent: 0, failed: 0 })
  expect(await db.monitorNotificationDelivery.count()).toBe(0)
})

