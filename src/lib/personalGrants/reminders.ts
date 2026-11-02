import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

export function personalGrantReminderMessage(data: { callTitle: string; callId: string; title: string; eventAt: Date; timezone: string }) {
  const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: data.timezone }).format(data.eventAt)
  const link = new URL(`/finder/calls/${encodeURIComponent(data.callId)}`, SITE_URL).toString()
  return {
    subject: `Grant reminder: ${data.title.replace(/[\r\n]/g, ' ')}`,
    text: `Your personal reminder\n\n${data.title}\nGrant: ${data.callTitle}\nCalendar entry: ${date} (${data.timezone})\n\nView your grant and notes: ${link}\nManage reminders: ${new URL('/funding/my-grants?view=calendar', SITE_URL)}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f172a"><p style="color:#2563eb">YOUR GRANT REMINDER</p><h1>${escapeHtml(data.title)}</h1><p>${escapeHtml(data.callTitle)}</p><p>${escapeHtml(date)} (${escapeHtml(data.timezone)})</p><p><a href="${escapeHtml(link)}">View grant and personal notes</a></p><p style="font-size:12px;color:#64748b">You scheduled this personal reminder. Manage your entries in <a href="${escapeHtml(new URL('/funding/my-grants?view=calendar', SITE_URL).toString())}">My grants</a>.</p></div>`,
  }
}

/** Durable claims prevent overlapping sweeps from sending the same entry.
 * An abandoned claim is visible as FAILED, never blindly resent: the provider
 * may already have accepted it before the process stopped. Reschedule in UI.
 */
export async function sweepPersonalGrantReminders({ now = new Date(), limit = 100 }: { now?: Date; limit?: number } = {}) {
  const startedAt = Date.now()
  const result = { considered: 0, sent: 0, retrying: 0, failed: 0, claimedElsewhere: 0, recovered: 0 }
  const abandoned = await prisma.personalGrantEvent.updateMany({
    where: { reminder_state: 'SENDING', claimed_at: { lt: new Date(now.getTime() - 10 * 60000) } },
    data: { reminder_state: 'FAILED', claim_token: null, last_error: 'Delivery could not be confirmed. Please reschedule.', revision: { increment: 1 } },
  })
  result.recovered = abandoned.count
  const due = await prisma.personalGrantEvent.findMany({
    where: { reminder_state: 'PENDING', retry_at: { lte: now }, reminder_at: { lte: now } },
    orderBy: [{ retry_at: 'asc' }, { id: 'asc' }], take: Math.max(1, Math.min(limit, 500)),
    include: { personal_grant: { include: { user: { select: { email: true, name: true, status: true, tenantId: true, accessExpiresAt: true } }, tenant: { select: { status: true } }, funding_call: { select: { id: true, title: true, scheme_title: true } } } } },
  })
  result.considered = due.length
  for (const event of due) {
    // Stay within the route budget even if a provider is slow. Unclaimed rows
    // remain pending for the next minute's sweep.
    if (Date.now() - startedAt >= 45000) break
    const claimToken = randomUUID()
    const claim = await prisma.personalGrantEvent.updateMany({
      where: { id: event.id, revision: event.revision, reminder_state: 'PENDING', retry_at: { lte: now } },
      data: { reminder_state: 'SENDING', claimed_at: now, claim_token: claimToken, attempts: { increment: 1 }, revision: { increment: 1 } },
    })
    if (claim.count !== 1) { result.claimedElsewhere++; continue }
    const finish = (data: Parameters<typeof prisma.personalGrantEvent.updateMany>[0]['data']) => prisma.personalGrantEvent.updateMany({ where: { id: event.id, reminder_state: 'SENDING', claim_token: claimToken }, data: { ...data, claim_token: null, revision: { increment: 1 } } })
    try {
      const { user, tenant, funding_call: call, tenant_id: tenantId } = event.personal_grant
      const visible = user.status === 'ACTIVE' && tenant.status === 'ACTIVE' && user.tenantId === tenantId && (!user.accessExpiresAt || user.accessExpiresAt > now) && await prisma.fundingCall.findFirst({ where: { AND: [{ id: call.id }, visibleFundingCallWhere(tenantId, { includeCatalog: true })] }, select: { id: true } })
      if (!visible) {
        await finish({ reminder_state: 'FAILED', last_error: 'This account or grant is no longer available.' }); result.failed++; continue
      }
      const delivery = await sendEmail({ to: user.email, toName: user.name || undefined, ...personalGrantReminderMessage({ callTitle: call.scheme_title || call.title, callId: call.id, title: event.title, eventAt: event.event_at, timezone: event.timezone }) })
      if (!delivery.sent) {
        // No provider request was made. Retry safely and keep it visible.
        const terminal = event.attempts + 1 >= 5
        await finish({ reminder_state: terminal ? 'FAILED' : 'PENDING', retry_at: terminal ? null : new Date(now.getTime() + Math.min(120, 5 * 2 ** event.attempts) * 60000), last_error: 'Email delivery is not configured.' })
        if (terminal) result.failed++; else result.retrying++
        continue
      }
      await finish({ reminder_state: 'SENT', sent_at: new Date(), retry_at: null, last_error: null })
      result.sent++
    } catch {
      // A network error can mean acceptance with a lost response. Preserve
      // that uncertainty instead of creating duplicate emails automatically.
      await finish({ reminder_state: 'FAILED', retry_at: null, last_error: 'Delivery could not be confirmed. Please reschedule.' })
      result.failed++
    }
  }
  return result
}
