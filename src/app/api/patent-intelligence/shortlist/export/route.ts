import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { shortlistExportFormatSchema } from '@/lib/patentIntelligence/schemas'
import { buildShortlistCsv, formatShortlistMarkdown } from '@/lib/patentIntelligence/searchCore'
import { enforcePatentRateLimit, patentErrorResponse } from '@/lib/patentIntelligence/service'
import { listShortlist } from '@/lib/patentIntelligence/shortlist'

export const runtime = 'nodejs'

function stamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

// Download the shortlist as CSV (spreadsheet) or Markdown (paste into the
// proposal's prior-art section). The bearer token lives in the browser's
// auth context, so the client fetches this and saves the Blob itself.
export async function GET(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  const limited = enforcePatentRateLimit(auth.actor.id, 'shortlist')
  if (limited) return limited

  const parsedFormat = shortlistExportFormatSchema.safeParse(request.nextUrl.searchParams.get('format') || 'csv')
  if (!parsedFormat.success) {
    return NextResponse.json({ error: 'format must be csv or md', code: 'INVALID_REQUEST' }, { status: 400 })
  }
  const runId = request.nextUrl.searchParams.get('runId')?.trim() || null

  try {
    const items = await listShortlist(auth.actor.id, { ideaRunId: runId && runId.length <= 80 ? runId : null })
    const format = parsedFormat.data
    const body = format === 'csv' ? buildShortlistCsv(items) : formatShortlistMarkdown(items)
    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8'
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="patent-shortlist-${stamp()}.${format}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return patentErrorResponse(error)
  }
}
