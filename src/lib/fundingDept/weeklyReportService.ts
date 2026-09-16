/**
 * Weekly pending-work digests for the funding department.
 *
 * Members get their own worklist; the head gets the department rollup. Both are
 * stamped on `last_digest_sent_at` and skipped if stamped within
 * MIN_DIGEST_GAP_DAYS, so a retried job, an overlapping schedule or a manual
 * run cannot double-send.
 */
import prisma from '@/lib/prisma'
import { isMemberAway } from './shared'
import { SITE_URL, sendEmail } from '@/lib/mailer'
import {
  fundingDeptWeeklyHeadTemplate,
  fundingDeptWeeklyMemberTemplate,
} from '@/lib/email-templates'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import { getManagementReport, type ManagementReport } from './managementService'
import { day, inPeriod } from './managementRules'
import { backlogDeltas, weekStartFor } from './snapshotService'

/** A weekly job that runs twice in one week must not mail twice. */
const MIN_DIGEST_GAP_DAYS = 5

export interface WeeklyDigestResult {
  tenants: number
  membersConsidered: number
  memberDigestsSent: number
  headDigestsSent: number
  skippedRecentlySent: number
  skippedNothingPending: number
  /** Members whose digest was held back because they are on leave. */
  skippedAway: number
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
    skippedAway: 0,
    failed: 0,
  }

  const members = await prisma.fundingDeptMember.findMany({
    where: {
      is_active: true,
      ...(options.tenantId ? { tenant_id: options.tenantId } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      // Primary rota only: a deputy's digest should describe the schools they
      // are answerable for, not every school they might one day cover.
      school_assignments: { where: { is_deputy: false }, select: { org_unit_id: true } },
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

  const reportCache=new Map<string,Promise<ManagementReport>>()
  const reportFor=(tenantId:string)=>{if(!reportCache.has(tenantId))reportCache.set(tenantId,getManagementReport(tenantId,{asOf:now,start:since,end:new Date(now.getTime()+1),mode:'pending'}));return reportCache.get(tenantId)!}
  for (const member of members) {
    const schoolUnitIds = member.school_assignments.map((row) => row.org_unit_id)

    let summary
    let dueSoon: Array<{callTitle:string;facultyName:string|null;deadlineAt:Date|null}> = []
    let overdueReminders: Array<{ note: string; facultyName: string | null }> = []
    let openCalls: Array<{ title: string | null; closesAt: Date | null }> = []
    let followUpCount = 0

    try {
      const report=await reportFor(member.tenant_id)
      const applications=report.applications.filter(a=>schoolUnitIds.includes(a.school_id!))
      const open=applications.filter(a=>a.outstanding)
      summary={active:open.length,submitted:applications.filter(a=>a.submitted).length,
        missed:applications.filter(a=>a.stage==='LAPSED_NOT_APPLIED').length,declined:applications.filter(a=>a.stage==='DECLINED').length}
      dueSoon=open.filter(a=>a.agency_deadline&&a.agency_deadline>=now&&a.agency_deadline.getTime()<=now.getTime()+30*day)
        .sort((a,b)=>a.agency_deadline!.getTime()-b.agency_deadline!.getTime()).slice(0,10)
        .map(a=>({callTitle:a.title,facultyName:a.faculty?.name||null,deadlineAt:a.agency_deadline}))
      overdueReminders=report.actions.filter(a=>schoolUnitIds.includes(a.school_id)&&a.status==='OPEN'&&a.due_at&&a.due_at<=now).slice(0,10)
        .map(a=>({note:a.title+(a.blocker?' · '+a.blocker:''),facultyName:a.owner_name}))
      openCalls=report.members.flatMap(m=>m.schools.filter(s=>schoolUnitIds.includes(s.id)).flatMap(s=>s.calls))
        .filter(c=>c.unallocated&&(!c.deadline||c.deadline>=now)).slice(0,10).map(c=>({title:c.title,closesAt:c.deadline}))
      followUpCount=report.performance.find(p=>p.id===member.id)?.performedContacts||0

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

    // On leave: their row still counts towards the head's rollup above — the
    // work does not pause — but there is no point mailing a digest into an
    // inbox nobody is reading. The deputy sees the same work on their own
    // school desk and in the chase queue.
    if (isMemberAway(member, now)) {
      result.skippedAway += 1
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
          funding_dept_coverage: { none: { is_deputy: false, member: { is_active: true } } },
        },
        select: { name: true },
        orderBy: { name: 'asc' },
      })
      uncoveredSchools = schools.map((school) => school.name)
    } catch (error) {
      console.warn('Weekly digest: uncovered school lookup failed', error)
    }

    // This week unallocated backlog against last week. Read from the snapshot the
    // same job wrote a moment ago, rather than recomputed, so the mail and the
    // history cannot disagree. Null until two weeks exist, and the template then
    // omits the line rather than claiming nothing changed.
    let backlog: { current: number; previous: number | null } | null = null
    try {
      const deltas = await backlogDeltas(head.tenant_id, weekStartFor(now))
      if (deltas.size > 0) {
        let current = 0
        let previous = 0
        let sawPrevious = false
        for (const delta of deltas.values()) {
          current += delta.current
          if (delta.previous !== null) {
            previous += delta.previous
            sawPrevious = true
          }
        }
        backlog = { current, previous: sawPrevious ? previous : null }
      }
    } catch (error) {
      console.warn('Weekly digest: backlog delta lookup failed', error)
    }

    if (memberRows.length === 0 && uncoveredSchools.length === 0 && !backlog) {
      result.skippedNothingPending += 1
      continue
    }

    const overviewUrl = `${SITE_URL}/funding-dept/accountability`
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
            backlog,
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
