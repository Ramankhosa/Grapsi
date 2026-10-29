import { prisma } from '@/lib/prisma'
import { resolveMonitorActor } from './actor'
import { lockClaim, matchCatalog } from './matching'
import { completeTaskInTx, withFence, type Lease } from './queue'
import type { FundingExtractionPayload } from '@/lib/fundingIntake/types'
import { identifyUrl } from './urlIdentity'
import { BudgetExceededError, ledgerDay, nextBudgetDay } from './budget'
import { lifecycleAt } from './evidence'

export async function handoffOpportunity(lease: Lease) {
  const id = String(lease.payload.opportunityId)
  const opportunity = await prisma.monitorOpportunity.findUniqueOrThrow({ where: { id }, include: { primary_resource: true } })
  const revision = Number(lease.payload.reviewRevision)
  if (opportunity.review_revision !== revision || opportunity.review_state === 'REJECTED') throw new Error('Handoff is stale')
  const extracted = opportunity.field_evidence as unknown as { payload?: FundingExtractionPayload; conflicts?: string[]; quality?: {state:string}; identity?:{reference:string|null;round:string|null} }
  if (!extracted?.payload || extracted.conflicts?.length || opportunity.stale_evidence) throw new Error('Resolve evidence conflicts before drafting')
  if(extracted.quality?.state!=='READY')throw new Error('Identity, invitation and current application-window evidence are required before drafting')
  const payload = extracted.payload
  const currentLifecycle = lifecycleAt(extracted.payload.fields.close_date.value as string | null, extracted.payload.fields.open_date.value as string | null, opportunity.lifecycle)
  if (['EXPIRED', 'CANCELLED', 'WITHDRAWN', 'POSTPONED'].includes(currentLifecycle)) throw new Error('This announcement is no longer open; review its status before creating a draft')
  if (!['NEW', 'NEW_ROUND_OF'].includes(opportunity.match_type ?? '')) throw new Error('Duplicate or update requires review before a new draft')
  const url = opportunity.primary_resource?.canonical_url
  const key = url ? identifyUrl(url)?.dedupKey : null
  if (!key || !url) throw new Error('Handoff requires an official source URL')
  const handoff = await withFence(lease, async tx => {
    await lockClaim(tx, [`url:${key}`, ...(opportunity.scheme_key && opportunity.round_key ? [`round:${opportunity.scheme_key}:${opportunity.round_key}`] : [])])
    const current = await tx.monitorOpportunity.findUniqueOrThrow({ where: { id } })
    if (current.review_revision !== revision) throw new Error('Discovery changed before handoff')
    const existing = await tx.monitorHandoff.findUnique({ where: { handoff_key: lease.operationKey } })
    if (existing && await tx.fundingIntakeBatch.findUnique({ where: { handoff_key: existing.handoff_key } })) return existing
    const match = await matchCatalog(url, opportunity.title ?? '', opportunity.funder_id, tx, opportunity.round_key, opportunity.primary_resource?.final_url?[opportunity.primary_resource.final_url]:[], extracted.identity?.reference)
    const competing = await tx.monitorHandoff.findFirst({ where: { opportunity_id: { not: id }, state: { in: ['PENDING', 'LINKED'] }, opportunity: { primary_resource: { dedup_key: key } } }, include: { opportunity: { select: { title: true } } } })
    const year = opportunity.title?.match(/\b20\d{2}\b/)?.[0]
    const otherYear = competing?.opportunity.title?.match(/\b20\d{2}\b/)?.[0]
    const distinctRound = year && otherYear && year !== otherYear
    if (!['NEW', 'NEW_ROUND_OF'].includes(match.type) || (competing && !distinctRound)) {
      await tx.monitorOpportunity.update({ where: { id }, data: { match_type: competing ? 'AMBIGUOUS' : match.type, match_confidence: competing ? 'AMBIGUOUS' : match.confidence, funding_call_id: match.callId, review_state: 'PENDING' } })
      await completeTaskInTx(tx, lease, { heldForDuplicateReview: true })
      return null
    }
    if (!existing) {
      await lockClaim(tx, [`draft-cap:${ledgerDay().toISOString()}`])
      const count = await tx.monitorHandoff.count({ where: { action: 'DRAFT', created_at: { gte: new Date(ledgerDay().getTime() - 5.5 * 3600_000) } } })
      if (count >= Math.max(1, Number(process.env.MONITOR_DAILY_DRAFT_CAP) || 10)) throw new BudgetExceededError('DRAFT_CAP', nextBudgetDay())
    }
    const row = await tx.monitorHandoff.upsert({ where: { handoff_key: lease.operationKey }, create: { handoff_key: lease.operationKey, opportunity_id: id, review_revision: revision, action: 'DRAFT' }, update: {} })
    await tx.fundingCallUrlKey.upsert({ where: { dedup_key_owner_key: { dedup_key: key, owner_key: `handoff:${row.id}` } }, create: { dedup_key: key, owner_key: `handoff:${row.id}`, handoff_id: row.id, source: 'HANDOFF' }, update: {} })
    return row
  })
  if (!handoff) return
  const actor = await resolveMonitorActor()
  const versions = await prisma.monitorResourceVersion.findMany({ where: { id: { in: opportunity.drafted_from_version_ids } } })
  const text = versions.map(v => v.text ?? '').join('\n\n')
  const { fundingIntakeService } = await import('@/lib/fundingIntake/service')
  await withFence(lease, async tx => {
  const current = await tx.monitorOpportunity.findUniqueOrThrow({ where: { id } })
  if (current.review_revision !== revision || current.review_state === 'REJECTED' || current.stale_evidence) throw new Error('Discovery changed before intake handoff')
  const batch = await fundingIntakeService.createBatch({ userId: actor.userId, email: 'source-watch@system.invalid', role: 'CURATOR', tenantId: actor.tenantId }, {
    label: `Source Watch: ${opportunity.title ?? url}`, jobs: [{ sources: [{ sourceKey: 'source_1', inputType: 'text', sourceText: text, originUrl: url }], detailsSourceKey: 'source_1', autoCreateDraft: true, extractAll: false }],
  }, { handoffKey: handoff.handoff_key, opportunityId: id, funderId: opportunity.funder_id, payload, identity:extracted.identity })
    const job = await tx.fundingIntakeJob.findFirst({ where: { batch_id: batch.id } })
    await tx.monitorHandoff.update({ where: { id: handoff.id }, data: { state: 'LINKED', intake_batch_id: batch.id, intake_job_id: job?.id, funding_call_id: job?.linked_funding_call_id } })
    await tx.monitorOpportunity.update({ where: { id }, data: { processing_state: 'DRAFTED', funding_call_id: job?.linked_funding_call_id ?? null } })
    await completeTaskInTx(tx, lease, { batchId: batch.id })
  })
}

/** Intake can finish asynchronously or be edited outside Source Watch. */
export async function reconcileHandoffs() {
  const rows = await prisma.monitorHandoff.findMany({ where: { state: { in: ['PENDING', 'LINKED'] } }, orderBy: { updated_at: 'asc' }, take: 200 })
  for (const row of rows) {
    const batch = row.intake_batch_id ? null : await prisma.fundingIntakeBatch.findUnique({ where: { handoff_key: row.handoff_key } })
    const job = row.intake_job_id ? await prisma.fundingIntakeJob.findUnique({ where: { id: row.intake_job_id }, include: { linked_funding_call: true } }) : batch ? await prisma.fundingIntakeJob.findFirst({ where: { batch_id: batch.id }, include: { linked_funding_call: true } }) : null
    if (!job) continue
    await prisma.$transaction(async tx => {
      await tx.monitorHandoff.update({ where: { id: row.id }, data: { state: ['draft_created', 'failed', 'canceled', 'needs_review'].includes(job.status) ? 'COMPLETED' : 'LINKED', intake_batch_id: job.batch_id, intake_job_id: job.id, funding_call_id: job.linked_funding_call_id } })
      await tx.monitorOpportunity.update({ where: { id: row.opportunity_id }, data: { funding_call_id: job.linked_funding_call_id,
        processing_state: job.status === 'draft_created' ? 'DRAFTED' : ['failed', 'canceled', 'needs_review'].includes(job.status) ? 'NEEDS_EVIDENCE' : 'EXTRACTING',
        ...(job.linked_funding_call?.catalog_status === 'PUBLISHED' ? { review_state: 'PUBLISHED' } : {}),
      } })
    })
  }
}
