import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { TENANT_ADMIN_ROLES, isAccessError, requireTenantRoles, requireTenantUser } from '@/lib/auth/tenantAccess'

export const dynamic = 'force-dynamic'

/**
 * Heads of an org unit.
 *
 * Granting headship is a privilege grant — it lets someone assign work and read
 * their branch's portfolio — so only full tenant admins (OWNER/ADMIN) may do it.
 * Deliberately NOT extended to CALL_ADMIN or to existing heads: a head being
 * able to mint more heads is how a scoped permission quietly becomes unscoped.
 */

const createSchema = z.object({
  userId: z.string().trim().min(1, 'A user is required'),
  scope: z.enum(['SUBTREE', 'UNIT_ONLY']).default('SUBTREE'),
  title: z.string().trim().max(120).nullable().optional(),
  canAssign: z.boolean().default(true),
  canViewReports: z.boolean().default(true),
  canManageStructure: z.boolean().default(false),
  canManageMembers: z.boolean().default(false),
})

function serialize(row: any) {
  return {
    id: row.id,
    orgUnitId: row.org_unit_id,
    userId: row.user_id,
    userName: row.user?.name || row.user?.email || null,
    userEmail: row.user?.email || null,
    scope: row.scope,
    title: row.title,
    canAssign: row.can_assign,
    canViewReports: row.can_view_reports,
    canManageStructure: row.can_manage_structure,
    canManageMembers: row.can_manage_members,
    isActive: row.is_active,
    createdAt: row.created_at,
  }
}

const managerInclude = {
  user: { select: { id: true, name: true, email: true } },
} as const

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: params.id, tenant_id: context.tenantId },
    select: { id: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  const managers = await prisma.orgUnitManager.findMany({
    where: { org_unit_id: unit.id, tenant_id: context.tenantId },
    include: managerInclude,
    orderBy: { created_at: 'asc' },
  })

  return NextResponse.json({ managers: managers.map(serialize) })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: params.id, tenant_id: context.tenantId },
    select: { id: true, name: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  let payload
  try {
    payload = createSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const user = await prisma.user.findFirst({
    where: { id: payload.userId, tenantId: context.tenantId },
    select: { id: true, name: true, email: true },
  })
  if (!user) {
    return NextResponse.json(
      { error: 'That person is not part of your organization.' },
      { status: 404 }
    )
  }

  // Re-granting an existing headship updates it rather than 409-ing: the UI
  // edits capabilities through the same control that created them.
  const manager = await prisma.orgUnitManager.upsert({
    where: { org_unit_id_user_id: { org_unit_id: unit.id, user_id: user.id } },
    create: {
      tenant_id: context.tenantId,
      org_unit_id: unit.id,
      user_id: user.id,
      scope: payload.scope,
      title: payload.title || null,
      can_assign: payload.canAssign,
      can_view_reports: payload.canViewReports,
      can_manage_structure: payload.canManageStructure,
      can_manage_members: payload.canManageMembers,
      created_by_user_id: context.user.id,
    },
    update: {
      scope: payload.scope,
      title: payload.title || null,
      can_assign: payload.canAssign,
      can_view_reports: payload.canViewReports,
      can_manage_structure: payload.canManageStructure,
      can_manage_members: payload.canManageMembers,
      is_active: true,
    },
    include: managerInclude,
  })

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: context.user.id,
        tenantId: context.tenantId,
        action: 'ORG_HEAD_GRANT',
        resource: `tenant_org_unit:${unit.id}`,
        meta: {
          unitName: unit.name,
          userId: user.id,
          userEmail: user.email,
          scope: payload.scope,
          canAssign: payload.canAssign,
        },
      },
    })
  } catch (err) {
    console.warn('Org head grant: audit log failed', err)
  }

  return NextResponse.json({ manager: serialize(manager) }, { status: 201 })
}
