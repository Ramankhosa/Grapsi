/**
 * Weekly pending-work digests for the funding department.
 *
 * Members get their own worklist; the head gets the department rollup. Both are
 * stamped on `last_digest_sent_at` and skipped if stamped within
 * MIN_DIGEST_GAP_DAYS, so a retried job, an overlapping schedule or a manual
 * run cannot double-send.
 */
import prisma from '@/lib/prisma'
import { SITE_URL, sendEmail } from '@/lib/mailer'
import {
  fundingDeptWeeklyHeadTemplate,
  fundingDeptWeeklyMemberTemplate,
} from '@/lib/email-templates'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import {
  getMissedAssignments,
  getSummary,
  getUnassignedUpcomingCalls,
  getUpcomingDeadlines,
} from '@/lib/assignments/dashboardService'

/** A weekly job that runs twice in one week must not mail twice. */
const MIN_DIGEST_GAP_DAYS = 5

export interface WeeklyDigestResult {
  tenants: number
  membersConsidered: number
  memberDigestsSent: number
  headDigestsSent: number
  skippedRecentlySent: number
  skippedNothingPending: number
  failed: number
}

function formatDate(value: Date | string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export async function sendWeeklyDigests(
  options: { now?: Date; tenantId?: string } = {}
): Promise<WeeklyDigestResult> {
  const { now = new Date() } = options
  const cutoff = new Date(now.getTime() - MIN_DIGEST_GAP_DAYS * 24 * 60 * 60 * 1000)

  const result: WeeklyDigestResult = {
    tenants: 0,
    membersConsidered: 0,
    memberDigestsSent: 0,
    headDigestsSent: 0,
    skippedRecentlySent: 0,
    skippedNothingPending: 0,
    failed: 0,
  }

  const members = await prisma.fundingDeptMember.findMany({
    where: {
      is_active: true,
      ...(options.tenantId ? { tenant_id: options.tenantId } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      school_assignments: { select: { org_unit_id: true } },
    },
    orderBy: [{ tenant_id: 'asc' }, { created_at: 'asc' }],
  })

  result.tenants = new Set(members.map((member) => member.tenant_id)).size
  result.membersConsidered = members.length

  // Head rows are collected per tenant as we go, so the rollup reuses the
  // per-member numbers rather than recomputing them differently.
  const headRowsByTenant = new Map<
    string,
    Array<{
      name: string
      schoolCount: number
      active: number
      submitted: number
      missed: number
      declined: number
      followUps: number
    }>
  >()

  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  for (const member of members) {
    const filters = { tenantId: member.tenant_id, assignedByUserIds: [member.user_id] }
    const schoolUnitIds = member.school_assignments.map((row) => row.org_unit_id)

    let summary
    let dueSoon: Awaited<ReturnType<typeof getUpcomingDeadlines>> = []
    let overdueReminders: Array<{ note: string; facultyName: string | null }> = []
    let openCalls: Array<{ title: string | null; closesAt: Date | null }> = []
    let followUpCount = 0

    try {
      const [summaryRow, upcoming, reminders, calls, followUps] = await Promise.all([
        getSummary(filters),
        getUpcomingDeadlines(filters, 30, 10),
        prisma.assignmentFollowUp.findMany({
          where: {
            tenant_id: member.tenant_id,
            created_by_user_id: member.user_id,
            reminder_sent_at: null,
            remind_at: { not: null, lte: now },
          },
          select: {
            note: true,
            assignment: { select: { assignee: { select: { name: true, email: true } } } },
          },
          orderBy: { remind_at: 'asc' },
          take: 10,
        }),
        schoolUnitIds.length > 0
          ? getUnassignedUpcomingCalls(member.tenant_id, {
              scopeUnitIds: schoolUnitIds,
              withinDays: 45,
              limit: 10,
            })
          : Promise.resolve([]),
        prisma.assignmentFollowUp.count({
          where: {
            tenant_id: member.tenant_id,
            created_by_user_id: member.user_id,
            happened_at: { gte: since },
          },
        }),
      ])
      summary = summaryRow
      dueSoon = upcoming
      overdueReminders = reminders.map((row) => ({
        note: row.note,
        facultyName: row.assignment?.assignee?.name || row.assignment?.assignee?.email || null,
      }))
      openCalls = calls
      followUpCount = followUps
    } catch (error) {
      result.failed += 1
      console.warn(`Weekly digest: could not build worklist for ${member.user.email}`, error)
      continue
    }

    const rows = headRowsByTenant.get(member.tenant_id) ?? []
    rows.push({
      name: member.user.name || member.user.email || 'Unknown',
      schoolCount: schoolUnitIds.length,
      active: summary.active,
      submitted: summary.submitted,
      missed: summary.missed,
      declined: summary.declined,
      followUps: followUpCount,
    })
    headRowsByTenant.set(member.tenant_id, rows)

    if (member.last_digest_sent_at && member.last_digest_sent_at > cutoff) {
      result.skippedRecentlySent += 1
      continue
    }

    const hasSomethingToSay =
      summary.active > 0 ||
      summary.missed > 0 ||
      summary.declined > 0 ||
      dueSoon.length > 0 ||
      overdueReminders.length > 0 ||
      openCalls.length > 0
    if (!hasSomethingToSay) {
      // A quiet week earns silence. Weekly mail that says "nothing to do" is
      // how a digest teaches people to filter it.
      result.skippedNothingPending += 1
      continue
    }

    const dashboardUrl = `${SITE_URL}/funding-dept`
    try {
      if (member.user.email) {
        await sendEmail({
          to: member.user.email,
          toName: member.user.name || undefined,
          ...fundingDeptWeeklyMemberTemplate({
            email: member.user.email,
            name: member.user.name,
            active: summary.active,
            missed: summary.missed,
            declined: summary.declined,
            dueSoon: dueSoon.map((row) => ({
              callTitle: row.callTitle || 'Untitled call',
              facultyName: row.facultyName,
              deadline: formatDate(row.deadlineAt),
            })),
            overdueReminders,
            openCalls: openCalls.map((row) => ({
              title: row.title || 'Untitled call',
              closesAt: formatDate(row.closesAt),
            })),
            dashboardUrl,
          }),
        })
      }

      await notifyQuietly({
        tenantId: member.tenant_id,
        userIds: [member.user_id],
        title: `Your funding calls this week: ${summary.active} active, ${summary.missed} overdue`,
        body: `${dueSoon.length} deadline(s) in the next 30 days, ${overdueReminders.length} follow-up(s) due.`,
        category: 'ANNOUNCEMENT',
        linkUrl: '/funding-dept',
      })

      await prisma.fundingDeptMember.update({
        where: { id: member.id },
        data: { last_digest_sent_at: now },
      })
      result.memberDigestsSent += 1
    } catch (error) {
      result.failed += 1
      console.warn(`Weekly digest: send failed for ${member.user.email}`, error)
    }
  }

  // --- Heads ----------------------------------------------------------------
  // A head is also a member, so both mails share one stamp. The check below
  // reads `head.last_digest_sent_at` from the objects loaded at the top of the
  // run, NOT from the database — the member loop may already have stamped this
  // very row, and re-reading it would make the head skip their own first send.
  const heads = members.filter((member) => member.is_head)
  for (const head of heads) {
    if (head.last_digest_sent_at && head.last_digest_sent_at > cutoff) {
      result.skippedRecentlySent += 1
      continue
    }

    const memberRows = headRowsByTenant.get(head.tenant_id) ?? []
    let uncoveredSchools: string[] = []
    try {
      const schools = await prisma.tenantOrgUnit.findMany({
        where: {
          tenant_id: head.tenant_id,
          depth: 0,
          is_active: true,
          funding_dept_coverage: { none: {} },
        },
        select: { name: true },
        orderBy: { name: 'asc' },
      })
      uncoveredSchools = schools.map((school) => school.name)
    } catch (error) {
      console.warn('Weekly digest: uncovered school lookup failed', error)
    }

    if (memberRows.length === 0 && uncoveredSchools.length === 0) {
      result.skippedNothingPending += 1
      continue
    }

    const overviewUrl = `${SITE_URL}/funding-dept/overview`
    try {
      if (head.user.email) {
        await sendEmail({
          to: head.user.email,
          toName: head.user.name || undefined,
          ...fundingDeptWeeklyHeadTemplate({
            email: head.user.email,
            name: head.user.name,
            memberRows,
            uncoveredSchools,
            overviewUrl,
          }),
        })
      }
      await notifyQuietly({
        tenantId: head.tenant_id,
        userIds: [head.user_id],
        title: 'Funding department: weekly review',
        body:
          uncoveredSchools.length > 0
            ? `${uncoveredSchools.length} school(s) have nobody assigned.`
            : `${memberRows.length} member(s) reporting this week.`,
        category: 'ANNOUNCEMENT',
        linkUrl: '/funding-dept/overview',
      })
      // Stamp even when the member loop already did: the stamp means "this
      // person has been mailed this run", and a head whose own worklist was
      // quiet still needs their rollup suppressed on a re-run.
      await prisma.fundingDeptMember.update({
        where: { id: head.id },
        data: { last_digest_sent_at: now },
      })
      result.headDigestsSent += 1
    } catch (error) {
      result.failed += 1
      console.warn(`Weekly digest: head send failed for ${head.user.email}`, error)
    }
  }

  return result
}
