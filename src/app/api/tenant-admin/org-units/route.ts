import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantRoles, requireTenantUser } from '@/lib/auth/tenantAccess'

export const dynamic = 'force-dynamic'

/**
 * Tenant organizational hierarchy: Schools (roots) and the Departments beneath
 * them. Reading is open to any tenant user (the faculty filters need it);
 * mutating is restricted to tenant admins.
 */

const createSchema = z.object({
  kind: z.enum(['SCHOOL', 'DEPARTMENT']),
  name: z.string().trim().min(1, 'Name is required').max(200),
  code: z.string().trim().max(50).optional().nullable(),
  parentId: z.string().trim().optional().nullable(),
})

export async function GET(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const units = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: context.tenantId },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true, kind: true, parent_id: true, is_active: true },
  })

  const counts = await prisma.researcherProfile.groupBy({
    by: ['org_unit_id'],
    where: { org_unit_id: { in: units.map((unit) => unit.id) } },
    _count: { _all: true },
  })
  const countByUnit = new Map(counts.map((entry) => [entry.org_unit_id, entry._count._all]))

  const departmentsBySchool = new Map<string, any[]>()
  for (const unit of units) {
    if (unit.kind !== 'DEPARTMENT' || !unit.parent_id) {
      continue
    }
    const list = departmentsBySchool.get(unit.parent_id) || []
    list.push({
      id: unit.id,
      name: unit.name,
      code: unit.code,
      isActive: unit.is_active,
      facultyCount: countByUnit.get(unit.id) || 0,
    })
    departmentsBySchool.set(unit.parent_id, list)
  }

  const schools = units
    .filter((unit) => unit.kind === 'SCHOOL')
    .map((unit) => {
      const departments = departmentsBySchool.get(unit.id) || []
      return {
        id: unit.id,
        name: unit.name,
        code: unit.code,
        isActive: unit.is_active,
        departments,
        facultyCount: departments.reduce((sum, dept) => sum + dept.facultyCount, 0),
      }
    })

  return NextResponse.json({ schools })
}

export async function POST(request: NextRequest) {
  const context = await requireTenantRoles(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
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

  const { kind, name, code } = payload
  let parentId: string | null = null

  if (kind === 'DEPARTMENT') {
    if (!payload.parentId) {
      return NextResponse.json({ error: 'A department must belong to a school.' }, { status: 400 })
    }
    const parent = await prisma.tenantOrgUnit.findFirst({
      where: { id: payload.parentId, tenant_id: context.tenantId, kind: 'SCHOOL' },
      select: { id: true },
    })
    if (!parent) {
      return NextResponse.json({ error: 'Parent school not found.' }, { status: 404 })
    }
    parentId = parent.id
  }

  // Postgres treats NULLs as distinct, so the DB unique constraint cannot cover
  // school names — enforce case-insensitive uniqueness here for both kinds.
  const duplicate = await prisma.tenantOrgUnit.findFirst({
    where: {
      tenant_id: context.tenantId,
      kind,
      parent_id: parentId,
      name: { equals: name, mode: 'insensitive' },
    },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: `A ${kind.toLowerCase()} named "${name}" already exists here.` },
      { status: 409 }
    )
  }

  const unit = await prisma.tenantOrgUnit.create({
    data: { tenant_id: context.tenantId, kind, name, code: code || null, parent_id: parentId },
    select: { id: true, name: true, code: true, kind: true, parent_id: true, is_active: true },
  })

  return NextResponse.json({ unit }, { status: 201 })
}
