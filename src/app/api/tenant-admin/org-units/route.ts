import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  TENANT_SCOPED_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
  requireTenantUser,
} from '@/lib/auth/tenantAccess'
import {
  MAX_ORG_DEPTH,
  buildTree,
  kindForDepth,
  levelNameForDepth,
  listOrgUnits,
  loadLevelNames,
} from '@/lib/orgUnits/tree'

export const dynamic = 'force-dynamic'

/**
 * Tenant organizational hierarchy of arbitrary depth. Reading is open to any
 * tenant user (the faculty and matching filters need it); mutating is
 * restricted to tenant admins.
 *
 * Response shape: `units` is the flat, depth-aware list every new caller should
 * use, and `tree` is the same data nested. `schools` is the legacy two-level
 * shape, still emitted so existing clients keep working while they migrate —
 * it necessarily omits anything below depth 1.
 */

const createSchema = z.object({
  // `kind` is accepted for backward compatibility but no longer drives
  // structure — depth does. A caller that sends it is not contradicted.
  kind: z.enum(['SCHOOL', 'DEPARTMENT']).optional(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  code: z.string().trim().max(50).optional().nullable(),
  parentId: z.string().trim().optional().nullable(),
  levelLabel: z.string().trim().max(60).optional().nullable(),
})

export async function GET(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const [units, levels] = await Promise.all([
    listOrgUnits(context.tenantId),
    loadLevelNames(context.tenantId),
  ])
  const tree = buildTree(units)

  // Legacy two-level projection. Depth-2+ units are intentionally absent here;
  // their faculty are still counted through the roll-up on their ancestors.
  const schools = tree.map((root) => ({
    id: root.id,
    name: root.name,
    code: root.code,
    isActive: root.isActive,
    facultyCount: root.rollupFacultyCount,
    departments: root.children.map((child) => ({
      id: child.id,
      name: child.name,
      code: child.code,
      isActive: child.isActive,
      facultyCount: child.rollupFacultyCount,
    })),
  }))

  return NextResponse.json({
    units,
    tree,
    schools,
    levels: Array.from(levels.entries())
      .sort(([a], [b]) => a - b)
      .map(([depth, name]) => ({ depth, singularName: name })),
    maxDepth: MAX_ORG_DEPTH,
  })
}

export async function POST(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
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

  const { name, code } = payload

  // A caller that explicitly says "this is a DEPARTMENT" but names no parent is
  // stating an intent we cannot satisfy — silently making it a root would be a
  // surprise. New callers simply omit `kind` and let depth follow the parent.
  if (payload.kind === 'DEPARTMENT' && !payload.parentId) {
    return NextResponse.json({ error: 'A department must belong to a school.' }, { status: 400 })
  }

  let parentId: string | null = null
  let depth = 0

  // Any unit may parent any other; depth is derived from the parent rather than
  // from a fixed SCHOOL/DEPARTMENT vocabulary.
  if (payload.parentId) {
    const parent = await prisma.tenantOrgUnit.findFirst({
      where: { id: payload.parentId, tenant_id: context.tenantId },
      select: { id: true, depth: true },
    })
    if (!parent) {
      return NextResponse.json({ error: 'Parent unit not found.' }, { status: 404 })
    }
    if (parent.depth + 1 > MAX_ORG_DEPTH - 1) {
      return NextResponse.json(
        { error: `The hierarchy is limited to ${MAX_ORG_DEPTH} levels.` },
        { status: 400 }
      )
    }
    parentId = parent.id
    depth = parent.depth + 1
  }

  // Postgres treats NULLs as distinct, so the composite unique cannot cover
  // roots — enforce case-insensitive sibling uniqueness here at every level.
  const duplicate = await prisma.tenantOrgUnit.findFirst({
    where: {
      tenant_id: context.tenantId,
      parent_id: parentId,
      name: { equals: name, mode: 'insensitive' },
    },
    select: { id: true },
  })
  if (duplicate) {
    const levels = await loadLevelNames(context.tenantId)
    const label = payload.levelLabel || levelNameForDepth(depth, levels)
    return NextResponse.json(
      { error: `A ${label.toLowerCase()} named "${name}" already exists here.` },
      { status: 409 }
    )
  }

  // path/depth are written by the DB trigger; the depth we pass is only used
  // for the deprecated `kind` column and would be overwritten anyway.
  const unit = await prisma.tenantOrgUnit.create({
    data: {
      tenant_id: context.tenantId,
      kind: kindForDepth(depth),
      name,
      code: code || null,
      parent_id: parentId,
      level_label: payload.levelLabel || null,
    },
    select: {
      id: true,
      name: true,
      code: true,
      kind: true,
      parent_id: true,
      depth: true,
      path: true,
      level_label: true,
      is_active: true,
    },
  })

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: context.user.id,
        tenantId: context.tenantId,
        action: 'ORG_UNIT_CREATE',
        resource: `tenant_org_unit:${unit.id}`,
        meta: { name, code: code || null, parentId, depth: unit.depth },
      },
    })
  } catch (err) {
    console.warn('Org unit create: audit log failed', err)
  }

  return NextResponse.json(
    {
      unit: {
        id: unit.id,
        name: unit.name,
        code: unit.code,
        kind: unit.kind,
        parentId: unit.parent_id,
        depth: unit.depth,
        path: unit.path,
        levelLabel: unit.level_label,
        isActive: unit.is_active,
      },
    },
    { status: 201 }
  )
}
