/**
 * Word (ATR) download of an archived grant-reviewer report.
 *
 * `refresh: false` is the point of this route: an administrator reading someone
 * else's report must not trigger a regeneration, which would bill the tenant's
 * LLM quota for a page view. A stale report is exported as it stands and the
 * document carries no regeneration notice it did not earn.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireArchiveViewer, scopeAllows } from '@/lib/reportsArchive/access'
import { loadReviewerReport } from '@/lib/reportsArchive/query'
import { buildAtrForCall } from '@/lib/reviewer/atrExport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const viewer = await requireArchiveViewer(request)
  if ('response' in viewer) return viewer.response

  try {
    const report = await loadReviewerReport(params.callId)
    if (!report || !scopeAllows(viewer.scope, report.tenantId)) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    }

    const result = await buildAtrForCall(params.callId, { refresh: false })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.code ? { code: result.code } : {}) },
        { status: result.status }
      )
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    })
  } catch (error) {
    console.error('Report archive ATR export failed:', error)
    return NextResponse.json({ error: 'Could not build the Word export.' }, { status: 500 })
  }
}
