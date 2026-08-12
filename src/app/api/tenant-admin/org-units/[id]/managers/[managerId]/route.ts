import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TENANT_ADMIN_ROLES, isAccessError, requireTenantRoles } from '@/lib/auth/tenantAccess'

export const dynamic = 'force-dynamic'

/** Revoking headship, like granting it, is full-tenant-admin only. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; managerId: string } }
) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const manager = await prisma.orgUnitManager.findFirst({
    where: { id: params.managerId, org_unit_id: params.id, tenant_id: context.tenantId },
    select: { id: true, user_id: true, org_unit_id: true },
  })
  if (!manager) {
    return NextResponse.json({ error: 'Head not found.' }, { status: 404 })
  }

  await prisma.orgUnitManager.delete({ where: { id: manager.id } })

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: context.user.id,
        tenantId: context.tenantId,
        action: 'ORG_HEAD_REVOKE',
        resource: `tenant_org_unit:${manager.org_unit_id}`,
        meta: { userId: manager.user_id },
      },
    })
  } catch (err) {
    console.warn('Org head revoke: audit log failed', err)
  }

  return NextResponse.json({ success: true })
}
