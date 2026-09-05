import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { deleteProposalDocument, readProposalDocument } from '@/lib/proposals/documentService'
import { ProposalError } from '@/lib/proposals/proposalService'
import { lensCanManage, lensSeesInternal } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * Download one issued letter, or withdraw it.
 *
 * Always an attachment and never cached: an endorsement letter carries a
 * signature and a reference number, and a proxy holding a copy is a problem on
 * a shared machine. Auth is Bearer-only, so the client fetches this with
 * `authFetch` and saves the blob.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  try {
    const file = await readProposalDocument(
      params.id,
      params.documentId,
      lensSeesInternal(access.lens)
    )
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        'Content-Length': String(file.buffer.length),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] document download failed', error)
    return NextResponse.json({ error: 'Could not read that document.' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json({ error: 'Only the funding department can do that.' }, { status: 403 })
  }

  try {
    await deleteProposalDocument({
      tenantId: context.tenantId,
      proposalId: params.id,
      documentId: params.documentId,
      actorUserId: context.user.id,
    })
    return NextResponse.json({ withdrawn: true })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] document withdraw failed', error)
    return NextResponse.json({ error: 'Could not withdraw that document.' }, { status: 500 })
  }
}
