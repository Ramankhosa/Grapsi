/**
 * Report archive listing.
 *
 * One endpoint serves both surfaces. The caller's role decides the scope:
 * a super admin (or platform staff with `platform.support.read`) lists every
 * tenant and may narrow with `tenantId`; a tenant admin is pinned to their own
 * tenant and any `tenantId` they send is ignored.
 */

import { NextRequest, NextResponse } from 'next/server'

import { requireArchiveViewer, resolveTenantFilter } from '@/lib/reportsArchive/access'
import {
  listArchiveReports,
  loadArchiveFacets,
  type ArchiveReportType,
  type ArchiveState,
} from '@/lib/reportsArchive/query'

export const dynamic = 'force-dynamic'

function parseType(value: string | null): ArchiveReportType | null {
  if (value === 'reviewer' || value === 'funding_intelligence') return value
  return null
}

function parseState(value: string | null): ArchiveState | null {
  if (value === 'completed' || value === 'in_progress' || value === 'failed') return value
  return null
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(request: NextRequest) {
  const viewer = await requireArchiveViewer(request)
  if ('response' in viewer) return viewer.response

  const { searchParams } = new URL(request.url)
  const tenantId = resolveTenantFilter(viewer.scope, searchParams.get('tenantId'))
  const search = (searchParams.get('q') || '').trim()

  try {
    const [result, facets] = await Promise.all([
      listArchiveReports({
        type: parseType(searchParams.get('type')),
        tenantId,
        userId: searchParams.get('userId') || null,
        orgUnitId: searchParams.get('orgUnitId') || null,
        search: search || null,
        state: parseState(searchParams.get('state')),
        dateFrom: parseDate(searchParams.get('dateFrom')),
        dateTo: parseDate(searchParams.get('dateTo')),
        page: Number.parseInt(searchParams.get('page') || '1', 10) || 1,
        limit: Number.parseInt(searchParams.get('limit') || '25', 10) || 25,
      }),
      // Facets follow the tenant in play: schools are a tenant's own vocabulary,
      // and the people picker is far more useful narrowed to one customer than
      // listing every researcher on the platform.
      loadArchiveFacets(tenantId),
    ])

    return NextResponse.json({
      scope: viewer.scope,
      ...result,
      facets,
    })
  } catch (error) {
    console.error('Report archive listing failed:', error)
    return NextResponse.json({ error: 'Could not load the report archive.' }, { status: 500 })
  }
}
