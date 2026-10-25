import type { Db } from './queue'
import { lockClaim, matchCatalog } from './matching'
import { z } from 'zod'
import { lifecycleAt } from './evidence'

export const expectedReviewSchema = z.object({ callRevision: z.number().int().nonnegative(), reviewRevision: z.number().int().nonnegative(), evidenceManifestVersion: z.number().int().nonnegative(), opportunityId: z.string().min(1) })

export interface ExpectedReview { callRevision: number; reviewRevision: number; evidenceManifestVersion: number; opportunityId: string }
export class MonitorConflictError extends Error {
  constructor(message = 'This record changed. Reload it before saving.') { super(message); this.name = 'MonitorConflictError' }
}
export async function assertReviewWrite(db: Db, call: { id: string; metadata: unknown; revision: number }, expected?: ExpectedReview, publishing = false) {
  const metadata = call.metadata as { origin?: string; source_watch_opportunity_id?: string } | null
  if (metadata?.origin !== 'source_watch' && !expected) return
  if (!expected || expected.callRevision !== call.revision || (metadata?.source_watch_opportunity_id && metadata.source_watch_opportunity_id !== expected.opportunityId)) throw new MonitorConflictError()
  const identity = await db.monitorOpportunity.findUnique({ where: { id: expected.opportunityId }, include: { primary_resource: true } })
  if (identity?.primary_resource) await lockClaim(db, [`url:${identity.primary_resource.dedup_key}`, ...(identity.scheme_key && identity.round_key ? [`round:${identity.scheme_key}:${identity.round_key}`] : [])])
  await db.$queryRaw`SELECT "id" FROM "monitor_opportunities" WHERE "id" = ${expected.opportunityId} FOR UPDATE`
  const opportunity = await db.monitorOpportunity.findUnique({ where: { id: expected.opportunityId }, include: { evidence: { include: { resource: true } } } })
  if (!opportunity || opportunity.review_revision !== expected.reviewRevision || opportunity.evidence_manifest_version !== expected.evidenceManifestVersion || opportunity.funding_call_id !== call.id) throw new MonitorConflictError()
  if (opportunity.review_state === 'REJECTED' || opportunity.stale_evidence) throw new MonitorConflictError('The discovery was rejected or its evidence changed')
  if (publishing) {
    if (identity?.primary_resource?.canonical_url) {
      const match = await matchCatalog(identity.primary_resource.canonical_url, identity.title ?? '', identity.funder_id, db, identity.round_key)
      if (match.type === 'AMBIGUOUS' && match.candidates.some(c => c.id !== call.id)) throw new MonitorConflictError('Another catalog call may own this announcement; resolve the duplicate before publishing')
    }
    const extraction = opportunity.field_evidence as { coverage?: Record<string, string>;quality?:{state:string};payload?:{fields?:Record<string,{value:unknown}>} } | null
    if(metadata?.origin==='source_watch'&&extraction?.quality?.state!=='READY')throw new MonitorConflictError('Identity, invitation and current application-window evidence are required before publication')
    if(metadata?.origin==='source_watch'&&!['OPEN','ROLLING','REOPENED'].includes(lifecycleAt(extraction?.payload?.fields?.close_date?.value as string|null,extraction?.payload?.fields?.open_date?.value as string|null,opportunity.lifecycle)))throw new MonitorConflictError('The application window needs review before publication')
    if (metadata?.origin === 'source_watch' && opportunity.match_type !== 'UPDATE_OF' && ['scheme_title', 'agency_name', 'description'].some(key => extraction?.coverage?.[key] !== 'COMPLETE')) throw new MonitorConflictError('Required fields need complete source evidence before publication')
    const cutoff = Date.now() - Math.max(1, Number(process.env.MONITOR_FRESHNESS_HOURS) || 72) * 3600_000
    if (!opportunity.evidence.length || opportunity.evidence.some(e => !e.resource.last_validated_at || e.resource.last_validated_at.getTime() < cutoff || !['OK', 'NOT_MODIFIED'].includes(e.resource.last_validation_status ?? '') || e.resource.current_version_id !== e.version_id)) throw new MonitorConflictError('Evidence needs a successful re-validation before publication')
  }
}
