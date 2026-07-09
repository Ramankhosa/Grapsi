import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { createAuditLog } from '@/lib/auth'
import { resendTenantInvite, revokeTenantInvite } from '@/lib/tenant-invite-service'

export const dynamic = 'force-dynamic'

// Revoke a pending invite (also revokes its backing ATI token)
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck
    const { user } = await authenticateRequest(request)

    const revoked = await revokeTenantInvite(params.id, user!.tenant_id!)
    if (!revoked) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Pending invite not found' },
        { status: 404 }
      )
    }

    await createAuditLog({
      actorUserId: user!.sub,
      tenantId: user!.tenant_id!,
      action: 'MEMBER_INVITE_REVOKED',
      resource: `tenant_invite:${params.id}`,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Invite revoke error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Resend the invitation email
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck
    const { user } = await authenticateRequest(request)

    const inviter = await prisma.user.findUnique({
      where: { id: user!.sub },
      select: { name: true, email: true, tenant: { select: { id: true, name: true } } }
    })
    if (!inviter?.tenant) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'You must belong to a tenant' },
        { status: 403 }
      )
    }

    const result = await resendTenantInvite(
      params.id,
      inviter.tenant.id,
      inviter.tenant.name,
      inviter.name || inviter.email
    )
    if (!result.ok) {
      return NextResponse.json({ code: 'RESEND_FAILED', message: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Invite resend error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
