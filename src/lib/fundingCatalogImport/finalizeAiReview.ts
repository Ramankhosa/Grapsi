import type { PrismaClient } from '@/lib/prisma-generated'
import { inputHash, validateRecommendation } from './aiReviewPolicy'
import { selectAiReviewItems, snapshotItem } from './aiReview'
import { finalDecision } from './finalDecisionPolicy'
import { setAside } from './review'
import { callsWithAttachedWork } from './rollback'
import { refreshReviewStatus } from './service'

export async function finalizeAiItem(db: PrismaClient, itemId: string, actor: string, audit: (entry: unknown) => void) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM catalog_ai_review_items WHERE id = ${itemId} FOR UPDATE`
    const item = await tx.catalogAiReviewItem.findFirst({ where: { id: itemId, status: 'DONE', approved_at: null, batch: { model: 'gpt-5.4-mini', status: 'COMPLETE' } } })
    if (!item) return { applied: false, reason: 'Unavailable or already approved' }
    await tx.$queryRaw`SELECT id FROM funding_import_candidates WHERE id = ${item.candidate_id} FOR UPDATE`
    const original = await tx.fundingImportCandidate.findUnique({ where: { id: item.candidate_id } })
    if (!original) return { applied: false, reason: 'Conflict no longer exists' }
    const ids = [original.subject_call_id, original.candidate_call_id].filter(Boolean).sort() as string[]
    for (const id of ids) await tx.$queryRaw`SELECT id FROM funding_calls WHERE id = ${id} FOR UPDATE`
    const fresh = (await selectAiReviewItems(tx as unknown as PrismaClient, {}, [original.id]))[0]
    if (!fresh || inputHash(snapshotItem(fresh)) !== item.input_hash) return { applied: false, reason: 'Input changed or conflict already resolved' }
    const snapshot = snapshotItem(fresh)
    const result = validateRecommendation(item.result, snapshot)
    const decision = finalDecision(result, snapshot)
    if (!decision) return { applied: false, reason: 'Evidence or confidence requires individual review' }
    let survivor: string | null = null, archived: string | null = null
    if (decision === 'exact_duplicate') {
      if ((await callsWithAttachedWork(tx as unknown as PrismaClient, ids)).size) return { applied: false, reason: 'Attached work protects this duplicate pair' }
      // Both records must remain staged imports, not promoted work. Lexical ID
      // ordering makes the survivor deterministic across overlapping pairs.
      survivor = ids[0]; archived = ids[1]
      if (ids.length !== 2 || survivor === archived) return { applied: false, reason: 'Invalid pair' }
    }
    audit({ itemId, candidateId: original.id, decision, actor, before: original, survivor, archived, snapshot })
    if (archived && survivor) await setAside(tx, archived, survivor)
    const note = `User-authorized AI final review ${item.batch_id}: ${decision}; ${survivor ? `kept ${survivor}, archived ${archived}; ` : ''}${result.explanation}`.slice(0, 1000)
    await tx.fundingImportCandidate.update({ where: { id: original.id }, data: { resolution: decision === 'distinct' ? 'create_new_anyway' : 'merged_to_existing', resolution_note: note, resolved_by_user_id: actor, resolved_at: new Date() } })
    await refreshReviewStatus(tx as unknown as PrismaClient, null, ids)
    await tx.catalogAiReviewItem.update({ where: { id: itemId }, data: { approved_by: actor, approved_at: new Date() } })
    return { applied: true, decision, survivor, archived, candidateId: original.id }
  }, { timeout: 30000 })
}
