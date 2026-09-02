import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { writeFundingBufferAsset } from '@/lib/funding/storage'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Files attached to one assignment.
 *
 * Two audiences share the list: the officer, who sees everything, and the
 * assignee, who sees only what was marked visible to them. That split is why
 * the flag exists at all — an endorsement letter is theirs, an internal note on
 * why the school backed someone else is not.
 */

const MAX_BYTES = 25 * 1024 * 1024
const DOCUMENT_KINDS = ['CONCEPT_NOTE', 'ENDORSEMENT', 'PROPOSAL', 'SANCTION', 'OTHER']

async function loadAssignment(tenantId: string, id: string) {
  return prisma.callAssignment.findFirst({
    where: { id, tenant_id: tenantId },
    select: {
      id: true,
      assigned_by_user_id: true,
      assignee_org_unit_id: true,
      assignee_user_id: true,
    },
  })
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  if (!record) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const isAssignee = record.assignee_user_id === context.user.id
  const isManager = canManageAssignment(context.scope, record)
  if (!isAssignee && !isManager) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const documents = await prisma.assignmentDocument.findMany({
    where: {
      assignment_id: record.id,
      // The assignee sees only what was shared with them; a manager sees all.
      ...(isManager ? {} : { visible_to_assignee: true }),
    },
    select: {
      id: true,
      kind: true,
      file_name: true,
      mime_type: true,
      byte_size: true,
      note: true,
      visible_to_assignee: true,
      created_at: true,
      uploaded_by: { select: { id: true, name: true, email: true } },
    },
    orderBy: { created_at: 'desc' },
  })

  return NextResponse.json({
    canUpload: isManager || isAssignee,
    documents: documents.map((row) => ({
      id: row.id,
      kind: row.kind,
      fileName: row.file_name,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      note: row.note,
      visibleToAssignee: row.visible_to_assignee,
      createdAt: row.created_at,
      uploadedBy: row.uploaded_by?.name || row.uploaded_by?.email || null,
      uploadedByUserId: row.uploaded_by?.id || null,
    })),
  })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  if (!record) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const isAssignee = record.assignee_user_id === context.user.id
  const isManager = canManageAssignment(context.scope, record)
  if (!isAssignee && !isManager) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'Attach a file to upload.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is over the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit.` },
      { status: 413 }
    )
  }

  const rawKind = String(form.get('kind') || 'OTHER').toUpperCase()
  const kind = DOCUMENT_KINDS.includes(rawKind) ? rawKind : 'OTHER'
  const note = String(form.get('note') || '').trim().slice(0, 2000) || null
  // A file the assignee uploaded is theirs by definition, so the flag only
  // means anything when an officer is the one attaching it.
  const visibleToAssignee = isAssignee ? true : String(form.get('visibleToAssignee')) !== 'false'

  const buffer = Buffer.from(await file.arrayBuffer())
  const stored = await writeFundingBufferAsset({
    // One directory per assignment, mirroring the per-job layout the funding
    // intake already uses.
    jobId: `assignments/${record.id}`,
    fileName: file.name || 'document',
    buffer,
  })

  const created = await prisma.assignmentDocument.create({
    data: {
      tenant_id: context.tenantId,
      assignment_id: record.id,
      kind,
      file_name: file.name || 'document',
      mime_type: file.type || null,
      byte_size: stored.byteSize,
      storage_path: stored.storagePath,
      note,
      visible_to_assignee: visibleToAssignee,
      uploaded_by_user_id: context.user.id,
    },
    select: { id: true, file_name: true, kind: true, byte_size: true },
  })

  return NextResponse.json({ document: created }, { status: 201 })
}
