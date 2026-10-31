import { sendEmail } from '@/lib/mailer'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import { prisma } from '@/lib/prisma'

import type { Db } from './queue'
import { startOfIstDay } from './schedule'

/**
 * Source Watch's notification outbox.
 *
 * An event is written (idempotently, by `event_key`) in the same transaction
 * as whatever caused it. Dispatch fans it out to recipients × channels, one
 * delivery row each. A delivery is marked SENDING before it is sent and is
 * never retried from SENDING: delivery is at-most-once by choice — a crash
 * mid-send can drop that one message, but can never send it twice. Discoveries
 * are aggregated once per completed IST day; health events remain immediate.
 * The review queue retains every discovery. A recipient who has
 * turned a channel off in their notification preferences gets SKIPPED there.
 */

export type MonitorEventKind = 'WORKER_OFFLINE' | 'SITE_PAUSED' | 'PROVIDER_OPEN' | 'NEW_DISCOVERY' | 'NEW_DISCOVERY_DIGEST'

export async function emitEvent(
  db: Db,
  input: { kind: MonitorEventKind; eventKey: string; payload: Record<string, unknown> }
): Promise<void> {
  await db.monitorEvent.createMany({
    data: [{ kind: input.kind, event_key: input.eventKey, payload: input.payload as object }],
    skipDuplicates: true,
  })
}

const SITE_URL = (process.env.SITE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000').split(/[\s,]+/)[0]

function render(kind: string, payload: Record<string, unknown>): { subject: string; body: string; link: string } {
  const link = '/funding/monitor?tab=health'
  switch (kind) {
    case 'NEW_DISCOVERY_DIGEST':
      return { subject: `${payload.count} funding discoveries to review`, body: `${payload.count} announcements were found on ${payload.day} (India time). Review the evidence and drafts in Source Watch.`, link: '/funding/monitor?tab=discoveries' }
    case 'NEW_DISCOVERY':
      return { subject: 'New funding discovery for review', body: String(payload.title ?? 'A funding announcement is ready for review'), link: '/funding/monitor?tab=discoveries' }
    case 'WORKER_OFFLINE':
      return {
        subject: 'Source Watch worker is offline',
        body: `No crawler heartbeat for ${payload.ageMinutes ?? 'many'} minutes. Funder sites are not being checked until the worker is restarted.`,
        link,
      }
    case 'SITE_PAUSED':
      return {
        subject: `Source Watch paused ${payload.host ?? 'a site'}`,
        body: `${payload.host ?? 'A site'} failed ${payload.failures ?? 'several'} checks in a row and was paused. Last error: ${payload.lastError ?? 'unknown'}.`,
        link: '/funding/monitor?tab=evidence',
      }
    case 'PROVIDER_OPEN':
      return {
        subject: 'Source Watch paused paid AI work',
        body: `${payload.provider ?? 'The AI provider'} reported ${payload.reason ?? 'an account problem'}. Paid triage is paused; nothing is lost.`,
        link,
      }
    default:
      return { subject: 'Source Watch notice', body: JSON.stringify(payload).slice(0, 300), link }
  }
}

/** Platform people who run Source Watch: super admins and funding operations/publishers. */
async function alertRecipients(): Promise<Array<{ id: string; email: string; name: string | null; tenantId: string | null }>> {
  const assignments = await prisma.platformTeamRoleAssignment.findMany({
    where: { isActive: true, roleCode: { in: ['FUNDING_OPERATIONS_MANAGER', 'FUNDING_PUBLISHER'] } },
    select: { userId: true },
    take: 50,
  })
  return prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ roles: { hasSome: ['SUPER_ADMIN'] } }, { id: { in: assignments.map((a) => a.userId) } }],
    },
    select: { id: true, email: true, name: true, tenantId: true },
    take: 25,
  })
}

export async function dispatchPendingEvents(limit = 25): Promise<{ events: number; sent: number; failed: number }> {
  if (process.env.MONITOR_NOTIFICATIONS_ENABLED !== 'true') return { events: 0, sent: 0, failed: 0 }
  await aggregateDiscoveryDigest()
  const events = await prisma.monitorEvent.findMany({
    where: { dispatched_at: null, kind: { not: 'NEW_DISCOVERY' } },
    orderBy: { created_at: 'asc' },
    take: limit,
  })
  if (events.length === 0) return { events: 0, sent: 0, failed: 0 }

  const people = await alertRecipients()
  const preferences = await prisma.researcherNotificationPreference.findMany({
    where: { user_id: { in: people.map((p) => p.id) } },
    select: { user_id: true, email_enabled: true, in_app_enabled: true },
  })
  const prefByUser = new Map(preferences.map((p) => [p.user_id, p]))
  const channelAllowed = (userId: string, channel: string) => {
    const pref = prefByUser.get(userId)
    if (!pref) return true
    return channel === 'EMAIL' ? pref.email_enabled : pref.in_app_enabled
  }
  let sent = 0
  let failed = 0

  for (const event of events) {
    await prisma.monitorNotificationDelivery.createMany({
      data: people.flatMap((person) => [
        { event_id: event.id, recipient_user_id: person.id, channel: 'EMAIL' },
        ...(person.tenantId ? [{ event_id: event.id, recipient_user_id: person.id, channel: 'IN_APP' }] : []),
      ]),
      skipDuplicates: true,
    })
    const message = render(event.kind, (event.payload ?? {}) as Record<string, unknown>)
    const deliveries = await prisma.monitorNotificationDelivery.findMany({ where: { event_id: event.id, state: 'PENDING' } })

    for (const delivery of deliveries) {
      if (!channelAllowed(delivery.recipient_user_id, delivery.channel)) {
        await prisma.monitorNotificationDelivery.updateMany({
          where: { id: delivery.id, state: 'PENDING' },
          data: { state: 'SKIPPED', error: 'channel turned off in notification preferences' },
        })
        continue
      }
      // Claim the delivery; whoever flips PENDING → SENDING owns the send.
      const claimed = await prisma.monitorNotificationDelivery.updateMany({
        where: { id: delivery.id, state: 'PENDING' },
        data: { state: 'SENDING' },
      })
      if (claimed.count !== 1) continue
      const person = people.find((p) => p.id === delivery.recipient_user_id)
      try {
        if (!person) throw new Error('recipient no longer eligible')
        if (delivery.channel === 'EMAIL') {
          await sendEmail({
            to: person.email,
            toName: person.name ?? undefined,
            subject: message.subject,
            text: `${message.body}\n\n${SITE_URL}${message.link}`,
            html: `<p>${message.body.replace(/</g, '&lt;')}</p><p><a href="${SITE_URL}${message.link}">Open Source Watch</a></p>`,
          })
        } else if (person.tenantId) {
          await notifyQuietly({
            tenantId: person.tenantId,
            userIds: [person.id],
            title: message.subject,
            body: message.body,
            category: 'FUNDING_MONITOR',
            linkUrl: message.link,
          })
        }
        await prisma.monitorNotificationDelivery.update({ where: { id: delivery.id }, data: { state: 'SENT', sent_at: new Date() } })
        sent += 1
      } catch (error) {
        await prisma.monitorNotificationDelivery.update({
          where: { id: delivery.id },
          data: { state: 'FAILED', error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
        })
        failed += 1
      }
    }
    await prisma.monitorEvent.update({ where: { id: event.id }, data: { dispatched_at: new Date() } })
  }
  return { events: events.length, sent, failed }
}

/** Collapse a completed IST day's finds in one transaction, including after downtime. */
export async function aggregateDiscoveryDigest(now = new Date()): Promise<void> {
  const cutoff = startOfIstDay(now)
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('monitor-discovery-digest'))`
    const first = await tx.monitorEvent.findFirst({ where: { kind: 'NEW_DISCOVERY', dispatched_at: null, created_at: { lt: cutoff } }, orderBy: { created_at: 'asc' } })
    if (!first) return
    const from = startOfIstDay(first.created_at)
    const until = cutoff
    const where = { kind: 'NEW_DISCOVERY', dispatched_at: null, created_at: { gte: from, lt: until } }
    const count = await tx.monitorEvent.count({ where })
    const firstDay = new Date(from.getTime() + 19800000).toISOString().slice(0, 10)
    const lastDay = new Date(until.getTime() - 1 + 19800000).toISOString().slice(0, 10)
    const day = firstDay === lastDay ? firstDay : `${firstDay} to ${lastDay}`
    await emitEvent(tx, { kind: 'NEW_DISCOVERY_DIGEST', eventKey: `discovery-digest:${lastDay}`, payload: { day, count } })
    await tx.monitorEvent.updateMany({ where, data: { dispatched_at: now } })
  })
}
