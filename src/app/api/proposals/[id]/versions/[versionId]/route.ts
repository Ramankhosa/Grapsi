import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { readVersionFile } from '@/lib/proposals/versionService'

export const dynamic = 'force-dynamic'

/**
 * Download one draft.
 *
 * Always an attachment, never cached: these are unpublished research proposals,
 * and a browser or proxy holding one is a leak waiting for a shared machine.
 * Authentication here is Bearer-only, so the client must fetch this with
 * `authFetch` and turn the blob into a download — a plain <a href> 401s.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; versionId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  try {
    const file = await readVersionFile(params.id, params.versionId)
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
    console.error('[proposals] download failed', error)
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 })
  }
}
