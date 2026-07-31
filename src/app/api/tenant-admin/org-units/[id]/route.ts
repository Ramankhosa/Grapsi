import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  TENANT_SCOPED_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
} from '@/lib/auth/tenantAccess'
import { indexPendingFacultyEmbeddings } from '@/lib/services/facultyImportService'

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

  // Keep the denormalized names on faculty profiles in step with the rename,
  // and invalidate their cached embedding text so the next index pass re-runs
  // (school/department are baked into buildResearcherProfileNormalizedText).
  const affectedProfileIds: string[] = []
  if (payload.name) {
    const wasRenamed = updated.name !== unit.name

    if (updated.kind === 'DEPARTMENT') {
      await prisma.researcherProfile.updateMany({
        where: { org_unit_id: updated.id },
        data: { department: updated.name },
      })
      // Also cover school-only rows attached directly to this unit's parent
      // when this is a department under one — no, this branch only affects
      // department-scoped rows.
      if (wasRenamed) {
        const affected = await prisma.researcherProfile.findMany({
          where: { org_unit_id: updated.id },
          select: { user_id: true },
        })
        affectedProfileIds.push(...affected.map((row) => row.user_id))
        await prisma.researcherProfile.updateMany({
          where: { org_unit_id: updated.id },
          data: { normalized_text: null, content_hash: null },
        })
      }
    } else {
      const departmentIds = (
        await prisma.tenantOrgUnit.findMany({
          where: { parent_id: updated.id },
          select: { id: true },
        })
      ).map((department) => department.id)
      // Include the school itself so school-only profiles get their `school`
      // field refreshed too.
      const scopedUnitIds = [updated.id, ...departmentIds]
      await prisma.researcherProfile.updateMany({
        where: { org_unit_id: { in: scopedUnitIds } },
        data: { school: updated.name },
      })
      if (wasRenamed) {
        const affected = await prisma.researcherProfile.findMany({
          where: { org_unit_id: { in: scopedUnitIds } },
          select: { user_id: true },
        })
        affectedProfileIds.push(...affected.map((row) => row.user_id))
        if (scopedUnitIds.length > 0) {
          await prisma.researcherProfile.updateMany({
            where: { org_unit_id: { in: scopedUnitIds } },
            data: { normalized_text: null, content_hash: null },
          })
        }
      }
    }
  }

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: context.user.id,
        tenantId: context.tenantId,
        action: 'ORG_UNIT_RENAME',
        resource: `tenant_org_unit:${updated.id}`,
        meta: {
          previous: { name: unit.name },
          next: { name: updated.name, code: updated.code },
          kind: updated.kind,
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
          filename: `rename:${updated.kind}:${updated.name}`,
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
