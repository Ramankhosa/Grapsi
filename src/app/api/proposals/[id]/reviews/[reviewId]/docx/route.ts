import fs from 'fs/promises'

import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { loadSharedReport } from '@/lib/proposals/shareService'
import { lensCanManage } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * The review as a Word document.
 *
 * Served from the file written at share time, never regenerated: an applicant
 * downloading it a month later must get the document they were sent, not a
 * fresh one that bills the tenant and might read differently.
 *
 * Bearer-only auth, so the client must fetch this with `authFetch` and turn the
 * blob into a download.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; reviewId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  try {
    const review = await loadSharedReport(params.id, params.reviewId)
    if (!review.shared_at && !lensCanManage(access.lens)) {
      return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    }
    if (!review.docx_storage_path) {
      return NextResponse.json(
        { error: 'No document was produced for this review.', code: 'NO_DOCX' },
        { status: 404 }
      )
    }

    let buffer: Buffer
    try {
      buffer = await fs.readFile(review.docx_storage_path)
    } catch {
      return NextResponse.json(
        { error: 'The stored document is no longer on disk.', code: 'FILE_MISSING' },
        { status: 410 }
      )
    }

    const fileName = `grant-review-v${review.version?.version_no ?? 1}.docx`
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] docx read failed', error)
    return NextResponse.json({ error: 'Could not read the document.' }, { status: 500 })
  }
}
