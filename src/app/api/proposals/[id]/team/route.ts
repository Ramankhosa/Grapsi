import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { getProposalSettings } from '@/lib/proposals/settings'
import { TEAM_ROLES } from '@/lib/proposals/shared'
import { listProposalTeam, replaceProposalTeam } from '@/lib/proposals/teamService'

export const dynamic = 'force-dynamic'

const memberSchema = z.object({
  userId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1, 'Every team member needs a name').max(200),
  email: z.string().trim().max(200).nullable().optional(),
  affiliation: z.string().trim().max(300).nullable().optional(),
  role: z.enum(TEAM_ROLES),
  isExternal: z.boolean().optional(),
})

const putSchema = z.object({
  members: z.array(memberSchema).min(1).max(30),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  return NextResponse.json({ team: await listProposalTeam(params.id) })
}

/**
 * Replace the whole team. The screen edits a grid, so the API takes a grid;
 * diffing rows on the client is more code and one more way to end up with two
 * principal investigators.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (access.lens === 'head') {
    return NextResponse.json({ error: 'This view is read-only.' }, { status: 403 })
  }

  const settings = await getProposalSettings(context.tenantId)
  if (!settings.teamEnabled) {
    return NextResponse.json(
      {
        error: 'Co-investigator records are switched off for this institution.',
        code: 'FEATURE_DISABLED',
      },
      { status: 403 }
    )
  }

  // Once the department has cleared it, the application is fixed; a co-PI
  // appearing after clearance is a different application.
  if (access.lens === 'faculty' && !['DRAFT', 'IN_REVIEW'].includes(access.record.status)) {
    return NextResponse.json(
      { error: 'This proposal has been cleared. Ask your funding officer to change the team.' },
      { status: 403 }
    )
  }

  let payload: z.infer<typeof putSchema>
  try {
    payload = putSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    const team = await replaceProposalTeam({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      members: payload.members.map((member) => ({
        userId: member.userId ?? null,
        name: member.name,
        email: member.email ?? null,
        affiliation: member.affiliation ?? null,
        role: member.role,
        isExternal: member.isExternal,
      })),
    })
    return NextResponse.json({ team })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] team update failed', error)
    return NextResponse.json({ error: 'Could not save the team.' }, { status: 500 })
  }
}
