import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFundingOperatorRequest, requireFundingPublisherRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'
import { lifecycleAt } from '@/lib/monitor/evidence'
import { localSuggestion } from '@/lib/monitor/localAnalysis'
import { enqueueTask, operationKeys } from '@/lib/monitor/queue'
import { duplicateCheckFor } from '@/lib/monitor/reviewList'
import { MonitorConflictError } from '@/lib/monitor/writeGuard'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import type { FundingDraftValues } from '@/lib/fundingIntake/types'
export const runtime = 'nodejs'
const schema = z.object({ action: z.enum(['extract', 'draft', 'publish', 'accept_update', 'reject', 'snooze', 'revalidate', 'label']), reviewRevision: z.number().int().nonnegative(), evidenceManifestVersion: z.number().int().nonnegative().optional(), callRevision: z.number().int().nonnegative().optional(), reason: z.string().max(1000).optional(), selectedFields: z.array(z.string()).max(35).optional(), ocrPages: z.array(z.number().int().min(1).max(40)).min(1).max(2).optional(), label: z.enum(['RELEVANT', 'IRRELEVANT', 'UNSURE']).optional() }).refine(v => v.action !== 'label' || !!v.label)
/** One discovery with its evidence, the laptop's suggestion and the live duplicate check. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const row = await prisma.monitorOpportunity.findUnique({ where: { id: params.id }, include: { site: { select: { host: true, display_name: true } }, primary_resource: { select: { title: true, canonical_url: true, last_validated_at: true, last_validation_status: true, call_score: true, call_band: true, call_signals: true } }, funding_call: { select: { id: true, title: true, revision: true, catalog_status: true } } } })
  if (!row) return NextResponse.json({ message: 'Discovery not found' }, { status: 404 })
  const payload = (row.field_evidence as { payload?: { fields?: Record<string, { value: unknown }> } } | null)?.payload
  const [local_analysis, duplicates] = await Promise.all([row.primary_resource_id ? localSuggestion(row.primary_resource_id) : null, duplicateCheckFor(row.id)])
  return NextResponse.json({ discovery: { ...row, local_analysis, duplicates, lifecycle: lifecycleAt(payload?.fields?.close_date?.value as string | null, payload?.fields?.open_date?.value as string | null, row.lifecycle) } }, { headers: { 'Cache-Control': 'private, no-store' } })
}
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Invalid review action' }, { status: 400 })
  const body = parsed.data
  const auth = ['draft', 'publish', 'accept_update'].includes(body.action) ? await requireFundingPublisherRequest(request) : await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  try {
    const opportunity = await prisma.monitorOpportunity.findUniqueOrThrow({ where: { id: params.id }, include: { primary_resource: true } })
    if (opportunity.review_revision !== body.reviewRevision) throw new MonitorConflictError()
    if (opportunity.review_state === 'PUBLISHED' && ['reject', 'snooze', 'draft'].includes(body.action)) throw new Error('Published calls must be changed through the catalog review')
    if (body.action === 'publish' || body.action === 'accept_update') {
      if (!opportunity.funding_call_id || body.callRevision === undefined || body.evidenceManifestVersion === undefined) throw new MonitorConflictError('Reload the draft and its evidence before publishing')
      const expected = { opportunityId: opportunity.id, callRevision: body.callRevision, reviewRevision: body.reviewRevision, evidenceManifestVersion: body.evidenceManifestVersion }
      if (body.action === 'publish') return NextResponse.json(await fundingCatalogService.publishFundingCall(opportunity.funding_call_id, auth.operator, expected))
      const payload = opportunity.field_evidence as { payload?: { fields?: Record<string, { value: unknown; status: string }> } } | null
      const fields: Record<string, unknown> = {}
      for (const key of body.selectedFields ?? []) {
        const field = payload?.payload?.fields?.[key]
        if (!field || field.status !== 'supported') throw new Error(`No verified evidence for ${key}`)
        fields[key] = field.value
      }
      return NextResponse.json(await fundingCatalogService.applyReviewedUpdate(opportunity.funding_call_id, fields as Partial<FundingDraftValues>, auth.operator, expected))
    }
    await prisma.$transaction(async tx => {
      const advanced = await tx.monitorOpportunity.updateMany({ where: { id: opportunity.id, review_revision: body.reviewRevision }, data: { review_revision: { increment: 1 }, decided_by_user_id: auth.operator.userId, decided_at: new Date(),
        ...(body.action === 'reject' ? { review_state: 'REJECTED', reject_reason: body.reason ?? 'Rejected by reviewer' } : {}),
        ...(body.action === 'snooze' ? { review_state: 'SNOOZED', snoozed_until: new Date(Date.now() + 7 * 86400_000) } : {}),
      } })
      if (!advanced.count) throw new MonitorConflictError()
      const revision = body.reviewRevision + 1
      if (body.label) {
        const sample = await tx.monitorAuditSample.findFirst({ where: { opportunity_id: opportunity.id, stage: 'FILTER' } })
        if (sample) await tx.monitorAuditSample.update({ where: { id: sample.id }, data: { label: body.label, labeled_by_user_id: auth.operator.userId, labeled_at: new Date() } })
        else await tx.monitorAuditSample.create({ data: { opportunity_id: opportunity.id, resource_id: opportunity.primary_resource_id, stage: 'TRIAGE', sampled_outcome: opportunity.triage_verdict ?? 'UNSURE', label: body.label, labeled_by_user_id: auth.operator.userId, labeled_at: new Date() } })
      }
      if (body.action === 'extract' || body.action === 'draft') await enqueueTask(tx, { kind: 'EXTRACT', operationKey: `extract-request:${opportunity.id}:${revision}`, opportunityId: opportunity.id, siteId: opportunity.site_id, payload: { opportunityId: opportunity.id, reviewRevision: revision, draft: body.action === 'draft', ...(body.ocrPages ? { ocrPages: body.ocrPages } : {}) }, priority: 20 })
      if (body.action === 'revalidate') for (const resource of await tx.monitorOpportunityEvidence.findMany({ where: { opportunity_id: opportunity.id }, distinct: ['resource_id'] })) {
        const r = await tx.monitorResource.update({ where: { id: resource.resource_id }, data: { revisit_generation: { increment: 1 } } })
        await enqueueTask(tx, { kind: 'REVISIT', operationKey: operationKeys.revisit(r.id, r.revisit_generation), resourceId: r.id, siteId: r.site_id, payload: { resourceId: r.id }, priority: 10 })
      }
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Review action failed' }, { status: error instanceof MonitorConflictError ? 409 : 400 })
  }
}
