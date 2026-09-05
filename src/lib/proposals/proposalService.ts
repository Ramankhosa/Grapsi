/**
 * Creating, reading and listing proposals.
 *
 * A proposal can start three ways, and all three end in the same row:
 *   - from an assignment the department circulated (the common path);
 *   - from a catalog call the researcher found themselves;
 *   - ad hoc, from an agency letter that never entered the catalog.
 *
 * The agency name and the school are snapshotted at creation rather than joined
 * at read time, because a department moving between schools next semester must
 * not rewrite whose application last year's grant was.
 */
import type { Prisma } from '@prisma/client'

import { schoolRootFor } from '@/lib/fundingDept/shared'
import prisma from '@/lib/prisma'
import { getReportingPeriod } from '@/lib/tenant/reportingPeriod'

import { seedChecklist } from './checklistService'
import { recordProposalEvent } from './events'
import { getProposalSettings } from './settings'
import {
  proposalInclude,
  CHECKLIST_SETTLED,
  serializeBudgetLine,
  serializeChecklistItem,
  serializeMilestone,
  serializeProposal,
  serializeProposalDocument,
  serializeProposalFollowUp,
  serializeReview,
  serializeTeamMember,
  serializeVersion,
  type ProposalLens,
  type ProposalStatus,
} from './shared'
import { nextActionFor } from './statusMachine'

export class ProposalError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'PROPOSAL_ERROR') {
    super(message)
    this.name = 'ProposalError'
    this.status = status
    this.code = code
  }
}

// Tenant policy is read through ./settings.ts.
export { getProposalSettings } from './settings'

/**
 * The internal cut-off implied by an agency deadline.
 *
 * Null when there is no deadline, and also null when the offset lands in the
 * past: a proposal opened against a call that closed last month would otherwise
 * be created already past its own cut-off, blocking the applicant from
 * uploading anything at the moment the record opens. A cut-off that has already
 * expired is not a policy, it is a trap; the officer sets one deliberately
 * instead.
 */
export function defaultCutoffFor(
  deadline: Date | null,
  offsetDays: number,
  now: Date = new Date()
): Date | null {
  if (!deadline || !Number.isFinite(deadline.getTime())) return null
  const cutoff = new Date(deadline.getTime() - offsetDays * 86_400_000)
  if (cutoff.getTime() <= now.getTime()) return null
  return cutoff
}

export interface CreateProposalInput {
  tenantId: string
  actorUserId: string
  /** Officers may open a proposal on somebody's behalf; faculty may not. */
  piUserId: string
  assignmentId?: string | null
  fundingCallId?: string | null
  adHoc?: {
    agencyName: string
    schemeTitle?: string | null
    deadlineAt?: Date | null
  } | null
  title?: string | null
}

/**
 * Open the record. Everything downstream (versions, reviews, budget, the
 * agency's answer) hangs off this row, so it is deliberately cheap to create:
 * a title and a PI is enough, and the rest is filled in as the work happens.
 */
export async function createProposal(input: CreateProposalInput) {
  const settings = await getProposalSettings(input.tenantId)

  let fundingCallId = input.fundingCallId || null
  let assignmentId = input.assignmentId || null
  let agencyName = input.adHoc?.agencyName?.trim() || ''
  let schemeTitle = input.adHoc?.schemeTitle?.trim() || null
  let deadline = input.adHoc?.deadlineAt || null
  let title = input.title?.trim() || ''
  let piUserId = input.piUserId

  if (assignmentId) {
    const assignment = await prisma.callAssignment.findFirst({
      where: { id: assignmentId, tenant_id: input.tenantId },
      include: {
        funding_call: {
          select: { id: true, title: true, agencyName: true, scheme_title: true, close_date: true, deadlineAt: true },
        },
      },
    })
    if (!assignment) throw new ProposalError('That assignment was not found.', 404, 'NOT_FOUND')

    // The assignment names the applicant; an officer creating the record on
    // their behalf must not be able to point it at somebody else.
    piUserId = assignment.assignee_user_id
    fundingCallId = assignment.funding_call_id
    agencyName = agencyName || assignment.funding_call?.agencyName || ''
    schemeTitle = schemeTitle || assignment.funding_call?.scheme_title || null
    deadline =
      deadline ||
      assignment.deadline_at ||
      assignment.funding_call?.close_date ||
      assignment.funding_call?.deadlineAt ||
      null
    title = title || assignment.funding_call?.title || ''
  } else if (fundingCallId) {
    const call = await prisma.fundingCall.findUnique({
      where: { id: fundingCallId },
      select: { id: true, title: true, agencyName: true, scheme_title: true, close_date: true, deadlineAt: true },
    })
    if (!call) throw new ProposalError('That funding call was not found.', 404, 'NOT_FOUND')
    agencyName = agencyName || call.agencyName || ''
    schemeTitle = schemeTitle || call.scheme_title || null
    deadline = deadline || call.close_date || call.deadlineAt || null
    title = title || call.title || ''
  }

  if (!agencyName) {
    // The reviewer needs an agency name and there may be no row to read one
    // from, so an ad hoc proposal must state it.
    throw new ProposalError('Name the funding agency.', 400, 'AGENCY_REQUIRED')
  }
  if (!title) {
    throw new ProposalError('Give the proposal a title.', 400, 'TITLE_REQUIRED')
  }

  const pi = await prisma.user.findFirst({
    where: { id: piUserId, tenantId: input.tenantId },
    select: {
      id: true,
      name: true,
      email: true,
      researcher_profile: { select: { org_unit_id: true } },
    },
  })
  if (!pi) throw new ProposalError('That researcher is not in this tenant.', 404, 'NOT_FOUND')

  const piUnitId = pi.researcher_profile?.org_unit_id || null
  const schoolId = await schoolRootFor(piUnitId)
  if (!schoolId) {
    throw new ProposalError(
      'This researcher is not placed in a school yet, so the proposal has no desk to reach. Ask an administrator to set their department.',
      400,
      'NO_ORG_UNIT'
    )
  }

  // A live application per (call, PI) already exists? Say so rather than
  // tripping a unique-constraint 500.
  if (fundingCallId) {
    const existing = await prisma.grantProposal.findFirst({
      where: {
        tenant_id: input.tenantId,
        funding_call_id: fundingCallId,
        pi_user_id: piUserId,
        status: { not: 'WITHDRAWN' },
      },
      select: { id: true },
    })
    if (existing) {
      throw new ProposalError(
        'A proposal already exists for this researcher on this call.',
        409,
        'ALREADY_EXISTS'
      )
    }
  }

  // If the researcher already drafted this call inside Grapsi, link the two so
  // the desk and the writing workspace are the same piece of work.
  const grantSession = fundingCallId
    ? await prisma.grantSession.findFirst({
        where: { tenantId: input.tenantId, fundingCallId, createdByUserId: piUserId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
    : null

  return prisma.$transaction(async (tx) => {
    const proposal = await tx.grantProposal.create({
      data: {
        tenant_id: input.tenantId,
        funding_call_id: fundingCallId,
        assignment_id: assignmentId,
        grant_session_id: grantSession?.id || null,
        pi_user_id: piUserId,
        org_unit_id: schoolId,
        pi_org_unit_id: piUnitId,
        title: title.slice(0, 500),
        agency_name: agencyName.slice(0, 300),
        scheme_title: schemeTitle ? schemeTitle.slice(0, 300) : null,
        agency_deadline_at: deadline,
        // Only when this office actually operates a cut-off; otherwise the
        // date would sit on the record implying a rule nobody enforces.
        review_cutoff_at: settings.cutoffEnabled
          ? defaultCutoffFor(deadline, settings.cutoffOffsetDays)
          : null,
        status: 'DRAFT',
        created_by_user_id: input.actorUserId,
      },
      include: proposalInclude,
    })

    // The PI is a team member like anyone else, so the team tab never starts
    // empty and "who is on this" has one answer, not two.
    await tx.grantProposalTeamMember.create({
      data: {
        tenant_id: input.tenantId,
        proposal_id: proposal.id,
        user_id: piUserId,
        name: pi.name || pi.email || 'Principal Investigator',
        email: pi.email,
        org_unit_id: piUnitId,
        role: 'PI',
        is_external: false,
        sort_order: 0,
      },
    })

    // The attachment bundle this institution requires, copied in now rather
    // than read live — editing the template later must not rewrite the
    // checklist of an application already being processed against the old one.
    await seedChecklist(tx, { tenantId: input.tenantId, proposalId: proposal.id })

    await recordProposalEvent(tx, {
      tenantId: input.tenantId,
      proposalId: proposal.id,
      actorUserId: input.actorUserId,
      kind: 'CREATED',
      toStatus: 'DRAFT',
      payload: {
        title: proposal.title,
        agencyName: proposal.agency_name,
        fromAssignment: Boolean(assignmentId),
      },
    })

    return proposal
  })
}

/** The whole record, through one lens. */
export async function getProposalDossier(proposalId: string, lens: ProposalLens) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: proposalId },
    include: proposalInclude,
  })
  if (!proposal) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const settings = await getProposalSettings(proposal.tenant_id)

  const internal = lens === 'admin' || lens === 'officer'

  const [versions, reviews, team, budget, documents, checklist, milestones, followUps] =
    await Promise.all([
    prisma.grantProposalVersion.findMany({
      where: { proposal_id: proposalId },
      orderBy: { version_no: 'desc' },
      include: { uploaded_by: { select: { id: true, name: true, email: true } } },
    }),
    prisma.grantProposalReview.findMany({
      where: {
        proposal_id: proposalId,
        // Faculty are shown reviews that were actually sent to them. A run in
        // flight, or one the officer chose not to share, is the department's
        // working state and not a verdict on their proposal.
        ...(lens === 'faculty' || lens === 'head' ? { shared_at: { not: null } } : {}),
      },
      orderBy: { created_at: 'desc' },
      include: {
        version: { select: { version_no: true } },
        run_by: { select: { id: true, name: true, email: true } },
        shared_by: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.grantProposalTeamMember.findMany({
      where: { proposal_id: proposalId },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      include: { org_unit: { select: { id: true, name: true } } },
    }),
    prisma.grantProposalBudgetLine.findMany({
      where: { proposal_id: proposalId },
      orderBy: [{ year_no: 'asc' }, { head: 'asc' }],
    }),
    // Letters the institution issued. An internal file copy stays with the
    // department; everything else is the applicant's to download.
    prisma.grantProposalDocument.findMany({
      where: { proposal_id: proposalId, ...(internal ? {} : { visible_to_faculty: true }) },
      orderBy: { created_at: 'desc' },
      include: { issued_by: { select: { id: true, name: true, email: true } } },
    }),
    prisma.grantProposalChecklistItem.findMany({
      where: { proposal_id: proposalId, ...(internal ? {} : { visible_to_faculty: true }) },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      include: {
        document: { select: { id: true, file_name: true } },
        completed_by: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.assignmentMilestone.findMany({
      where: { proposal_id: proposalId },
      orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
    }),
    // The contact log is the department's; the applicant sees only what an
    // officer marked for them.
    prisma.grantProposalFollowUp.findMany({
      where: { proposal_id: proposalId, ...(internal ? {} : { visible_to_faculty: true }) },
      orderBy: { happened_at: 'desc' },
      take: 100,
      include: { created_by: { select: { id: true, name: true, email: true } } },
    }),
  ])

  const latest = versions[0] || null

  return {
    proposal: serializeProposal(proposal, lens),
    versions: versions.map(serializeVersion),
    reviews: reviews.map((row) => serializeReview(row, lens)),
    team: team.map(serializeTeamMember),
    budget: budget.map(serializeBudgetLine),
    documents: documents.map(serializeProposalDocument),
    checklist: checklist.map(serializeChecklistItem),
    milestones: milestones.map(serializeMilestone),
    followUps: followUps.map((row) => serializeProposalFollowUp(row, lens)),
    // What still stands between this proposal and a clean clearance, so the
    // officer sees it beside the button rather than only when refused.
    outstandingRequired: checklist
      .filter((item) => item.is_required && !CHECKLIST_SETTLED.includes(item.status as any))
      .map((item) => item.label),
    nextAction: nextActionFor({
      status: proposal.status as ProposalStatus,
      currentVersionNo: proposal.current_version_no,
      latestVersionReviewStatus: latest?.review_status ?? null,
      reviewCutoffAt: settings.cutoffEnabled ? proposal.review_cutoff_at : null,
      aiReviewEnabled: settings.aiReviewEnabled,
    }),
    settings,
    lens,
  }
}

export interface ListProposalsInput {
  tenantId: string
  view: 'register' | 'mine'
  /** How the rows are serialized. The route decides; this never infers it. */
  lens: ProposalLens
  userId: string
  /** null means every school (admin or department head). */
  reachUnitIds: string[] | null
  status?: string[] | null
  orgUnitId?: string | null
  agency?: string | null
  fundingCallId?: string | null
  piUserId?: string | null
  q?: string | null
  /** 'all' | 'reporting' — the tenant's period of consideration. */
  window?: string | null
  limit?: number
  offset?: number
}

/**
 * The register and the researcher's own list, from one query.
 *
 * Pendency is point-in-time: the window filters *when a proposal was created*,
 * never which ones are still open, because windowing "still open" would turn a
 * fact into an artefact of the filter.
 */
export async function listProposals(input: ListProposalsInput) {
  const settings = await getProposalSettings(input.tenantId)
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const offset = Math.max(input.offset ?? 0, 0)

  const where: Prisma.GrantProposalWhereInput = { tenant_id: input.tenantId }
  const and: Prisma.GrantProposalWhereInput[] = []

  if (input.view === 'mine') {
    and.push({
      OR: [{ pi_user_id: input.userId }, { team: { some: { user_id: input.userId } } }],
    })
  } else if (input.reachUnitIds) {
    // An officer sees their schools; the same clamp as every other department
    // surface. An impossible filter rather than an empty `in`, so a member with
    // no coverage sees nothing instead of everything.
    and.push({ org_unit_id: { in: input.reachUnitIds.length ? input.reachUnitIds : ['__none__'] } })
  }

  if (input.status?.length) and.push({ status: { in: input.status } })
  if (input.orgUnitId) and.push({ org_unit_id: input.orgUnitId })
  if (input.fundingCallId) and.push({ funding_call_id: input.fundingCallId })
  if (input.piUserId) and.push({ pi_user_id: input.piUserId })
  if (input.agency) and.push({ agency_name: { contains: input.agency, mode: 'insensitive' } })

  if (input.q) {
    const q = input.q.trim()
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { agency_name: { contains: q, mode: 'insensitive' } },
          { scheme_title: { contains: q, mode: 'insensitive' } },
          { submission_reference: { contains: q, mode: 'insensitive' } },
          { pi: { name: { contains: q, mode: 'insensitive' } } },
          { pi: { email: { contains: q, mode: 'insensitive' } } },
        ],
      })
    }
  }

  if (input.window === 'reporting') {
    const period = await getReportingPeriod(input.tenantId)
    and.push({ created_at: { gte: period.start, lte: period.end } })
  }

  if (and.length) where.AND = and

  const [rows, total] = await Promise.all([
    prisma.grantProposal.findMany({
      where,
      include: {
        ...proposalInclude,
        versions: {
          orderBy: { version_no: 'desc' },
          take: 1,
          select: { version_no: true, review_status: true, created_at: true },
        },
        reviews: {
          where: { shared_at: { not: null } },
          orderBy: { shared_at: 'desc' },
          take: 1,
          select: { overall_score: true, recommendation: true, shared_at: true },
        },
      },
      orderBy: [{ updated_at: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.grantProposal.count({ where }),
  ])

  const viewerLens: ProposalLens = input.lens

  return {
    total,
    limit,
    offset,
    proposals: rows.map((row) => {
      const latest = (row as any).versions?.[0] || null
      const lastShared = (row as any).reviews?.[0] || null
      return {
        ...serializeProposal(row, viewerLens),
        latestVersion: latest
          ? {
              versionNo: latest.version_no,
              reviewStatus: latest.review_status,
              uploadedAt: latest.created_at,
            }
          : null,
        lastSharedReview: lastShared
          ? {
              score: lastShared.overall_score ?? null,
              recommendation: lastShared.recommendation ?? null,
              sharedAt: lastShared.shared_at,
            }
          : null,
        nextAction: nextActionFor({
          status: row.status as ProposalStatus,
          currentVersionNo: row.current_version_no,
          latestVersionReviewStatus: latest?.review_status ?? null,
          reviewCutoffAt: settings.cutoffEnabled ? row.review_cutoff_at : null,
          aiReviewEnabled: settings.aiReviewEnabled,
        }),
      }
    }),
  }
}

export interface UpdateProposalInput {
  proposalId: string
  tenantId: string
  actorUserId: string
  lens: ProposalLens
  title?: string
  schemeTitle?: string | null
  agencyName?: string
  agencyDeadlineAt?: Date | null
  reviewCutoffAt?: Date | null
  durationMonths?: number | null
  requestedAmount?: number | null
  currency?: string
}

/**
 * Edit the descriptive fields. The cut-off is an officer's to set — it is the
 * department's own deadline and an applicant moving it would empty it of
 * meaning.
 */
export async function updateProposalDetails(input: UpdateProposalInput) {
  const current = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: {
      id: true,
      review_cutoff_at: true,
      status: true,
      nudge_stages: true,
    },
  })
  if (!current) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const managing = input.lens === 'admin' || input.lens === 'officer'
  const data: Prisma.GrantProposalUpdateInput = {}

  if (input.title !== undefined) data.title = input.title.trim().slice(0, 500)
  if (input.schemeTitle !== undefined) {
    data.scheme_title = input.schemeTitle ? input.schemeTitle.trim().slice(0, 300) : null
  }
  if (input.durationMonths !== undefined) data.duration_months = input.durationMonths
  if (input.requestedAmount !== undefined) data.requested_amount = input.requestedAmount
  if (input.currency !== undefined) data.currency = input.currency.trim().slice(0, 8) || 'INR'

  if (input.agencyName !== undefined) {
    if (!managing) throw new ProposalError('Only the funding department can change the agency.', 403, 'FORBIDDEN')
    const name = input.agencyName.trim()
    if (!name) throw new ProposalError('Name the funding agency.', 400, 'AGENCY_REQUIRED')
    data.agency_name = name.slice(0, 300)
  }
  if (input.agencyDeadlineAt !== undefined) {
    if (!managing) throw new ProposalError('Only the funding department can change the deadline.', 403, 'FORBIDDEN')
    data.agency_deadline_at = input.agencyDeadlineAt
  }

  let cutoffChanged = false
  if (input.reviewCutoffAt !== undefined) {
    if (!managing) throw new ProposalError('Only the funding department sets the cut-off.', 403, 'FORBIDDEN')
    data.review_cutoff_at = input.reviewCutoffAt
    cutoffChanged =
      (current.review_cutoff_at?.getTime() ?? null) !== (input.reviewCutoffAt?.getTime() ?? null)
    // A moved cut-off starts its warnings again; otherwise extending a deadline
    // silently skips the nudges the applicant needed.
    if (cutoffChanged) data.nudge_stages = []
  }

  if (Object.keys(data).length === 0) {
    throw new ProposalError('Nothing to update.', 400, 'NO_CHANGES')
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.grantProposal.update({
      where: { id: input.proposalId },
      data,
      include: proposalInclude,
    })

    if (cutoffChanged) {
      await recordProposalEvent(tx, {
        tenantId: input.tenantId,
        proposalId: input.proposalId,
        actorUserId: input.actorUserId,
        kind: 'CUTOFF_SET',
        payload: { reviewCutoffAt: input.reviewCutoffAt?.toISOString() ?? null },
      })
    }

    return row
  })

  return { proposal: updated, cutoffChanged }
}
