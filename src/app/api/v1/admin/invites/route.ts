import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { createAuditLog } from '@/lib/auth'
import { createTenantInvite, INVITABLE_ROLES, listTenantInvites } from '@/lib/tenant-invite-service'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  invites: z
    .array(
      z.object({
        email: z.string().email(),
        role: z.enum(INVITABLE_ROLES).default('ANALYST'),
        team_id: z.string().optional()
      })
    )
    .min(1)
    .max(25)
})

export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck
    const { user } = await authenticateRequest(request)

    const body = createSchema.parse(await request.json())

    const inviter = await prisma.user.findUnique({
      where: { id: user!.sub },
      select: {
        name: true,
        email: true,
        signupAtiToken: { select: { planTier: true } },
        tenant: { select: { id: true, name: true } }
      }
    })

    if (!inviter?.tenant) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'You must belong to a tenant to invite members' },
        { status: 403 }
      )
    }

    // Validate any team assignments up front
    const teamIds = Array.from(new Set(body.invites.map(i => i.team_id).filter(Boolean))) as string[]
    if (teamIds.length > 0) {
      const validCount = await prisma.team.count({
        where: { id: { in: teamIds }, tenantId: inviter.tenant.id, isActive: true }
      })
      if (validCount !== teamIds.length) {
        return NextResponse.json(
          { code: 'INVALID_TEAM', message: 'One or more teams are invalid or inactive' },
          { status: 400 }
        )
      }
    }

    const results = []
    for (const invite of body.invites) {
      const result = await createTenantInvite({
        tenantId: inviter.tenant.id,
        tenantName: inviter.tenant.name,
        invitedByUserId: user!.sub,
        inviterName: inviter.name || inviter.email,
        planTier: inviter.signupAtiToken?.planTier ?? null,
        email: invite.email,
        role: invite.role,
        teamId: invite.team_id
      })
      results.push(result)

      if (result.ok) {
        await createAuditLog({
          actorUserId: user!.sub,
          tenantId: inviter.tenant.id,
          action: 'MEMBER_INVITE_SENT',
          resource: `tenant_invite:${result.inviteId}`,
          ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
          meta: { email: result.email, role: invite.role, teamId: invite.team_id || null }
        })
      }
    }

    const sent = results.filter(r => r.ok).length
    return NextResponse.json(
      {
        sent,
        failed: results.length - sent,
        results: results.map(r => ({ email: r.email, ok: r.ok, error: r.error }))
      },
      { status: sent > 0 ? 201 : 400 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }
    console.error('Invite creation error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck
    const { user } = await authenticateRequest(request)

    const invites = await listTenantInvites(user!.tenant_id!)
    return NextResponse.json({
      invites: invites.map(i => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        expires_at: i.expiresAt,
        accepted_at: i.acceptedAt,
        created_at: i.createdAt,
        invited_by: i.invitedBy?.name || i.invitedBy?.email || null
      }))
    })
  } catch (error) {
    console.error('Invite list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
