/**
 * Who is on the application.
 *
 * Internal members carry a `user_id` and can therefore open the proposal and
 * read what the department sent back; external collaborators are recorded by
 * name so the record is complete without granting anyone an account they do not
 * have.
 */
import prisma from '@/lib/prisma'

import { recordProposalEvent } from './events'
import { ProposalError } from './proposalService'
import { TEAM_ROLES, serializeTeamMember, type TeamRole } from './shared'

export interface TeamMemberInput {
  userId?: string | null
  name: string
  email?: string | null
  affiliation?: string | null
  role: TeamRole
  isExternal?: boolean
}

export interface ReplaceTeamInput {
  tenantId: string
  proposalId: string
  actorUserId: string
  members: TeamMemberInput[]
}

/**
 * Replace the whole team in one write.
 *
 * A grid edit is what the screen actually does, and diffing five rows client
 * side to send three PATCHes is more code and more ways to end up with two PIs.
 */
export async function replaceProposalTeam(input: ReplaceTeamInput) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: { id: true, tenant_id: true, pi_user_id: true },
  })
  if (!proposal) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const members = input.members.filter((member) => (member.name || '').trim().length > 0)

  const pis = members.filter((member) => member.role === 'PI')
  if (pis.length === 0) {
    throw new ProposalError('The application needs a principal investigator.', 400, 'PI_REQUIRED')
  }
  if (pis.length > 1) {
    throw new ProposalError('An application has exactly one principal investigator.', 400, 'ONE_PI')
  }
  if (pis[0].userId && pis[0].userId !== proposal.pi_user_id) {
    // Moving the PI would move the proposal between schools, reviewers and
    // dashboards. It is a real operation, just not this one.
    throw new ProposalError(
      'Changing the principal investigator is not done here. Ask the funding department.',
      400,
      'PI_IMMUTABLE'
    )
  }

  for (const member of members) {
    if (!TEAM_ROLES.includes(member.role)) {
      throw new ProposalError(`Unknown role ${member.role}.`, 400, 'BAD_ROLE')
    }
  }

  // Internal members must belong to this tenant: a user id from elsewhere would
  // hand a stranger the department's shared reviews.
  const internalIds = Array.from(
    new Set(members.map((member) => member.userId).filter((id): id is string => Boolean(id)))
  )
  const users = internalIds.length
    ? await prisma.user.findMany({
        where: { id: { in: internalIds }, tenantId: proposal.tenant_id },
        select: {
          id: true,
          name: true,
          email: true,
          researcher_profile: { select: { org_unit_id: true } },
        },
      })
    : []
  const byId = new Map(users.map((user) => [user.id, user]))
  for (const id of internalIds) {
    if (!byId.has(id)) {
      throw new ProposalError('One of the named people is not in this tenant.', 400, 'BAD_USER')
    }
  }
  if (new Set(internalIds).size !== internalIds.length) {
    throw new ProposalError('The same person is listed twice.', 400, 'DUPLICATE_MEMBER')
  }

  const rows = await prisma.$transaction(async (tx) => {
    await tx.grantProposalTeamMember.deleteMany({ where: { proposal_id: proposal.id } })

    for (const [index, member] of members.entries()) {
      const user = member.userId ? byId.get(member.userId) : null
      await tx.grantProposalTeamMember.create({
        data: {
          tenant_id: proposal.tenant_id,
          proposal_id: proposal.id,
          user_id: member.userId || null,
          name: (user?.name || member.name).trim().slice(0, 200),
          email: (member.email || user?.email || null)?.trim().slice(0, 200) || null,
          affiliation: member.affiliation?.trim().slice(0, 300) || null,
          org_unit_id: user?.researcher_profile?.org_unit_id || null,
          role: member.role,
          is_external: member.isExternal ?? !member.userId,
          sort_order: index,
        },
      })
    }

    await recordProposalEvent(tx, {
      tenantId: proposal.tenant_id,
      proposalId: proposal.id,
      actorUserId: input.actorUserId,
      kind: 'TEAM_CHANGED',
      payload: { count: members.length },
    })

    return tx.grantProposalTeamMember.findMany({
      where: { proposal_id: proposal.id },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      include: { org_unit: { select: { id: true, name: true } } },
    })
  })

  return rows.map(serializeTeamMember)
}

export async function listProposalTeam(proposalId: string) {
  const rows = await prisma.grantProposalTeamMember.findMany({
    where: { proposal_id: proposalId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    include: { org_unit: { select: { id: true, name: true } } },
  })
  return rows.map(serializeTeamMember)
}

/** Internal members who should hear about this proposal, PI included. */
export async function proposalTeamUserIds(proposalId: string): Promise<string[]> {
  const rows = await prisma.grantProposalTeamMember.findMany({
    where: { proposal_id: proposalId, user_id: { not: null } },
    select: { user_id: true },
  })
  return Array.from(new Set(rows.map((row) => row.user_id!).filter(Boolean)))
}
