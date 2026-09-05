import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import {
  DOCUMENT_MAX_BYTES,
  issueProposalDocument,
  listProposalDocuments,
} from '@/lib/proposals/documentService'
import { ProposalError } from '@/lib/proposals/proposalService'
import { getProposalSettings } from '@/lib/proposals/settings'
import {
  lensCanManage,
  lensSeesInternal,
  PROPOSAL_DOCUMENT_KINDS,
  type ProposalDocumentKind,
} from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * The letters the institution issues on a proposal.
 *
 * Multipart, because these are almost always a signed sheet somebody scanned.
 * The applicant sees what was meant for them; an internal file copy stays with
 * the department.
 */

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  return NextResponse.json({
    documents: await listProposalDocuments(params.id, lensSeesInternal(access.lens)),
  })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json({ error: 'Only the funding department issues letters.' }, { status: 403 })
  }

  const settings = await getProposalSettings(context.tenantId)
  if (!settings.endorsementEnabled) {
    return NextResponse.json(
      {
        error: 'Endorsement letters are switched off for this institution.',
        code: 'FEATURE_DISABLED',
      },
      { status: 403 }
    )
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'Attach the signed letter.' }, { status: 400 })
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is over the ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)}MB limit.` },
      { status: 413 }
    )
  }

  const rawKind = String(form.get('kind') || 'ENDORSEMENT').toUpperCase()
  const kind = (PROPOSAL_DOCUMENT_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as ProposalDocumentKind)
    : 'OTHER'

  const issuedOnRaw = String(form.get('issuedOn') || '').trim()
  const issuedOn = issuedOnRaw ? new Date(issuedOnRaw) : null
  if (issuedOn && !Number.isFinite(issuedOn.getTime())) {
    return NextResponse.json({ error: 'That issue date is not valid.' }, { status: 400 })
  }

  try {
    const document = await issueProposalDocument({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      kind,
      title: String(form.get('title') || '').trim() || null,
      referenceNo: String(form.get('referenceNo') || '').trim() || null,
      issuedOn,
      signedBy: String(form.get('signedBy') || '').trim() || null,
      note: String(form.get('note') || '').trim() || null,
      visibleToFaculty: String(form.get('visibleToFaculty')) !== 'false',
      fileName: file.name || 'letter',
      mimeType: file.type || null,
      buffer: Buffer.from(await file.arrayBuffer()),
    })

    return NextResponse.json({ document }, { status: 201 })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] could not issue a document', error)
    return NextResponse.json({ error: 'Could not issue that document.' }, { status: 500 })
  }
}
