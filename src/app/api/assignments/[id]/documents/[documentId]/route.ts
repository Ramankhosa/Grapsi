import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** Download or remove one attached file. */

async function authorize(request: NextRequest, assignmentId: string, documentId: string) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return { error: context.error, status: context.status } as const

  const document = await prisma.assignmentDocument.findFirst({
    where: { id: documentId, assignment_id: assignmentId, tenant_id: context.tenantId },
    select: {
      id: true,
      file_name: true,
      mime_type: true,
      storage_path: true,
      visible_to_assignee: true,
      uploaded_by_user_id: true,
      assignment: {
        select: {
          id: true,
          assigned_by_user_id: true,
          assignee_org_unit_id: true,
          assignee_user_id: true,
        },
      },
    },
  })
  if (!document) return { error: 'File not found.', status: 404 } as const

  const isManager = canManageAssignment(context.scope, document.assignment)
  const isAssignee = document.assignment.assignee_user_id === context.user.id
  // An assignee may not reach a file that was never shared with them, and the
  // answer is 404 rather than 403 so its existence stays hidden.
  if (!isManager && !(isAssignee && document.visible_to_assignee)) {
    return { error: 'File not found.', status: 404 } as const
  }

  return { context, document, isManager, isAssignee } as const
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
) {
  const auth = await authorize(request, params.id, params.documentId)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let buffer: Buffer
  try {
    buffer = await fs.readFile(auth.document.storage_path)
  } catch {
    return NextResponse.json(
      { error: 'That file is recorded but missing from storage.' },
      { status: 410 }
    )
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': auth.document.mime_type || 'application/octet-stream',
      // attachment, not inline: an uploaded HTML or SVG rendered on our own
      // origin would run with the viewer's session.
      'Content-Disposition': `attachment; filename="${encodeURIComponent(auth.document.file_name)}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'private, no-store',
    },
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
) {
  const auth = await authorize(request, params.id, params.documentId)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Whoever uploaded it, or anyone managing the assignment.
  const canDelete =
    auth.isManager || auth.document.uploaded_by_user_id === auth.context.user.id
  if (!canDelete) {
    return NextResponse.json({ error: 'You cannot remove that file.' }, { status: 403 })
  }

  await prisma.assignmentDocument.delete({ where: { id: auth.document.id } })
  // Best effort: the row is the record, and a stranded file is better than a
  // failed delete that leaves the row pointing at nothing.
  await fs.rm(auth.document.storage_path, { force: true }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}
