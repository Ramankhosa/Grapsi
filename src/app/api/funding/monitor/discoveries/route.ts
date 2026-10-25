import { NextRequest, NextResponse } from 'next/server'
import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'
import { lifecycleAt } from '@/lib/monitor/evidence'
import { localSuggestion } from '@/lib/monitor/localAnalysis'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const lane = request.nextUrl.searchParams.get('lane') ?? 'PENDING'
  const cursor = request.nextUrl.searchParams.get('cursor')
  const rows = await prisma.monitorOpportunity.findMany({ where: {
    ...(lane === 'ALL' ? {} : lane === 'WAITING_LOCAL' ? {triage_reason:{startsWith:'Waiting for laptop'}} : lane === 'NEEDS_EVIDENCE' ? {processing_state:'NEEDS_EVIDENCE'} : lane === 'AUDIT' ? { triage_verdict: 'NOT_FUNDING' } : { review_state: lane }),
    ...(cursor ? { id: { lt: cursor } } : {}),
  }, orderBy: { id: 'desc' }, take: 50, include: { site: { select: { host: true, display_name: true } }, primary_resource: { select: { title:true, canonical_url: true, last_validated_at: true, last_validation_status: true } }, funding_call: { select: { id: true, title:true, revision: true, catalog_status: true } }, evidence: { include: { version: { select: { text: true, truncated: true, fetched_at: true } }, resource: { select: { canonical_url: true } } } } } })
  return NextResponse.json({ discoveries: await Promise.all(rows.map(async row => {
    const payload = (row.field_evidence as { payload?: { fields?: Record<string, { value: unknown }> } } | null)?.payload
    return { ...row, local_analysis: row.primary_resource_id?await localSuggestion(row.primary_resource_id):null, lifecycle: lifecycleAt(payload?.fields?.close_date?.value as string | null, payload?.fields?.open_date?.value as string | null, row.lifecycle), evidence: row.evidence.map(e => ({ ...e, version: { ...e.version, text: e.version.text?.slice(0, 12000) } })) }
  })), next: rows.length === 50 ? rows[49].id : null }, { headers: { 'Cache-Control': 'private, no-store' } })
}
