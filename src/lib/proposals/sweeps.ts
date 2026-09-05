/**
 * The proposal desk's three standing watches.
 *
 * Each answers a question that is invisible until someone asks it, and by then
 * the deadline has usually gone:
 *
 *   1. the applicant was sent a review and has not uploaded a revision, with
 *      the department's cut-off approaching;
 *   2. a draft has been sitting unreviewed, or reviewed and unsent, past the
 *      service level the department holds itself to;
 *   3. an application went to the agency months ago and nobody has recorded
 *      what happened to it.
 *
 * All three are idempotent. The cut-off ladder is guarded by `nudge_stages`
 * exactly like the assignment ladder — the array is both the record and the
 * lock — and the other two are bounded by their own timestamps, so running this
 * every hour cannot double-send.
 */
import { isMemberAway, schoolRootFor } from '@/lib/fundingDept/shared'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'

import {
  proposalCutoffTemplate,
  proposalFollowUpDueTemplate,
  proposalObligationDueTemplate,
  proposalReviewSlaTemplate,
} from '@/lib/email-templates'

import { emailProposalRecipients, recipientsFor } from './notify'
import { getProposalSettingsFor, type ProposalSettings } from './settings'
import { claimDueFollowUpReminders } from './followUpService'
import { proposalTeamUserIds } from './teamService'

/**
 * Fallbacks only. The real thresholds are per tenant — an office that reads
 * drafts in a day and one that takes a fortnight should not share a warning
 * level — so these are what a tenant with no settings row gets.
 */
export const REVIEW_SLA_DAYS = Number(process.env.PROPOSAL_REVIEW_SLA_DAYS) || 3
export const AGENCY_STALE_DAYS = Number(process.env.PROPOSAL_AGENCY_STALE_DAYS) || 60

/**
 * The narrowest threshold any tenant may configure. The queries cast their net
 * this wide and each tenant's own figure is applied to the rows that come back,
 * so one query serves every tenant without missing the strictest of them.
 */
const MIN_SLA_DAYS = 1
const MIN_STALE_DAYS = 7

/**
 * The post-award ladder. Wider than the cut-off one because a utilisation
 * certificate takes an accounts department weeks, not days, and OVERDUE fires
 * once so a forgotten filing does not go quiet.
 */
const OBLIGATION_STAGES: Array<{ stage: string; days: number }> = [
  { stage: 'D30', days: 30 },
  { stage: 'D14', days: 14 },
  { stage: 'D7', days: 7 },
  { stage: 'D1', days: 1 },
  { stage: 'OVERDUE', days: -1 },
]

/** The cut-off ladder, longest window first, so only the most urgent fires. */
const CUTOFF_STAGES: Array<{ stage: string; days: number }> = [
  { stage: 'D3', days: 3 },
  { stage: 'D1', days: 1 },
]

export interface ProposalSweepResult {
  cutoffNudges: number
  slaWarnings: number
  agencyStaleWarnings: number
  considered: number
  /** Rows skipped because their tenant has that watch switched off. */
  skippedDisabled: number
  /** Ticklers an officer set on themselves that came due. */
  followUpReminders: number
  /** Utilisation certificates, instalments and reports nearing their date. */
  obligationNudges: number
}

/**
 * The officers who answer for a school: the primary cover, or the deputy while
 * the primary is away, plus the department head as backstop.
 */
async function officersForSchool(tenantId: string, orgUnitId: string): Promise<string[]> {
  const rootId = (await schoolRootFor(orgUnitId)) || orgUnitId
  const coverage = await prisma.fundingDeptSchoolAssignment.findMany({
    where: { tenant_id: tenantId, org_unit_id: rootId, member: { is_active: true } },
    select: {
      is_deputy: true,
      member: { select: { user_id: true, away_from: true, away_until: true } },
    },
  })

  const recipients = new Set<string>()
  const deputies = coverage.filter((row) => row.is_deputy)

  for (const row of coverage.filter((entry) => !entry.is_deputy)) {
    if (!row.member?.user_id) continue
    if (isMemberAway(row.member)) {
      for (const deputy of deputies) {
        if (deputy.member?.user_id) recipients.add(deputy.member.user_id)
      }
    } else {
      recipients.add(row.member.user_id)
    }
  }

  if (recipients.size === 0) {
    for (const deputy of deputies) {
      if (deputy.member?.user_id) recipients.add(deputy.member.user_id)
    }
  }

  return Array.from(recipients)
}

async function departmentHead(tenantId: string): Promise<string | null> {
  const head = await prisma.fundingDeptMember.findFirst({
    where: { tenant_id: tenantId, is_head: true, is_active: true },
    select: { user_id: true },
  })
  return head?.user_id || null
}

export async function sweepProposals(limit = 200): Promise<ProposalSweepResult> {
  const now = new Date()
  const result: ProposalSweepResult = {
    cutoffNudges: 0,
    slaWarnings: 0,
    agencyStaleWarnings: 0,
    considered: 0,
    skippedDisabled: 0,
    followUpReminders: 0,
    obligationNudges: 0,
  }

  // Settings are read once per tenant for the whole sweep rather than once per
  // row; a hundred proposals in one tenant is one lookup.
  const settingsCache = new Map<string, ProposalSettings>()
  async function settingsFor(tenantIds: string[]): Promise<void> {
    const missing = tenantIds.filter((id) => !settingsCache.has(id))
    if (missing.length === 0) return
    for (const [id, value] of (await getProposalSettingsFor(missing)).entries()) {
      settingsCache.set(id, value)
    }
  }
  const policy = (tenantId: string): ProposalSettings | null => settingsCache.get(tenantId) ?? null

  // ---- 1. Cut-off approaching, no fresh draft --------------------------
  const horizon = new Date(now.getTime() + CUTOFF_STAGES[0].days * 86_400_000)
  const nearingCutoff = await prisma.grantProposal.findMany({
    where: {
      status: 'IN_REVIEW',
      review_cutoff_at: { gte: now, lte: horizon },
    },
    take: limit,
    select: {
      id: true,
      tenant_id: true,
      title: true,
      review_cutoff_at: true,
      nudge_stages: true,
      current_version_no: true,
      versions: {
        orderBy: { version_no: 'desc' },
        take: 1,
        select: { created_at: true, review_status: true },
      },
      reviews: {
        where: { shared_at: { not: null } },
        orderBy: { shared_at: 'desc' },
        take: 1,
        select: { shared_at: true },
      },
    },
  })

  await settingsFor(nearingCutoff.map((row) => row.tenant_id))

  for (const proposal of nearingCutoff) {
    result.considered += 1
    const settings = policy(proposal.tenant_id)
    // An office that does not operate a cut-off must not have its applicants
    // chased about one.
    if (settings && !settings.cutoffEnabled) {
      result.skippedDisabled += 1
      continue
    }
    const cutoff = proposal.review_cutoff_at
    if (!cutoff) continue

    const daysLeft = Math.ceil((cutoff.getTime() - now.getTime()) / 86_400_000)
    // filter().pop(), not find(): the array runs longest window first, so the
    // LAST match is the most urgent one. find() returns D3 even when a single
    // day is left, and since D3 is already in the ladder the row is skipped —
    // which silently means D1, the nudge that matters most, never fires.
    const stage = CUTOFF_STAGES.filter((entry) => daysLeft <= entry.days).pop()
    if (!stage) continue
    if (proposal.nudge_stages.includes(stage.stage)) continue

    // Nothing to chase if the applicant has already answered the last review
    // with a newer draft.
    const lastShared = proposal.reviews[0]?.shared_at
    const lastVersionAt = proposal.versions[0]?.created_at
    if (lastShared && lastVersionAt && lastVersionAt > lastShared) continue

    // The array is the lock: append only if this stage is not already there,
    // so two overlapping sweeps cannot both send.
    const claimed = await prisma.$executeRaw`
      UPDATE "grant_proposals"
      SET nudge_stages = array_append(nudge_stages, ${stage.stage}), updated_at = NOW()
      WHERE id = ${proposal.id} AND NOT (${stage.stage} = ANY(nudge_stages))
    `
    if (claimed === 0) continue

    const recipients = await proposalTeamUserIds(proposal.id)
    if (recipients.length) {
      await notifyQuietly({
        tenantId: proposal.tenant_id,
        userIds: recipients,
        title:
          daysLeft <= 1
            ? 'Your revised proposal is due tomorrow'
            : `${daysLeft} days left to upload your revision`,
        body: `${proposal.title} — the funding department's cut-off is ${cutoff.toDateString()}.`,
        category: 'PROPOSAL',
        linkUrl: `/proposals/${proposal.id}`,
      })

      // A cut-off is a date somebody has to act by, so it leaves the app.
      await emailProposalRecipients(
        proposal.tenant_id,
        await recipientsFor(recipients),
        (recipient) =>
          proposalCutoffTemplate({
            email: recipient.email,
            name: recipient.name,
            proposalTitle: proposal.title,
            cutoffDate: cutoff.toDateString(),
            daysLeft,
            proposalId: proposal.id,
          })
      )

      result.cutoffNudges += 1
    }
  }

  // ---- 2. A draft the department has not turned around ------------------
  // Cast the net at the widest threshold any tenant may have set, then apply
  // each tenant's own figure below.
  const slaBefore = new Date(now.getTime() - MIN_SLA_DAYS * 86_400_000)
  const stalled = await prisma.grantProposalVersion.findMany({
    where: {
      created_at: { lt: slaBefore },
      review_status: { in: ['NONE', 'REVIEWED'] },
      proposal: { status: 'IN_REVIEW' },
    },
    take: limit,
    select: {
      id: true,
      version_no: true,
      review_status: true,
      created_at: true,
      proposal: {
        select: {
          id: true,
          tenant_id: true,
          title: true,
          org_unit_id: true,
          current_version_no: true,
          pi: { select: { name: true, email: true } },
        },
      },
    },
    orderBy: { created_at: 'asc' },
  })

  await settingsFor(stalled.map((row) => row.proposal.tenant_id))

  for (const version of stalled) {
    // Only the current draft matters: a superseded one was overtaken, not
    // neglected.
    if (version.version_no !== version.proposal.current_version_no) continue

    const settings = policy(version.proposal.tenant_id)
    const slaDays = settings?.reviewSlaDays ?? REVIEW_SLA_DAYS
    const waitedMs = now.getTime() - version.created_at.getTime()
    if (waitedMs < slaDays * 86_400_000) continue
    // A draft awaiting a review nobody runs is not a breach of anything.
    if (settings && !settings.aiReviewEnabled && version.review_status === 'NONE') {
      result.skippedDisabled += 1
      continue
    }

    // Once a day at most, and only while it is genuinely outstanding. The
    // event log is the idempotency record — no extra column needed.
    const alreadyWarned = await prisma.grantProposalEvent.findFirst({
      where: {
        proposal_id: version.proposal.id,
        kind: 'NOTE',
        created_at: { gt: new Date(now.getTime() - 86_400_000) },
        payload: { path: ['sweep'], equals: 'REVIEW_SLA' },
      },
      select: { id: true },
    })
    if (alreadyWarned) continue

    const officers = await officersForSchool(version.proposal.tenant_id, version.proposal.org_unit_id)
    const head = await departmentHead(version.proposal.tenant_id)
    const recipients = Array.from(new Set([...officers, ...(head ? [head] : [])]))
    if (!recipients.length) continue

    const waitingDays = Math.floor((now.getTime() - version.created_at.getTime()) / 86_400_000)

    await prisma.grantProposalEvent.create({
      data: {
        tenant_id: version.proposal.tenant_id,
        proposal_id: version.proposal.id,
        kind: 'NOTE',
        payload: {
          sweep: 'REVIEW_SLA',
          versionNo: version.version_no,
          state: version.review_status,
          waitingDays,
        },
        visible_to_faculty: false,
      },
    })

    await notifyQuietly({
      tenantId: version.proposal.tenant_id,
      userIds: recipients,
      title:
        version.review_status === 'REVIEWED'
          ? 'A finished review has not been sent'
          : 'A proposal draft is still unreviewed',
      body: `${version.proposal.title} — version ${version.version_no}, waiting ${waitingDays} days.`,
      category: 'PROPOSAL',
      linkUrl: `/funding-dept/proposals/${version.proposal.id}`,
    })

    await emailProposalRecipients(
      version.proposal.tenant_id,
      await recipientsFor(recipients),
      (recipient) =>
        proposalReviewSlaTemplate({
          email: recipient.email,
          name: recipient.name,
          proposalTitle: version.proposal.title,
          researcherName: version.proposal.pi?.name || version.proposal.pi?.email || 'A researcher',
          versionNo: version.version_no,
          waitingDays,
          state: version.review_status === 'REVIEWED' ? 'unsent' : 'unreviewed',
          proposalId: version.proposal.id,
        })
    )

    result.slaWarnings += 1
  }

  // ---- 3. Submitted, and no word from the agency -------------------------
  const staleBefore = new Date(now.getTime() - MIN_STALE_DAYS * 86_400_000)
  const quiet = await prisma.grantProposal.findMany({
    where: {
      status: { in: ['SUBMITTED', 'UNDER_AGENCY_REVIEW'] },
      OR: [
        { agency_status_updated_at: { lt: staleBefore } },
        { agency_status_updated_at: null, submitted_at: { lt: staleBefore } },
      ],
    },
    take: limit,
    select: {
      id: true,
      tenant_id: true,
      title: true,
      org_unit_id: true,
      agency_name: true,
      submitted_at: true,
      agency_status_updated_at: true,
    },
  })

  await settingsFor(quiet.map((row) => row.tenant_id))

  for (const proposal of quiet) {
    const settings = policy(proposal.tenant_id)
    // An office whose record ends at submission has nothing to chase.
    if (settings && !settings.agencyTrackingEnabled) {
      result.skippedDisabled += 1
      continue
    }
    const staleDays = settings?.agencyStaleDays ?? AGENCY_STALE_DAYS
    const sinceAt = proposal.agency_status_updated_at || proposal.submitted_at
    if (!sinceAt || now.getTime() - sinceAt.getTime() < staleDays * 86_400_000) continue

    const alreadyWarned = await prisma.grantProposalEvent.findFirst({
      where: {
        proposal_id: proposal.id,
        kind: 'NOTE',
        created_at: { gt: new Date(now.getTime() - 30 * 86_400_000) },
        payload: { path: ['sweep'], equals: 'AGENCY_STALE' },
      },
      select: { id: true },
    })
    if (alreadyWarned) continue

    const officers = await officersForSchool(proposal.tenant_id, proposal.org_unit_id)
    if (!officers.length) continue

    const since = proposal.agency_status_updated_at || proposal.submitted_at
    const days = since ? Math.floor((now.getTime() - since.getTime()) / 86_400_000) : AGENCY_STALE_DAYS

    await prisma.grantProposalEvent.create({
      data: {
        tenant_id: proposal.tenant_id,
        proposal_id: proposal.id,
        kind: 'NOTE',
        payload: { sweep: 'AGENCY_STALE', days },
        visible_to_faculty: false,
      },
    })

    await notifyQuietly({
      tenantId: proposal.tenant_id,
      userIds: officers,
      title: 'No word from the agency in a while',
      body: `${proposal.title} — ${proposal.agency_name}, ${days} days without an update. Worth a call.`,
      category: 'PROPOSAL',
      linkUrl: `/funding-dept/proposals/${proposal.id}`,
    })
    result.agencyStaleWarnings += 1
  }

  // ---- 4. A tickler the officer set on themselves ------------------------
  const ticklers = await claimDueFollowUpReminders(Math.min(limit, 50))
  for (const tickler of ticklers) {
    await notifyQuietly({
      tenantId: tickler.tenantId,
      userIds: [tickler.authorUserId],
      title: 'Your reminder on a proposal',
      body: `${tickler.proposalTitle} — ${tickler.note.slice(0, 200)}`,
      category: 'PROPOSAL',
      linkUrl: `/funding-dept/proposals/${tickler.proposalId}`,
    })

    await emailProposalRecipients(
      tickler.tenantId,
      await recipientsFor([tickler.authorUserId]),
      (recipient) =>
        proposalFollowUpDueTemplate({
          email: recipient.email,
          name: recipient.name,
          proposalTitle: tickler.proposalTitle,
          note: tickler.note,
          proposalId: tickler.proposalId,
        })
    )
    result.followUpReminders += 1
  }

  // ---- 5. Post-award obligations coming due ------------------------------
  // The same ladder shape the assignment milestones use, but told to the people
  // a proposal actually has: its PI and the officer covering that school.
  const obligationHorizon = new Date(now.getTime() + 30 * 86_400_000)
  const obligations = await prisma.assignmentMilestone.findMany({
    where: {
      proposal_id: { not: null },
      status: 'PENDING',
      due_at: { not: null, lte: obligationHorizon },
    },
    take: limit,
    select: {
      id: true,
      tenant_id: true,
      kind: true,
      title: true,
      due_at: true,
      auto_nudge_stages: true,
      proposal: {
        select: { id: true, title: true, org_unit_id: true, status: true },
      },
    },
    orderBy: { due_at: 'asc' },
  })

  await settingsFor(obligations.map((row) => row.tenant_id))

  for (const obligation of obligations) {
    if (!obligation.proposal || !obligation.due_at) continue

    const settings = policy(obligation.tenant_id)
    if (settings && !settings.postAwardEnabled) {
      result.skippedDisabled += 1
      continue
    }

    const daysLeft = Math.ceil((obligation.due_at.getTime() - now.getTime()) / 86_400_000)
    // Same rule as above: the last match is the most urgent rung.
    const stage = OBLIGATION_STAGES.filter((entry) => daysLeft <= entry.days).pop()
    if (!stage) continue
    if (obligation.auto_nudge_stages.includes(stage.stage)) continue

    // The array is the lock, exactly as it is for assignment milestones.
    const claimed = await prisma.$executeRaw`
      UPDATE "assignment_milestones"
      SET auto_nudge_stages = array_append(auto_nudge_stages, ${stage.stage}), updated_at = NOW()
      WHERE id = ${obligation.id} AND NOT (${stage.stage} = ANY(auto_nudge_stages))
    `
    if (claimed === 0) continue

    const officers = await officersForSchool(obligation.tenant_id, obligation.proposal.org_unit_id)
    const team = await proposalTeamUserIds(obligation.proposal.id)
    const recipients = Array.from(new Set([...officers, ...team]))
    if (!recipients.length) continue

    await notifyQuietly({
      tenantId: obligation.tenant_id,
      userIds: recipients,
      title:
        daysLeft < 0
          ? `${obligation.title} is overdue`
          : daysLeft === 0
            ? `${obligation.title} is due today`
            : `${obligation.title} is due in ${daysLeft} days`,
      body: obligation.proposal.title,
      category: 'PROPOSAL',
      linkUrl: `/funding-dept/proposals/${obligation.proposal.id}`,
    })

    await emailProposalRecipients(
      obligation.tenant_id,
      await recipientsFor(officers),
      (recipient) =>
        proposalObligationDueTemplate({
          email: recipient.email,
          name: recipient.name,
          proposalTitle: obligation.proposal!.title,
          obligation: obligation.title,
          dueDate: obligation.due_at!.toDateString(),
          daysLeft,
          proposalId: obligation.proposal!.id,
          forOfficer: true,
        })
    )
    result.obligationNudges += 1
  }

  return result
}
