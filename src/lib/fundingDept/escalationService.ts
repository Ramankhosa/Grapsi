/**
 * Automatic nudges on an assignment's internal deadline.
 *
 * A department member should not have to remember to chase. Hand-written
 * reminders (AssignmentFollowUp) stay for the judgement calls — "ring him after
 * the co-PI confirms" — while this ladder covers the mechanical part: the
 * deadline is approaching, or nobody has answered at all.
 *
 * Each stage fires exactly once per assignment. The lock IS the
 * `auto_nudge_stages` array: a stage is appended with a guarded UPDATE that
 * only matches when the stage is absent, so two overlapping hourly sweeps
 * cannot both send it. No separate claim table, no advisory locks.
 */
import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { sendEmail } from '@/lib/mailer'
import { assignmentReminderTemplate } from '@/lib/email-templates'
import { notifyQuietly } from '@/lib/notifications/notificationService'

/**
 * Deadline ladder, checked longest-first so a freshly created assignment that
 * is already inside several windows only fires the most urgent one. Sending
 * "30 days left" and "1 day left" in the same minute reads as a broken system.
 */
const DEADLINE_STAGES = [
  { stage: 'D30', days: 30, label: 'about a month' },
  { stage: 'D14', days: 14, label: 'two weeks' },
  { stage: 'D7', days: 7, label: 'a week' },
  { stage: 'D1', days: 1, label: 'tomorrow' },
] as const

/** How long an unanswered request may sit before the system chases it. */
const NO_RESPONSE_AFTER_DAYS = 7
const NO_RESPONSE_STAGE = 'NOACK'

/**
 * The opening words of every notification this ladder (and the milestone
 * sweep) writes. `auto_nudge_stages` records THAT a stage fired but not when,
 * and is wiped on re-request, so the Notification row is the only dated record
 * of a nudge. The call dossier's timeline picks nudges out of a person's inbox
 * by these prefixes — keep them in step with the `title:` literals below.
 */
export const NUDGE_TITLE_PREFIXES = [
  'Deadline ',
  'Still waiting on your reply:',
  `No reply after ${NO_RESPONSE_AFTER_DAYS} days:`,
  'INSTALMENT due ',
  'UC due ',
  'SE due ',
  'REPORT due ',
  'OTHER due ',
] as const

export function isNudgeTitle(title: string): boolean {
  return NUDGE_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))
}

const OPEN_STATUSES = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS']

export interface EscalationResult {
  considered: number
  deadlineNudges: number
  noResponseNudges: number
  /** Post-award obligations (instalments, UC, SE) chased this run. */
  milestoneNudges: number
  alreadySent: number
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

function daysUntil(deadline: Date, now: Date) {
  const a = new Date(deadline)
  a.setHours(0, 0, 0, 0)
  const b = new Date(now)
  b.setHours(0, 0, 0, 0)
  return Math.round((a.getTime() - b.getTime()) / 86_400_000)
}

/**
 * Appends a stage only if it is not already there. Returns true when this call
 * is the one that claimed it — i.e. the caller owns sending the nudge.
 */
/** The same claim-then-act lock, for a milestone's own stage array. */
async function claimMilestoneStage(milestoneId: string, stage: string) {
  const claimed = await prisma.$executeRaw(Prisma.sql`
    UPDATE assignment_milestones
       SET auto_nudge_stages = array_append(auto_nudge_stages, ${stage})
     WHERE id = ${milestoneId}
       AND NOT (${stage} = ANY(auto_nudge_stages))
  `)
  return claimed === 1
}

/**
 * Post-award obligations, chased by the same ladder as a submission deadline.
 *
 * A utilisation certificate that slips is the kind of thing an office finds out
 * about from the funder, so it gets the officer as well as the assignee — the
 * one difference from the pre-award nudges, where the officer only hears about
 * silence.
 */
async function sweepMilestones(now: Date, limit: number, result: EscalationResult) {
  const milestones = await prisma.assignmentMilestone.findMany({
    // Assignment-owned only. A proposal's own obligations are chased by the
    // proposal sweep, which knows to tell its PI and covering officer rather
    // than an assignee this row does not have.
    where: {
      assignment_id: { not: null },
      status: 'PENDING',
      due_at: { not: null },
      assignment: { outcome: 'AWARDED' },
    },
    select: {
      id: true,
      tenant_id: true,
      title: true,
      kind: true,
      due_at: true,
      auto_nudge_stages: true,
      assignment: {
        select: {
          id: true,
          assignee_user_id: true,
          assigned_by_user_id: true,
          assignee: { select: { name: true, email: true } },
          funding_call: { select: { title: true, scheme_title: true } },
        },
      },
    },
    orderBy: { due_at: 'asc' },
    take: limit,
  })

  for (const milestone of milestones) {
    if (!milestone.due_at || !milestone.assignment) continue
    const remaining = daysUntil(milestone.due_at, now)
    const due = DEADLINE_STAGES.filter((entry) => remaining <= entry.days).pop()
    if (!due || remaining < 0) continue
    if (milestone.auto_nudge_stages.includes(due.stage)) {
      result.alreadySent += 1
      continue
    }
    if (!(await claimMilestoneStage(milestone.id, due.stage))) continue

    const callTitle =
      milestone.assignment.funding_call?.scheme_title ||
      milestone.assignment.funding_call?.title ||
      'a funded project'
    const body =
      remaining === 0
        ? `${milestone.title} is due today.`
        : remaining === 1
          ? `${milestone.title} is due tomorrow.`
          : `${milestone.title} is due in ${remaining} days.`

    await notifyQuietly({
      tenantId: milestone.tenant_id,
      userIds: [milestone.assignment.assignee_user_id, milestone.assignment.assigned_by_user_id],
      title: `${milestone.kind} due ${due.label}: ${callTitle}`,
      body,
      category: 'DEADLINE',
      linkUrl: '/assignments',
      assignmentId: milestone.assignment.id,
    })

    if (milestone.assignment.assignee?.email) {
      try {
        await sendEmail({
          to: milestone.assignment.assignee.email,
          toName: milestone.assignment.assignee.name || undefined,
          ...assignmentReminderTemplate({
            email: milestone.assignment.assignee.email,
            name: milestone.assignment.assignee.name,
            callTitle,
            deadline: formatDate(milestone.due_at),
            note: body,
            fromName: null,
          }),
        })
      } catch (error) {
        result.emailFailed += 1
        console.warn('Milestone escalation email failed', error)
      }
    }
    result.milestoneNudges += 1
  }
}

async function claimStage(assignmentId: string, stage: string) {
  const claimed = await prisma.$executeRaw(Prisma.sql`
    UPDATE call_assignments
       SET auto_nudge_stages = array_append(auto_nudge_stages, ${stage})
     WHERE id = ${assignmentId}
       AND NOT (${stage} = ANY(auto_nudge_stages))
  `)
  return claimed === 1
}

export async function sweepDeadlineEscalations(
  options: { limit?: number; now?: Date } = {}
): Promise<EscalationResult> {
  const { limit = 500, now = new Date() } = options
  const result: EscalationResult = {
    considered: 0,
    deadlineNudges: 0,
    noResponseNudges: 0,
    milestoneNudges: 0,
    alreadySent: 0,
    emailFailed: 0,
  }

  const candidates = await prisma.callAssignment.findMany({
    where: {
      status: { in: OPEN_STATUSES as any },
      OR: [
        // Deadline in play (past deadlines are the dashboard's "missed"
        // bucket, not something to keep emailing about).
        { deadline_at: { not: null, gte: new Date(now.getTime() - 86_400_000) } },
        // Or never answered, whatever the deadline.
        { status: 'ASSIGNED', responded_at: null },
      ],
    },
    select: {
      id: true,
      tenant_id: true,
      status: true,
      deadline_at: true,
      created_at: true,
      responded_at: true,
      auto_nudge_stages: true,
      assignee_user_id: true,
      assigned_by_user_id: true,
      assignee: { select: { name: true, email: true } },
      funding_call: { select: { title: true, scheme_title: true } },
    },
    orderBy: { deadline_at: 'asc' },
    take: limit,
  })

  result.considered = candidates.length

  for (const assignment of candidates) {
    const callTitle =
      assignment.funding_call?.scheme_title || assignment.funding_call?.title || 'a funding call'
    const deadline = formatDate(assignment.deadline_at)
    const sent = new Set(assignment.auto_nudge_stages)

    // --- Deadline ladder ----------------------------------------------------
    if (assignment.deadline_at) {
      const remaining = daysUntil(assignment.deadline_at, now)
      // Most urgent window this assignment currently sits inside.
      const due = DEADLINE_STAGES.filter((entry) => remaining <= entry.days).pop()
      if (due && remaining >= 0) {
        if (sent.has(due.stage)) {
          result.alreadySent += 1
        } else if (await claimStage(assignment.id, due.stage)) {
          const note =
            remaining === 0
              ? `The internal deadline for this call is today.`
              : remaining === 1
                ? `The internal deadline for this call is tomorrow.`
                : `The internal deadline for this call is in ${remaining} days.`

          await notifyQuietly({
            tenantId: assignment.tenant_id,
            userIds: [assignment.assignee_user_id],
            title: `Deadline ${due.label}: ${callTitle}`,
            body: note,
            category: 'DEADLINE',
            linkUrl: '/assignments',
            assignmentId: assignment.id,
          })

          if (assignment.assignee?.email) {
            try {
              await sendEmail({
                to: assignment.assignee.email,
                toName: assignment.assignee.name || undefined,
                ...assignmentReminderTemplate({
                  email: assignment.assignee.email,
                  name: assignment.assignee.name,
                  callTitle,
                  deadline,
                  note,
                  fromName: null,
                }),
              })
            } catch (error) {
              result.emailFailed += 1
              console.warn('Deadline escalation email failed', error)
            }
          }
          result.deadlineNudges += 1
        }
      }
    }

    // --- Never answered -----------------------------------------------------
    const unanswered =
      assignment.status === 'ASSIGNED' &&
      !assignment.responded_at &&
      now.getTime() - new Date(assignment.created_at).getTime() >=
        NO_RESPONSE_AFTER_DAYS * 86_400_000

    if (unanswered) {
      if (sent.has(NO_RESPONSE_STAGE)) {
        result.alreadySent += 1
      } else if (await claimStage(assignment.id, NO_RESPONSE_STAGE)) {
        const who = assignment.assignee?.name || assignment.assignee?.email || 'The faculty member'

        await notifyQuietly({
          tenantId: assignment.tenant_id,
          userIds: [assignment.assignee_user_id],
          title: `Still waiting on your reply: ${callTitle}`,
          body: 'The funding department needs to know whether you will take this on.',
          category: 'DEADLINE',
          linkUrl: '/assignments',
          assignmentId: assignment.id,
        })

        // The department hears about it too — an unanswered request is their
        // problem to solve, and a silent one is the kind that gets discovered
        // the week the call closes.
        await notifyQuietly({
          tenantId: assignment.tenant_id,
          userIds: [assignment.assigned_by_user_id],
          title: `No reply after ${NO_RESPONSE_AFTER_DAYS} days: ${callTitle}`,
          body: `${who} has not accepted or declined. Worth a call.`,
          category: 'DEADLINE',
          linkUrl: '/funding-dept/assignments',
          assignmentId: assignment.id,
        })

        if (assignment.assignee?.email) {
          try {
            await sendEmail({
              to: assignment.assignee.email,
              toName: assignment.assignee.name || undefined,
              ...assignmentReminderTemplate({
                email: assignment.assignee.email,
                name: assignment.assignee.name,
                callTitle,
                deadline,
                note: 'Could you let the funding department know whether you will take this on? Accepting or declining takes one click.',
                fromName: null,
              }),
            })
          } catch (error) {
            result.emailFailed += 1
            console.warn('No-response escalation email failed', error)
          }
        }
        result.noResponseNudges += 1
      }
    }
  }

  await sweepMilestones(now, limit, result)

  return result
}
