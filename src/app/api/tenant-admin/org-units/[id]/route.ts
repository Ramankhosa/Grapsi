import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  TENANT_SCOPED_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
} from '@/lib/auth/tenantAccess'
import { indexPendingFacultyEmbeddings } from '@/lib/services/facultyImportService'
import {
  OrgTreeError,
  assertReparentAllowed,
  refreshSubtreeProfileLabels,
} from '@/lib/orgUnits/tree'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  code: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
  levelLabel: z.string().trim().max(60).nullable().optional(),
  /** Move the unit (and its whole subtree) under a different parent, or to the
   *  root with null. The DB trigger rewrites every descendant's path. */
  parentId: z.string().trim().nullable().optional(),
})

async function loadUnit(tenantId: string, id: string) {
  return prisma.tenantOrgUnit.findFirst({
    where: { id, tenant_id: tenantId },
    select: {
      id: true,
      name: true,
      kind: true,
      parent_id: true,
      is_active: true,
      depth: true,
      path: true,
    },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
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

  const isMove = payload.parentId !== undefined && payload.parentId !== unit.parent_id
  if (isMove) {
    try {
      await assertReparentAllowed(context.tenantId, unit.id, payload.parentId ?? null)
    } catch (error) {
      if (error instanceof OrgTreeError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }
  }

  // Sibling uniqueness is per-parent at every level, so it has to be checked
  // against the destination parent when the unit is also being moved.
  const targetParentId = isMove ? payload.parentId ?? null : unit.parent_id
  const targetName = payload.name || unit.name
  if (payload.name || isMove) {
    const duplicate = await prisma.tenantOrgUnit.findFirst({
      where: {
        tenant_id: context.tenantId,
        parent_id: targetParentId,
        name: { equals: targetName, mode: 'insensitive' },
        id: { not: unit.id },
      },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json(
        { error: `A unit named "${targetName}" already exists here.` },
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
      ...(payload.levelLabel !== undefined ? { level_label: payload.levelLabel } : {}),
      ...(isMove ? { parent_id: payload.parentId ?? null } : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      kind: true,
      parent_id: true,
      is_active: true,
      depth: true,
      path: true,
    },
  })

  // Keep the denormalized names on faculty profiles in step, and invalidate
  // their cached embedding text so the next index pass re-runs (school and
  // department are baked into buildResearcherProfileNormalizedText).
  //
  // A rename affects the whole subtree, not just direct children — and a move
  // re-roots the branch, changing every descendant's `school`. One path-based
  // refresh covers both at any depth.
  const wasRenamed = Boolean(payload.name) && updated.name !== unit.name
  const affectedProfileIds =
    wasRenamed || isMove ? await refreshSubtreeProfileLabels(context.tenantId, updated.id) : []

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: context.user.id,
        tenantId: context.tenantId,
        action: isMove ? 'ORG_UNIT_MOVE' : 'ORG_UNIT_RENAME',
        resource: `tenant_org_unit:${updated.id}`,
        meta: {
          previous: { name: unit.name, parentId: unit.parent_id, depth: unit.depth },
          next: { name: updated.name, code: updated.code, parentId: updated.parent_id, depth: updated.depth },
          affectedProfileCount: affectedProfileIds.length,
        },
      },
    })
  } catch (err) {
    console.warn('Org unit rename: audit log failed', err)
  }

  // Kick a detached worker to re-embed the invalidated profiles. Same
  // pattern as the faculty importer's post-response backfill.
  if (affectedProfileIds.length > 0) {
    // Create a lightweight audit job row so the worker has somewhere to flip
    // status; reuse FacultyImportJob for consistency (the "job" concept here
    // is any batch that produces pending embeddings).
    let jobId: string | null = null
    try {
      const job = await prisma.facultyImportJob.create({
        data: {
          tenant_id: context.tenantId,
          uploaded_by: context.user.id,
          filename: `${isMove ? 'move' : 'rename'}:${updated.name}`,
          total_rows: affectedProfileIds.length,
          created_count: 0,
          updated_count: 0,
          error_count: 0,
          status: 'EMBEDDING_RUNNING',
          report_json: { rename: true, unitId: updated.id, pendingUserIds: affectedProfileIds } as any,
        },
        select: { id: true },
      })
      jobId = job.id
    } catch (err) {
      console.warn('Org unit rename: could not create embedding job', err)
    }
    if (jobId) {
      void indexPendingFacultyEmbeddings(jobId, context.tenantId, affectedProfileIds).catch((err) => {
        console.error('Org unit rename: embedding worker crashed', err)
      })
    }
  }

  return NextResponse.json({ unit: updated })
}

/**
 * Deleting is blocked while anything still depends on the unit — cascading
 * would silently detach faculty from their department. Deactivate instead.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await loadUnit(context.tenantId, params.id)
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  const [childCount, facultyCount] = await Promise.all([
    prisma.tenantOrgUnit.count({ where: { parent_id: unit.id } }),
    // Count over the whole subtree: deleting a unit whose grandchildren hold
    // faculty would strand them just as surely as its direct members.
    prisma.researcherProfile.count({
      where: { org_unit: { path: { has: unit.id } } },
    }),
  ])

  if (childCount > 0) {
    return NextResponse.json(
      { error: `"${unit.name}" still has ${childCount} sub-unit(s). Remove or move them first.` },
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

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: context.user.id,
        tenantId: context.tenantId,
        action: 'ORG_UNIT_DELETE',
        resource: `tenant_org_unit:${unit.id}`,
        meta: { kind: unit.kind, name: unit.name, parentId: unit.parent_id },
      },
    })
  } catch (err) {
    console.warn('Org unit delete: audit log failed', err)
  }

  return NextResponse.json({ success: true })
}
