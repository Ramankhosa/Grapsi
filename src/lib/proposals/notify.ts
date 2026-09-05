/**
 * Getting proposal news to people who are not looking at the screen.
 *
 * In-app notices are always written; email is the tenant's choice and is always
 * best-effort. A failed send must never fail the thing that triggered it — the
 * review was still shared, the draft still arrived — so every path here logs
 * and continues.
 */
import { sendEmail } from '@/lib/mailer'
import prisma from '@/lib/prisma'

import { getProposalSettings } from './settings'

export interface Recipient {
  id: string
  email: string
  name: string | null
}

/** Look up addresses for a set of user ids, skipping anyone without one. */
export async function recipientsFor(userIds: string[]): Promise<Recipient[]> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (ids.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, status: 'ACTIVE' },
    select: { id: true, email: true, name: true },
  })
  return users.filter((user) => Boolean(user.email)) as Recipient[]
}

/**
 * Send one built template to each recipient, if this tenant has email on.
 *
 * Spaced slightly apart, like the assignment mail, so a bulk moment does not
 * arrive at the provider as a burst.
 */
export async function emailProposalRecipients(
  tenantId: string,
  recipients: Recipient[],
  build: (recipient: Recipient) => { subject: string; html: string; text: string }
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (recipients.length === 0) return { sent: 0, failed: 0, skipped: false }

  try {
    const settings = await getProposalSettings(tenantId)
    if (!settings.emailNotifications) return { sent: 0, failed: 0, skipped: true }
  } catch (error) {
    console.error('[proposals] could not read email policy; not sending', error)
    return { sent: 0, failed: 0, skipped: true }
  }

  let sent = 0
  let failed = 0

  for (const [index, recipient] of recipients.entries()) {
    try {
      const message = build(recipient)
      await sendEmail({
        to: recipient.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      })
      sent += 1
    } catch (error) {
      failed += 1
      console.error('[proposals] email failed for', recipient.email, error)
    }
    if (index < recipients.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  return { sent, failed, skipped: false }
}
