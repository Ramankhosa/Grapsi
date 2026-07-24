import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantRoles } from '@/lib/auth/tenantAccess'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  code: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
})

async function loadUnit(tenantId: string, id: string) {
  return prisma.tenantOrgUnit.findFirst({
    where: { id, tenant_id: tenantId },
    select: { id: true, name: true, kind: true, parent_id: true, is_active: true },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await loadUnit(context.tenantId, params.id)
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  let payload
  try {
    payload = updateSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  if (payload.name && payload.name.toLowerCase() !== unit.name.toLowerCase()) {
    const duplicate = await prisma.tenantOrgUnit.findFirst({
      where: {
        tenant_id: context.tenantId,
        kind: unit.kind,
        parent_id: unit.parent_id,
        name: { equals: payload.name, mode: 'insensitive' },
        id: { not: unit.id },
      },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json(
        { error: `A ${unit.kind.toLowerCase()} named "${payload.name}" already exists here.` },
        { status: 409 }
      )
    }
  }

  const updated = await prisma.tenantOrgUnit.update({
    where: { id: unit.id },
    data: {
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.code !== undefined ? { code: payload.code } : {}),
      ...(payload.isActive !== undefined ? { is_active: payload.isActive } : {}),
    },
    select: { id: true, name: true, code: true, kind: true, parent_id: true, is_active: true },
  })

  // Keep the denormalized names on faculty profiles in step with the rename.
  if (payload.name) {
    if (updated.kind === 'DEPARTMENT') {
      await prisma.researcherProfile.updateMany({
        where: { org_unit_id: updated.id },
        data: { department: updated.name },
      })
    } else {
      const departmentIds = (
        await prisma.tenantOrgUnit.findMany({
          where: { parent_id: updated.id },
          select: { id: true },
        })
      ).map((department) => department.id)
      if (departmentIds.length > 0) {
        await prisma.researcherProfile.updateMany({
          where: { org_unit_id: { in: departmentIds } },
          data: { school: updated.name },
        })
      }
    }
  }

  return NextResponse.json({ unit: updated })
}

/**
 * Deleting is blocked while anything still depends on the unit — cascading
 * would silently detach faculty from their department. Deactivate instead.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await loadUnit(context.tenantId, params.id)
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  const [childCount, facultyCount] = await Promise.all([
    prisma.tenantOrgUnit.count({ where: { parent_id: unit.id } }),
    prisma.researcherProfile.count({ where: { org_unit_id: unit.id } }),
  ])

  if (childCount > 0) {
    return NextResponse.json(
      { error: `This school still has ${childCount} department(s). Remove or move them first.` },
      { status: 409 }
    )
  }
  if (facultyCount > 0) {
    return NextResponse.json(
      {
        error: `${facultyCount} faculty member(s) are still assigned here. Move them first, or deactivate this unit instead.`,
      },
      { status: 409 }
    )
  }

  await prisma.tenantOrgUnit.delete({ where: { id: unit.id } })
  return NextResponse.json({ success: true })
}
