/**
 * Scheduled follow-up reminders.
 *
 * A follow-up row with `remind_at` set is a nudge waiting to fire. The sweep
 * runs hourly and claims each row with a conditional update before sending, so
 * two overlapping cron runs cannot both deliver the same reminder — the same
 * claim-then-act shape the funding alert dispatcher uses for its unique key.
 */
import prisma from '@/lib/prisma'
import { sendEmail } from '@/lib/mailer'
import { assignmentReminderTemplate } from '@/lib/email-templates'
import { notifyQuietly } from '@/lib/notifications/notificationService'

/** Statuses where a nudge is pointless — the work is closed or refused. */
const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'DECLINED'])

export interface ReminderSweepResult {
  considered: number
  sentToFaculty: number
  sentToMember: number
  skippedClosed: number
  claimFailed: number
  emailFailed: number
}

function formatDate(value: Date | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export async function sweepDueReminders(
  options: { limit?: number; now?: Date } = {}
): Promise<ReminderSweepResult> {
  const { limit = 200, now = new Date() } = options
  const result: ReminderSweepResult = {
    considered: 0,
    sentToFaculty: 0,
    sentToMember: 0,
    skippedClosed: 0,
    claimFailed: 0,
    emailFailed: 0,
  }

  const due = await prisma.assignmentFollowUp.findMany({
    where: { remind_at: { not: null, lte: now }, reminder_sent_at: null },
    include: {
      created_by: { select: { id: true, name: true, email: true } },
      assignment: {
        select: {
          id: true,
          status: true,
          tenant_id: true,
          deadline_at: true,
          assignee_user_id: true,
          assignee: { select: { id: true, name: true, email: true } },
          funding_call: { select: { title: true, scheme_title: true } },
        },
      },
    },
    orderBy: { remind_at: 'asc' },
    take: limit,
  })

  result.considered = due.length

  for (const followUp of due) {
    // Claim first. If another run got there first the count is 0 and we move
    // on without sending — the stamp is the lock.
    const claim = await prisma.assignmentFollowUp.updateMany({
      where: { id: followUp.id, reminder_sent_at: null },
      data: { reminder_sent_at: new Date() },
    })
    if (claim.count !== 1) {
      result.claimFailed += 1
      continue
    }

    const assignment = followUp.assignment
    if (!assignment || CLOSED_STATUSES.has(assignment.status)) {
      // Already stamped above, so a reminder for work that closed in the
      // meantime quietly retires instead of nagging about a finished call.
      result.skippedClosed += 1
      continue
    }

    const callTitle =
      assignment.funding_call?.scheme_title || assignment.funding_call?.title || 'a funding call'
    const deadline = formatDate(assignment.deadline_at)

    if (followUp.remind_faculty) {
      await notifyQuietly({
        tenantId: assignment.tenant_id,
        userIds: [assignment.assignee_user_id],
        title: `Reminder: ${callTitle}`,
        body: followUp.note,
        category: 'DEADLINE',
        linkUrl: '/assignments',
        assignmentId: assignment.id,
        createdByUserId: followUp.created_by_user_id,
      })

      const email = assignment.assignee?.email
      if (email) {
        try {
          await sendEmail({
            to: email,
            toName: assignment.assignee?.name || undefined,
            ...assignmentReminderTemplate({
              email,
              name: assignment.assignee?.name,
              callTitle,
              deadline,
              note: followUp.note,
              fromName: followUp.created_by?.name || followUp.created_by?.email || null,
            }),
          })
        } catch (error) {
          result.emailFailed += 1
          console.warn('Funding department reminder email failed', error)
        }
      }
      result.sentToFaculty += 1
    } else {
      // A private tickler: the member asked to be reminded to chase, so the
      // faculty member hears nothing.
      await notifyQuietly({
        tenantId: assignment.tenant_id,
        userIds: [followUp.created_by_user_id],
        title: `Follow up on: ${callTitle}`,
        body: `${assignment.assignee?.name || assignment.assignee?.email || 'The assignee'} — ${followUp.note}`,
        category: 'DEADLINE',
        linkUrl: '/funding-dept/assignments',
        assignmentId: assignment.id,
      })
      result.sentToMember += 1
    }
  }

  return result
}
