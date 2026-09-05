import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { PROPOSAL_UPLOAD_MAX_BYTES } from '@/lib/proposals/shared'
import { listProposalVersions, uploadProposalVersion } from '@/lib/proposals/versionService'

export const dynamic = 'force-dynamic'

/**
 * The drafts of one proposal.
 *
 * Upload is multipart because the file is the point. Everything about whether
 * this upload is allowed — the cut-off, the status, who is asking — lives in
 * the service, so the officer's override and the applicant's upload cannot
 * drift apart.
 */

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  return NextResponse.json({ versions: await listProposalVersions(params.id) })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'Attach the proposal document.' }, { status: 400 })
  }
  if (file.size > PROPOSAL_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is over the ${Math.round(PROPOSAL_UPLOAD_MAX_BYTES / 1024 / 1024)}MB limit.` },
      { status: 413 }
    )
  }

  try {
    const version = await uploadProposalVersion({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      lens: access.lens,
      fileName: file.name || 'proposal',
      mimeType: file.type || null,
      buffer: Buffer.from(await file.arrayBuffer()),
      note: String(form.get('note') || '').trim() || null,
      overrideReason: String(form.get('overrideReason') || '').trim() || null,
    })

    return NextResponse.json({ version }, { status: 201 })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] upload failed', error)
    return NextResponse.json({ error: 'Could not store that draft.' }, { status: 500 })
  }
}
