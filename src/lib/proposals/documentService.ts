/**
 * The paper the institution issues on a proposal.
 *
 * The endorsement letter is the one that matters most: an applicant usually
 * cannot submit without it, and it is almost always a signed sheet somebody
 * scanned. That is why this accepts images as well as PDFs — refusing a phone
 * photograph of a signed letter would send the whole exchange back to email,
 * which is where this record was lost before.
 *
 * Direction is what separates this from `versionService`. A version is the
 * applicant's work coming in; this is the institution's paper going out.
 */
import crypto from 'crypto'
import fs from 'fs/promises'

import { proposalDocumentIssuedTemplate } from '@/lib/email-templates'
import { readFundingAssetBuffer, writeFundingBufferAsset } from '@/lib/funding/storage'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'

import { recordProposalEvent } from './events'
import { emailProposalRecipients, recipientsFor } from './notify'
import { ProposalError } from './proposalService'
import {
  PROPOSAL_DOCUMENT_LABELS,
  serializeProposalDocument,
  type ProposalDocumentKind,
} from './shared'
import { proposalTeamUserIds } from './teamService'

/** 25MB, matching the draft upload — a scanned letter is rarely near it. */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024

/**
 * Scans arrive as PDFs from a copier and as JPEG or PNG from a phone. Both are
 * the same letter; only `.doc` is refused, for the same reason drafts refuse it.
 */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.docx'] as const

export interface IssueDocumentInput {
  tenantId: string
  proposalId: string
  actorUserId: string
  kind: ProposalDocumentKind
  title?: string | null
  referenceNo?: string | null
  issuedOn?: Date | null
  signedBy?: string | null
  note?: string | null
  visibleToFaculty?: boolean
  fileName: string
  mimeType?: string | null
  buffer: Buffer
}

export async function issueProposalDocument(input: IssueDocumentInput) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: { id: true, tenant_id: true, title: true, agency_name: true },
  })
  if (!proposal) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const name = (input.fileName || 'document').trim()
  const lower = name.toLowerCase()
  if (lower.endsWith('.doc')) {
    throw new ProposalError(
      'Legacy .doc files cannot be read. Save it as a PDF or .docx, or scan the signed copy.',
      400,
      'LEGACY_DOC'
    )
  }
  if (!DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new ProposalError(
      `Upload a PDF, a scan (JPG/PNG) or a Word file. Accepted: ${DOCUMENT_EXTENSIONS.join(', ')}.`,
      400,
      'UNSUPPORTED_TYPE'
    )
  }
  if (input.buffer.length === 0) throw new ProposalError('That file is empty.', 400, 'EMPTY_FILE')
  if (input.buffer.length > DOCUMENT_MAX_BYTES) {
    throw new ProposalError(
      `That file is over the ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)}MB limit.`,
      413,
      'TOO_LARGE'
    )
  }

  // Re-issuing the identical file is almost always a double-click, not a second
  // letter. Same rule as a draft, for the same reason.
  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex')
  const duplicate = await prisma.grantProposalDocument.findFirst({
    where: { proposal_id: proposal.id, kind: input.kind },
    orderBy: { created_at: 'desc' },
    select: { id: true, storage_path: true, title: true },
  })
  if (duplicate) {
    try {
      const existing = await readFundingAssetBuffer(duplicate.storage_path)
      if (crypto.createHash('sha256').update(existing).digest('hex') === sha256) {
        throw new ProposalError(
          `That is the same file as the ${duplicate.title} already issued.`,
          409,
          'DUPLICATE_FILE'
        )
      }
    } catch (error) {
      // A missing previous file is not a reason to refuse the new one.
      if (error instanceof ProposalError) throw error
    }
  }

  const stored = await writeFundingBufferAsset({
    jobId: `proposals/${proposal.id}/issued`,
    fileName: name,
    buffer: input.buffer,
  })

  const visible = input.visibleToFaculty !== false
  const title =
    input.title?.trim() || PROPOSAL_DOCUMENT_LABELS[input.kind] || 'Document'

  try {
    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.grantProposalDocument.create({
        data: {
          tenant_id: proposal.tenant_id,
          proposal_id: proposal.id,
          kind: input.kind,
          title: title.slice(0, 300),
          reference_no: input.referenceNo?.trim().slice(0, 120) || null,
          issued_on: input.issuedOn || new Date(),
          signed_by: input.signedBy?.trim().slice(0, 200) || null,
          file_name: name.slice(0, 300),
          mime_type: input.mimeType || null,
          byte_size: stored.byteSize,
          storage_path: stored.storagePath,
          note: input.note?.trim().slice(0, 2000) || null,
          visible_to_faculty: visible,
          issued_by_user_id: input.actorUserId,
        },
        include: { issued_by: { select: { id: true, name: true, email: true } } },
      })

      // An endorsement letter is usually a checklist line in its own right.
      // Ticking it here means the officer does not record the same fact twice.
      const matching = await tx.grantProposalChecklistItem.findFirst({
        where: {
          proposal_id: proposal.id,
          status: 'PENDING',
          document_id: null,
          label: { contains: input.kind === 'ENDORSEMENT' ? 'ndorsement' : title.slice(0, 20) },
        },
        select: { id: true },
      })
      if (matching) {
        await tx.grantProposalChecklistItem.update({
          where: { id: matching.id },
          data: {
            status: 'DONE',
            document_id: document.id,
            completed_by_user_id: input.actorUserId,
            completed_at: new Date(),
          },
        })
      }

      await recordProposalEvent(tx, {
        tenantId: proposal.tenant_id,
        proposalId: proposal.id,
        actorUserId: input.actorUserId,
        kind: 'DOCUMENT_ISSUED',
        payload: {
          documentKind: input.kind,
          title: document.title,
          referenceNo: document.reference_no,
          tickedChecklist: Boolean(matching),
        },
        // The applicant is told about a letter meant for them, and not about
        // an internal file copy.
        visibleToFaculty: visible,
      })

      return document
    })

    if (visible) await notifyOfDocument(proposal, created, input.actorUserId)

    return serializeProposalDocument(created)
  } catch (error) {
    await fs.unlink(stored.storagePath).catch(() => undefined)
    throw error
  }
}

async function notifyOfDocument(proposal: any, document: any, actorUserId: string) {
  try {
    const recipientIds = (await proposalTeamUserIds(proposal.id)).filter((id) => id !== actorUserId)
    if (!recipientIds.length) return

    await notifyQuietly({
      tenantId: proposal.tenant_id,
      userIds: recipientIds,
      title: `${document.title} issued`,
      body: `${proposal.title}${document.reference_no ? ` — ${document.reference_no}` : ''}. Download it from your proposal.`,
      category: 'PROPOSAL',
      linkUrl: `/proposals/${proposal.id}`,
      createdByUserId: actorUserId,
    })

    await emailProposalRecipients(proposal.tenant_id, await recipientsFor(recipientIds), (recipient) =>
      proposalDocumentIssuedTemplate({
        email: recipient.email,
        name: recipient.name,
        proposalTitle: proposal.title,
        documentTitle: document.title,
        referenceNo: document.reference_no,
        issuedOn: document.issued_on ? new Date(document.issued_on).toDateString() : null,
        signedBy: document.signed_by,
        proposalId: proposal.id,
      })
    )
  } catch (error) {
    console.error('[proposals] could not notify of an issued document', error)
  }
}

export async function listProposalDocuments(proposalId: string, includeInternal: boolean) {
  const rows = await prisma.grantProposalDocument.findMany({
    where: {
      proposal_id: proposalId,
      ...(includeInternal ? {} : { visible_to_faculty: true }),
    },
    orderBy: { created_at: 'desc' },
    include: { issued_by: { select: { id: true, name: true, email: true } } },
  })
  return rows.map(serializeProposalDocument)
}

export interface DocumentFile {
  fileName: string
  mimeType: string
  buffer: Buffer
}

export async function readProposalDocument(
  proposalId: string,
  documentId: string,
  includeInternal: boolean
): Promise<DocumentFile> {
  const document = await prisma.grantProposalDocument.findFirst({
    where: {
      id: documentId,
      proposal_id: proposalId,
      ...(includeInternal ? {} : { visible_to_faculty: true }),
    },
    select: { file_name: true, mime_type: true, storage_path: true },
  })
  if (!document) throw new ProposalError('That document was not found.', 404, 'NOT_FOUND')

  try {
    return {
      fileName: document.file_name,
      mimeType: document.mime_type || 'application/octet-stream',
      buffer: await readFundingAssetBuffer(document.storage_path),
    }
  } catch {
    throw new ProposalError(
      'The stored file is no longer on disk. Issue the document again.',
      410,
      'FILE_MISSING'
    )
  }
}

/**
 * Withdraw a document. Deliberately a real delete rather than a flag: a letter
 * issued in error and left on the record is worse than no letter, because the
 * applicant may have already attached it to a submission.
 */
export async function deleteProposalDocument(input: {
  tenantId: string
  proposalId: string
  documentId: string
  actorUserId: string
}) {
  const document = await prisma.grantProposalDocument.findFirst({
    where: { id: input.documentId, proposal_id: input.proposalId },
    select: { id: true, title: true, storage_path: true, kind: true },
  })
  if (!document) throw new ProposalError('That document was not found.', 404, 'NOT_FOUND')

  await prisma.$transaction(async (tx) => {
    await tx.grantProposalDocument.delete({ where: { id: document.id } })
    await recordProposalEvent(tx, {
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
      kind: 'DOCUMENT_ISSUED',
      payload: { withdrawn: true, title: document.title, documentKind: document.kind },
    })
  })

  await fs.unlink(document.storage_path).catch(() => undefined)
}
