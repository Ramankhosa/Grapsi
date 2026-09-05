/**
 * Who may see and touch a proposal.
 *
 * One rule, in one place. The funding-department module learned this the hard
 * way once already: three surfaces grew three answers to "may this person open
 * this school's work" and a department head ended up 403'd from every school
 * they were accountable for. Everything that reads a proposal resolves its lens
 * here.
 *
 *   admin    tenant OWNER/ADMIN/CALL_ADMIN — the whole tenant
 *   officer  the department: covering officer, deputy, head, or the manager of
 *            the linked assignment
 *   faculty  the PI, or an internal team member on the application
 *   head     a Dean/HoD with a manager grant over the school — read only, and
 *            never the department's internal notes
 *
 * The order matters: an officer who is also a co-investigator gets the officer
 * lens, because the wider one is the one that lets them do their job.
 */
import type { TenantScopeContext } from '@/lib/auth/tenantAccess'
import { canOpenSchoolWork } from '@/lib/fundingDept/shared'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import prisma from '@/lib/prisma'

import type { ProposalLens } from './shared'

export interface ProposalAccessRecord {
  id: string
  tenant_id: string
  org_unit_id: string
  pi_user_id: string
  status: string
  assignment?: {
    assigned_by_user_id: string
    assignee_org_unit_id: string | null
  } | null
  team?: Array<{ user_id: string | null }>
}

/**
 * Resolve the lens, or null when this person has no business knowing the
 * proposal exists. Callers answer null with a 404, never a 403: telling a
 * stranger "that exists but is not yours" is itself a disclosure.
 */
export function resolveProposalLens(
  context: TenantScopeContext,
  proposal: ProposalAccessRecord
): ProposalLens | null {
  if (proposal.tenant_id !== context.tenantId) return null

  if (context.isAdmin || context.scope.isTenantWide) return 'admin'

  // The department, by coverage — not by role. Removing someone's schools
  // removes their reach here exactly as it does everywhere else.
  //
  // Membership is checked as well as reach, and that is load-bearing:
  // `managedUnitIds` holds manager grants (a Dean's, an HoD's) alongside
  // funding-department coverage, so `canOpenSchoolWork` alone cannot tell an
  // officer from the Dean of the same school — and it would hand the Dean the
  // department's private assessment of their own faculty.
  if (context.scope.fundingDept.isMember && canOpenSchoolWork(context.scope, proposal.org_unit_id)) {
    return 'officer'
  }

  if (proposal.pi_user_id === context.user.id) return 'faculty'
  if ((proposal.team || []).some((member) => member.user_id === context.user.id)) return 'faculty'

  // Oversight, read-only: a Dean or HoD over the school, and whoever circulated
  // the call in the first place. Both have a real interest in what became of
  // it; neither is the department, so neither sees its internal notes.
  if (context.scope.isHead && context.scope.managedUnitIds.includes(proposal.org_unit_id)) {
    return 'head'
  }
  if (proposal.assignment && canManageAssignment(context.scope, proposal.assignment)) {
    return 'head'
  }

  return null
}

const accessSelect = {
  id: true,
  tenant_id: true,
  org_unit_id: true,
  pi_user_id: true,
  status: true,
  assignment: {
    select: { assigned_by_user_id: true, assignee_org_unit_id: true },
  },
  team: { select: { user_id: true } },
} as const

/**
 * Load a proposal and the caller's lens on it in one hop, for routes that then
 * fetch whatever else they need.
 */
export async function loadProposalForAccess(
  context: TenantScopeContext,
  proposalId: string
): Promise<{ record: ProposalAccessRecord; lens: ProposalLens } | null> {
  const record = await prisma.grantProposal.findUnique({
    where: { id: proposalId },
    select: accessSelect,
  })
  if (!record) return null

  const lens = resolveProposalLens(context, record as ProposalAccessRecord)
  if (!lens) return null

  return { record: record as ProposalAccessRecord, lens }
}

/**
 * The school ids a caller may see proposals in, or `null` for "all of them".
 * Used to clamp the register and every list query.
 */
export function proposalReachUnitIds(context: TenantScopeContext): string[] | null {
  if (context.isAdmin || context.scope.isTenantWide) return null
  if (context.scope.fundingDept.isHead) return null
  return context.scope.managedUnitIds
}
