import { sendEmail } from '@/lib/mailer'
import { prisma } from '@/lib/prisma'

import type { TriageResult } from './triage'

const BASE_URL =
  process.env.SITE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Who hears about a find: the source's owner, plus the funding operators who
 * run the catalog. Platform-curated sources have no tenant, so recipients are
 * resolved from people rather than from tenancy.
 */
async function recipients(ownerUserId: string | null): Promise<
  { id: string; email: string; name: string | null; tenantId: string | null }[]
> {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        ...(ownerUserId ? [{ id: ownerUserId }] : []),
        { roles: { hasSome: ['SUPER_ADMIN'] } },
      ],
    },
    select: { id: true, email: true, name: true, tenantId: true },
    take: 25,
  })
  return users
}

export async function sendChangeAlert(input: {
  sourceId: string
  sourceName: string
  sourceUrl: string
  ownerUserId: string | null
  changeId: string
  triage: TriageResult | null
}): Promise<void> {
  const queueLink = `${BASE_URL}/funding/monitor?change=${input.changeId}`
  const isOpportunity = input.triage?.verdict === 'NEW_OPPORTUNITY'
  const subject = isOpportunity
    ? `New funding opportunity detected on ${input.sourceName}`
    : `Change detected on ${input.sourceName}`

  const opportunityList = (input.triage?.opportunities ?? [])
    .map(
      (o) =>
        `<li><strong>${escapeHtml(o.title)}</strong>${
          o.deadline ? ` — deadline ${escapeHtml(o.deadline)}` : ''
        }${o.link ? `<br><a href="${escapeHtml(o.link)}">${escapeHtml(o.link)}</a>` : ''}</li>`
    )
    .join('')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
      <h2 style="color:#1f2937;margin-bottom:8px;">${escapeHtml(subject)}</h2>
      <p style="color:#6b7280;margin:0 0 12px;">
        Source: <a href="${escapeHtml(input.sourceUrl)}">${escapeHtml(input.sourceName)}</a>
      </p>
      ${input.triage?.summary ? `<p style="color:#374151;">${escapeHtml(input.triage.summary)}</p>` : ''}
      ${opportunityList ? `<ul style="color:#374151;">${opportunityList}</ul>` : ''}
      <p style="margin-top:20px;">
        <a href="${queueLink}" style="display:inline-block;background:#0e7c5b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Review it</a>
      </p>
    </div>`

  const text = [
    `Source: ${input.sourceName}`,
    `Page: ${input.sourceUrl}`,
    input.triage?.summary ? `\nWhat changed: ${input.triage.summary}` : '',
    `\nReview it: ${queueLink}`,
  ]
    .filter(Boolean)
    .join('\n')

  const people = await recipients(input.ownerUserId)
  if (people.length === 0) {
    console.log(`[monitor] no recipients for alert: ${subject}`)
    return
  }

  for (const person of people) {
    try {
      await sendEmail({ to: person.email, toName: person.name ?? undefined, subject, html, text })
    } catch (error) {
      console.error(
        `[monitor] alert email to ${person.email} failed:`,
        error instanceof Error ? error.message : error
      )
    }

    // In-app notification too, but only for users who belong to a tenant —
    // Notification is tenant-scoped and a platform account has no tenant row.
    if (!person.tenantId) continue
    try {
      await prisma.notification.create({
        data: {
          tenant_id: person.tenantId,
          user_id: person.id,
          title: subject,
          body: input.triage?.summary ?? `${input.sourceName} changed — review the find.`,
          category: 'FUNDING_MONITOR',
          link_url: `/funding/monitor?change=${input.changeId}`,
        },
      })
    } catch (error) {
      console.error(
        '[monitor] in-app notification failed:',
        error instanceof Error ? error.message : error
      )
    }
  }
}
