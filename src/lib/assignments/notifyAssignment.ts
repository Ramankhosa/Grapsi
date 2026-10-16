import { assignmentNotificationTemplate } from '@/lib/email-templates'
import { sendEmail } from '@/lib/mailer'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import { formatDeadlineDate } from '@/lib/i18n/format'
import { getTenantLocale } from '@/lib/tenant/locale'

/**
 * Telling someone they have been given a call.
 *
 * In-app is the primary channel — the product has no other inbox — and email is
 * a best-effort courtesy on top. Neither may fail the write that caused it, so
 * both swallow their errors here rather than at each call site.
 */
export async function notifyNewAssignment(input: {
  tenantId: string
  record: any
  assigner: { id: string; name?: string | null; email?: string | null }
  /** Prefixed to the in-app body when the call is being passed on. */
  lead?: string
}) {
  const { tenantId, record, assigner, lead } = input
  const callTitle =
    record.funding_call?.scheme_title || record.funding_call?.title || 'a funding call'

  const locale = await getTenantLocale(tenantId)
  const deadlineLine = record.deadline_at
    ? `Due ${formatDeadlineDate(record.deadline_at, { timeZone: locale.timezone, locale: locale.locale })}.`
    : null

  await notifyQuietly({
    tenantId,
    userIds: [record.assignee_user_id],
    title: `${lead ? 'Passed to you' : 'New assignment'}: ${callTitle}`,
    body:
      [lead, deadlineLine, record.message].filter(Boolean).join(' ') ||
      'You have been assigned a funding call.',
    category: 'ASSIGNMENT',
    linkUrl: '/assignments',
    assignmentId: record.id,
    createdByUserId: assigner.id,
  })

  const email = record.assignee?.email
  if (!email) return

  const deadline = formatDeadlineDate(record.deadline_at, { timeZone: locale.timezone, locale: locale.locale })

  try {
    await sendEmail({
      to: email,
      toName: record.assignee?.name || undefined,
      ...assignmentNotificationTemplate({
        email,
        name: record.assignee?.name,
        assignerName: assigner.name || assigner.email || 'An administrator',
        callTitle,
        agency: record.funding_call?.agencyName || null,
        deadline,
        message: record.message || null,
      }),
    })
  } catch (error) {
    console.warn(
      'Assignment email failed:',
      error instanceof Error ? error.message : String(error)
    )
  }
}
