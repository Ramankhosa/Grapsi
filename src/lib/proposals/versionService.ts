/**
 * Uploading and reading proposal drafts.
 *
 * Versions are append-only. A revision never overwrites the draft the office
 * already reviewed, because the review that was sent back has to keep pointing
 * at the text it judged — otherwise "you did not address point 3" becomes
 * unanswerable six weeks later.
 */
import crypto from 'crypto'
import fs from 'fs/promises'

import type { Prisma } from '@prisma/client'

import { isMemberAway, schoolRootFor } from '@/lib/fundingDept/shared'
import { readFundingAssetBuffer, writeFundingBufferAsset } from '@/lib/funding/storage'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'

import { proposalVersionUploadedTemplate } from '@/lib/email-templates'

import { recordProposalEvent } from './events'
import { emailProposalRecipients, recipientsFor } from './notify'
import { getProposalSettings } from './settings'
import { ProposalError } from './proposalService'
import {
  PROPOSAL_UPLOAD_EXTENSIONS,
  PROPOSAL_UPLOAD_MAX_BYTES,
  serializeVersion,
  type ProposalLens,
  type ProposalStatus,
} from './shared'
import { validateVersionUpload } from './statusMachine'

/**
 * Legacy Word is OLE2, not a zip: the text extractor reads it as UTF-8 and
 * imports binary noise, so it is refused with the fix rather than accepted and
 * silently reviewed as garbage.
 */
const LEGACY_DOC_MESSAGE =
  'Legacy .doc files cannot be read. Open it in Word and use “Save As” to make a .docx, then upload that.'

export interface UploadVersionInput {
  tenantId: string
  proposalId: string
  actorUserId: string
  lens: ProposalLens
  fileName: string
  mimeType?: string | null
  buffer: Buffer
  note?: string | null
  overrideReason?: string | null
}

export async function uploadProposalVersion(input: UploadVersionInput) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: {
      id: true,
      tenant_id: true,
      title: true,
      status: true,
      review_cutoff_at: true,
      current_version_no: true,
      org_unit_id: true,
      pi_user_id: true,
    },
  })
  if (!proposal) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const name = (input.fileName || 'proposal').trim()
  const lower = name.toLowerCase()
  if (lower.endsWith('.doc')) {
    throw new ProposalError(LEGACY_DOC_MESSAGE, 400, 'LEGACY_DOC')
  }
  if (!PROPOSAL_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new ProposalError(
      `Upload a PDF or a Word (.docx) file. Accepted: ${PROPOSAL_UPLOAD_EXTENSIONS.join(', ')}.`,
      400,
      'UNSUPPORTED_TYPE'
    )
  }
  if (input.buffer.length === 0) {
    throw new ProposalError('That file is empty.', 400, 'EMPTY_FILE')
  }
  if (input.buffer.length > PROPOSAL_UPLOAD_MAX_BYTES) {
    throw new ProposalError(
      `That file is over the ${Math.round(PROPOSAL_UPLOAD_MAX_BYTES / 1024 / 1024)}MB limit.`,
      413,
      'TOO_LARGE'
    )
  }

  // One rule for both doors: the applicant's upload and the officer's override
  // go through the same gate, so an exception is always the recorded kind.
  const settings = await getProposalSettings(proposal.tenant_id)
  const gate = validateVersionUpload({
    status: proposal.status as ProposalStatus,
    lens: input.lens,
    reviewCutoffAt: proposal.review_cutoff_at,
    cutoffEnabled: settings.cutoffEnabled,
    overrideReason: input.overrideReason,
  })
  if (!gate.ok) {
    throw new ProposalError(gate.error, gate.error.includes('cut-off') ? 403 : 400, 'UPLOAD_BLOCKED')
  }

  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex')
  const duplicate = await prisma.grantProposalVersion.findFirst({
    where: { proposal_id: proposal.id, sha256 },
    select: { version_no: true },
  })
  if (duplicate) {
    throw new ProposalError(
      `That is the same file as version ${duplicate.version_no}. Upload the revised document.`,
      409,
      'DUPLICATE_FILE'
    )
  }

  // Write the bytes before opening the transaction: a file write inside a tx
  // holds the advisory lock for as long as the disk takes, and the default
  // 5s transaction budget is not the place to find that out.
  const stored = await writeFundingBufferAsset({
    jobId: `proposals/${proposal.id}`,
    fileName: name,
    buffer: input.buffer,
  })

  const pastCutoff = Boolean(
    settings.cutoffEnabled &&
      proposal.review_cutoff_at &&
      proposal.review_cutoff_at.getTime() < Date.now()
  )

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Two uploads landing together must not both claim version 3. The unique
      // index would catch it; the lock means the second one waits and gets 4
      // instead of failing.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`proposal-version:${proposal.id}`}))`

      const last = await tx.grantProposalVersion.findFirst({
        where: { proposal_id: proposal.id },
        orderBy: { version_no: 'desc' },
        select: { version_no: true },
      })
      const versionNo = (last?.version_no ?? 0) + 1

      const version = await tx.grantProposalVersion.create({
        data: {
          tenant_id: proposal.tenant_id,
          proposal_id: proposal.id,
          version_no: versionNo,
          file_name: name.slice(0, 300),
          mime_type: input.mimeType || null,
          byte_size: stored.byteSize,
          storage_path: stored.storagePath,
          sha256,
          note: input.note ? input.note.trim().slice(0, 2000) : null,
          override_reason: pastCutoff ? (input.overrideReason || '').trim().slice(0, 500) : null,
          review_status: 'NONE',
          uploaded_by_user_id: input.actorUserId,
        },
        include: { uploaded_by: { select: { id: true, name: true, email: true } } },
      })

      const nextStatus: ProposalStatus =
        proposal.status === 'DRAFT' || proposal.status === 'REVISION_REQUESTED'
          ? 'IN_REVIEW'
          : (proposal.status as ProposalStatus)

      await tx.grantProposal.update({
        where: { id: proposal.id },
        data: {
          current_version_no: versionNo,
          status: nextStatus,
          // A fresh draft answers the last nudge, so the ladder starts again.
          nudge_stages: [],
        },
      })

      await recordProposalEvent(tx, {
        tenantId: proposal.tenant_id,
        proposalId: proposal.id,
        actorUserId: input.actorUserId,
        kind: 'VERSION_UPLOADED',
        fromStatus: proposal.status,
        toStatus: nextStatus,
        payload: {
          versionNo,
          fileName: version.file_name,
          note: version.note,
          lateOverride: pastCutoff ? version.override_reason : null,
        },
      })

      return version
    })

    await notifyDepartmentOfUpload({
      tenantId: proposal.tenant_id,
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      schoolUnitId: proposal.org_unit_id,
      versionNo: created.version_no,
      actorUserId: input.actorUserId,
      researcherName:
        created.uploaded_by?.name || created.uploaded_by?.email || 'A researcher',
      note: created.note,
    })

    return serializeVersion(created)
  } catch (error) {
    // The row never landed, so the bytes on disk are litter.
    await fs.unlink(stored.storagePath).catch(() => undefined)
    throw error
  }
}

/**
 * Tell the officer who actually answers for this school, routing to the deputy
 * while the primary is away. The assigner is told by the assignment routes and
 * is frequently not the covering officer.
 */
async function notifyDepartmentOfUpload(input: {
  tenantId: string
  proposalId: string
  proposalTitle: string
  schoolUnitId: string
  versionNo: number
  actorUserId: string
  researcherName: string
  note: string | null
}) {
  try {
    const rootId = (await schoolRootFor(input.schoolUnitId)) || input.schoolUnitId
    const coverage = await prisma.fundingDeptSchoolAssignment.findMany({
      where: { tenant_id: input.tenantId, org_unit_id: rootId, member: { is_active: true } },
      select: {
        is_deputy: true,
        member: {
          select: { user_id: true, away_from: true, away_until: true },
        },
      },
    })

    const primaries = coverage.filter((row) => !row.is_deputy)
    const deputies = coverage.filter((row) => row.is_deputy)

    const recipients = new Set<string>()
    for (const row of primaries) {
      if (!row.member?.user_id) continue
      if (isMemberAway(row.member)) {
        // Away: hand it to whoever is covering, rather than to an inbox nobody
        // is reading this fortnight.
        for (const deputy of deputies) {
          if (deputy.member?.user_id) recipients.add(deputy.member.user_id)
        }
      } else {
        recipients.add(row.member.user_id)
      }
    }
    if (recipients.size === 0) {
      for (const deputy of deputies) {
        if (deputy.member?.user_id) recipients.add(deputy.member.user_id)
      }
    }

    const head = await prisma.fundingDeptMember.findFirst({
      where: { tenant_id: input.tenantId, is_head: true, is_active: true },
      select: { user_id: true },
    })
    if (recipients.size === 0 && head?.user_id) recipients.add(head.user_id)

    recipients.delete(input.actorUserId)
    if (recipients.size === 0) return

    await notifyQuietly({
      tenantId: input.tenantId,
      userIds: Array.from(recipients),
      title: `Proposal draft v${input.versionNo} ready to review`,
      body: `${input.proposalTitle}`,
      category: 'PROPOSAL',
      linkUrl: `/funding-dept/proposals/${input.proposalId}`,
      createdByUserId: input.actorUserId,
    })

    await emailProposalRecipients(
      input.tenantId,
      await recipientsFor(Array.from(recipients)),
      (recipient) =>
        proposalVersionUploadedTemplate({
          email: recipient.email,
          name: recipient.name,
          proposalTitle: input.proposalTitle,
          researcherName: input.researcherName,
          versionNo: input.versionNo,
          note: input.note,
          proposalId: input.proposalId,
        })
    )
  } catch (error) {
    console.error('[proposals] could not notify the department of an upload', error)
  }
}

export async function listProposalVersions(proposalId: string) {
  const rows = await prisma.grantProposalVersion.findMany({
    where: { proposal_id: proposalId },
    orderBy: { version_no: 'desc' },
    include: { uploaded_by: { select: { id: true, name: true, email: true } } },
  })
  return rows.map(serializeVersion)
}

export interface VersionFile {
  fileName: string
  mimeType: string
  buffer: Buffer
}

/**
 * The bytes back. A row whose file has gone is a 410, not a 404: the difference
 * between "no such draft" and "the draft is recorded but the file is missing"
 * is the difference between a typo and a backup problem.
 */
export async function readVersionFile(proposalId: string, versionId: string): Promise<VersionFile> {
  const version = await prisma.grantProposalVersion.findFirst({
    where: { id: versionId, proposal_id: proposalId },
    select: { file_name: true, mime_type: true, storage_path: true },
  })
  if (!version) throw new ProposalError('That version was not found.', 404, 'NOT_FOUND')

  try {
    const buffer = await readFundingAssetBuffer(version.storage_path)
    return {
      fileName: version.file_name,
      mimeType: version.mime_type || 'application/octet-stream',
      buffer,
    }
  } catch {
    throw new ProposalError(
      'The stored file is no longer on disk. Ask the applicant to upload it again.',
      410,
      'FILE_MISSING'
    )
  }
}

/** Set the denormalised review state on a version. */
export async function setVersionReviewStatus(
  tx: Prisma.TransactionClient | typeof prisma,
  versionId: string,
  reviewStatus: string
) {
  await tx.grantProposalVersion.update({
    where: { id: versionId },
    data: { review_status: reviewStatus },
  })
}
