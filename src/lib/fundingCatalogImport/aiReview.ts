import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { PrismaClient } from '@/lib/prisma-generated'
import { liveOpportunityStatus } from './lifecycle'
import { reviewWhere } from './review'
import { refreshReviewStatus } from './service'
import { canApproveDistinct, inputHash, REVIEW_SYSTEM_PROMPT, reviewResponseSchema, validateRecommendation } from './aiReviewPolicy'

export const aiFilterSchema = z.object({
  reason: z.string().max(80).optional(), tier: z.string().max(80).optional(),
  q: z.string().max(200).optional(), runId: z.string().max(100).optional(),
  agency: z.string().max(200).optional(), subject: z.string().max(200).optional(),
  lifecycle: z.enum(['', 'OPEN', 'ROLLING', 'CLOSED', 'FORTHCOMING', 'UNKNOWN']).optional(),
  reviewId: z.string().max(100).optional(),
  aiDecision: z.enum(['', 'UNREVIEWED', 'SAME_OPPORTUNITY', 'SEPARATE_OPPORTUNITIES', 'NEEDS_INFORMATION', 'UNCERTAIN']).optional(),
  minScore: z.number().min(0).max(1).optional(), maxScore: z.number().min(0).max(1).optional(),
})
export type AiFilter = z.infer<typeof aiFilterSchema>
const callSelect = { id: true, title: true, scheme_title: true, agency_name: true, description: true, eligibility_text: true,
  close_date: true, open_date: true, entry_closes_at: true, final_deadline_at: true, source_closed_at: true,
  is_rolling: true, amount_text: true, currency: true, source_url: true, disciplines: true,
  import_run_id: true, catalog_status: true, visibility: true, review_status: true,
  amount_min: true, amount_max: true, applicant_scope: true, applicant_country_codes: true,
  applicant_excluded_codes: true, applicant_region_codes: true, residence_scope: true, residence_country_codes: true, residence_excluded_codes: true, residence_region_codes: true,
  citizenship_scope: true, citizenship_country_codes: true, citizenship_excluded_codes: true, citizenship_region_codes: true,
  host_scope: true, host_country_codes: true, host_excluded_codes: true, host_region_codes: true } as const
function callSnapshot(c: any) {
  if (!c) return null
  return { id: c.id, contentHash: inputHash(c), title: c.scheme_title || c.title || '', agency: c.agency_name || '',
    description: (c.description || '').slice(0, 14000), descriptionTruncated: (c.description || '').length > 14000,
    eligibility: (c.eligibility_text || '').slice(0, 8000), eligibilityTruncated: (c.eligibility_text || '').length > 8000,
    deadline: JSON.stringify({ open: c.open_date, close: c.close_date, entry: c.entry_closes_at, final: c.final_deadline_at, rolling: c.is_rolling, sourceClosed: c.source_closed_at }),
    amount: `${c.currency || ''} ${c.amount_text || ''} [min=${c.amount_min ?? ''}; max=${c.amount_max ?? ''}]`.trim(), source: c.source_url || '',
    countryRequirements: Object.fromEntries(Object.entries(c).filter(([key]) => /^(applicant|residence|citizenship|host)_/.test(key))),
    disciplines: c.disciplines, imported: Boolean(c.import_run_id), catalogStatus: c.catalog_status, visibility: c.visibility }
}
export function snapshotItem(item: any) {
  return { reason: item.reason, signals: item.signals, resolution: item.resolution, blocksRelease: item.blocks_release,
    subject: callSnapshot(item.subject_call), candidate: callSnapshot(item.candidate_call) }
}
const include = { subject_call: { select: callSelect }, candidate_call: { select: callSelect } }

export async function selectAiReviewItems(db: PrismaClient, filter: AiFilter, ids?: string[]) {
  const prior = filter.aiDecision ? await db.catalogAiReviewItem.findMany({ where: { status: 'DONE', ...(filter.aiDecision === 'UNREVIEWED' ? {} : { result: { path: ['decision'], equals: filter.aiDecision } }) }, select: { candidate_id: true }, distinct: ['candidate_id'] }) : []
  const rows = await db.fundingImportCandidate.findMany({ where: { AND: [reviewWhere({ ...filter, state: 'open' }),
    { blocks_release: true, subject_call: { import_run_id: { not: null }, catalog_status: 'STAGED', visibility: 'GLOBAL_CATALOG' } },
    ...(ids ? [{ id: { in: ids } }] : []),
    ...(filter.reviewId ? [{ id: filter.reviewId }] : []),
    ...(filter.aiDecision ? [{ id: filter.aiDecision === 'UNREVIEWED' ? { notIn: prior.map(p => p.candidate_id) } : { in: prior.map(p => p.candidate_id) } }] : []),
    ...(filter.minScore !== undefined ? [{ score: { gte: filter.minScore } }] : []),
    ...(filter.maxScore !== undefined ? [{ score: { lte: filter.maxScore } }] : []),
  ] }, include, orderBy: { id: 'asc' }, take: 10001 })
  if (rows.length > 10000) throw new Error('Narrow the filters to at most 10,000 review items')
  return rows.filter(row => {
    const c = row.subject_call!
    return (!filter.agency || (c.agency_name || '').toLowerCase().includes(filter.agency.toLowerCase())) &&
      (!filter.subject || c.disciplines.join(' ').toLowerCase().includes(filter.subject.toLowerCase())) &&
      (!filter.lifecycle || liveOpportunityStatus(c) === filter.lifecycle)
  })
}
export function estimateReview(rows: any[]) {
  const inputTokens = rows.reduce((n, r) => n + Math.ceil((JSON.stringify(snapshotItem(r)).length + REVIEW_SYSTEM_PROMPT.length) / 3), 0)
  return { reviewItems: rows.length, uniqueCalls: new Set(rows.flatMap(r => [r.subject_call_id, r.candidate_call_id]).filter(Boolean)).size,
    estimatedInputTokens: inputTokens, maximumOutputTokens: rows.length * 2048,
    estimatedCostUsd: (inputTokens * 0.30 + rows.length * 2048 * 2.50) / 1000000,
    note: 'Token estimate only. Actual provider billing includes reasoning tokens and retries; each item is limited to three attempts.' }
}
export async function createAiBatch(db: PrismaClient, actor: string, filter: AiFilter, ids: string[] | undefined, expectedHash: string, limit = 100) {
  if (!process.env.GOOGLE_AI_API_KEY) throw new Error('AI review provider is not configured')
  const rows = await selectAiReviewItems(db, filter, ids)
  if (!rows.length) throw new Error('No pending imported conflicts match this selection')
  if (selectionHash(rows) !== expectedHash) throw new Error('Selection changed. Preview again before starting.')
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(721021, 1)::text`
    const selected = rows.slice(0, limit)
    const overlap = await tx.catalogAiReviewItem.count({ where: { candidate_id: { in: selected.map(r => r.id) }, status: { in: ['QUEUED', 'RUNNING'] }, batch: { status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } } } })
    if (overlap) throw new Error('Some selected items already belong to an unfinished batch. Resume or cancel that batch first.')
    return tx.catalogAiReviewBatch.create({ data: { actor_id: actor, model: 'gemini-2.5-flash', selection: { filter, ids: ids || null, limit, promptVersion: 'catalog-review-v3', promptHash: inputHash(REVIEW_SYSTEM_PROMPT) } as any,
      items: { create: selected.map(r => { const snapshot = snapshotItem(r); return { candidate_id: r.id, snapshot: snapshot as any, input_hash: inputHash(snapshot) } }) } } })
  }, { timeout: 30000 })
}
export function selectionHash(rows: any[]) { return inputHash(rows.map(r => [r.id, inputHash(snapshotItem(r))])) }

export async function runAiReviewStep(db: PrismaClient, batchId: string) {
  const token = randomUUID(), now = new Date()
  // A batch row lock serializes claims, including concurrent tabs and workers.
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM catalog_ai_review_batches WHERE id = ${batchId} FOR UPDATE`
    const batch = await tx.catalogAiReviewBatch.findUnique({ where: { id: batchId } })
    if (!batch || !['QUEUED', 'RUNNING'].includes(batch.status)) return null
    if (await tx.catalogAiReviewItem.count({ where: { batch_id: batchId, status: 'RUNNING', lease_until: { gt: now } } })) return null
    await tx.catalogAiReviewItem.updateMany({ where: { batch_id: batchId, status: 'RUNNING', lease_until: { lte: now }, attempts: { gte: 3 } }, data: { status: 'FAILED', error: 'Worker lease expired after three attempts' } })
    const item = await tx.catalogAiReviewItem.findFirst({ where: { batch_id: batchId, attempts: { lt: 3 }, OR: [{ status: 'QUEUED' }, { status: 'RUNNING', lease_until: { lte: now } }] }, orderBy: { id: 'asc' } })
    if (!item) { await tx.catalogAiReviewBatch.update({ where: { id: batchId }, data: { status: 'COMPLETE' } }); return null }
    await tx.catalogAiReviewBatch.update({ where: { id: batchId }, data: { status: 'RUNNING' } })
    await tx.catalogAiReviewItem.update({ where: { id: item.id }, data: { status: 'RUNNING', lease_token: token, lease_until: new Date(Date.now() + 120000), attempts: { increment: 1 } } })
    return { item, batch }
  })
  if (!claim) return
  let pauseBatch = false
  let usage: any = undefined
  try {
    const fresh = await db.fundingImportCandidate.findUnique({ where: { id: claim.item.candidate_id }, include })
    if (!fresh || inputHash(snapshotItem(fresh)) !== claim.item.input_hash) throw new Error('Record changed since selection; create a fresh review')
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${claim.batch.model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_AI_API_KEY || '' },
      signal: AbortSignal.timeout(60000), body: JSON.stringify({
        systemInstruction: { parts: [{ text: REVIEW_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(claim.item.snapshot) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: reviewResponseSchema, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
    })
    if (!response.ok) { pauseBatch = true; throw new Error(`AI provider returned HTTP ${response.status}; batch paused. Check provider access or limits before retrying.`) }
    const body = await response.json()
    usage = body.usageMetadata || {}
    const candidate = body.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') throw new Error('AI output incomplete or blocked')
    const result = validateRecommendation(JSON.parse(candidate.content.parts.filter((p: any) => !p.thought).map((p: any) => p.text || '').join('')), claim.item.snapshot)
    await db.catalogAiReviewItem.updateMany({ where: { id: claim.item.id, lease_token: token, status: 'RUNNING' }, data: { status: 'DONE', result, usage: body.usageMetadata || {}, lease_until: null } })
  } catch (error) {
    await db.catalogAiReviewItem.updateMany({ where: { id: claim.item.id, lease_token: token, status: 'RUNNING' }, data: { status: 'FAILED', ...(usage ? { usage } : {}), error: error instanceof Error ? error.message.slice(0, 500) : 'AI review failed', lease_until: null } })
    if (pauseBatch || (error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name))) {
      await db.catalogAiReviewBatch.updateMany({ where: { id: batchId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'PAUSED' } })
    }
  }
}

/** Only a conservative, explicitly approved 'distinct' recommendation can clear a pair. */
export async function approveDistinct(db: PrismaClient, batchId: string, ids: string[], actor: string) {
  const outcome: Array<{ id: string; applied: boolean; reason?: string }> = []
  for (const id of ids) {
    try {
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM catalog_ai_review_items WHERE id = ${id} FOR UPDATE`
        const item = await tx.catalogAiReviewItem.findFirst({ where: { id, batch_id: batchId, status: 'DONE', approved_at: null } })
        if (!item) throw new Error('Result is unavailable or already approved')
        await tx.$queryRaw`SELECT id FROM funding_import_candidates WHERE id = ${item.candidate_id} FOR UPDATE`
        const fresh = await tx.fundingImportCandidate.findUnique({ where: { id: item.candidate_id }, include })
        if (!fresh) throw new Error('Review item no longer exists')
        const callIds = [fresh.subject_call_id, fresh.candidate_call_id].filter(Boolean).sort() as string[]
        // Lock call content before validating, in stable order to avoid stale approvals.
        for (const callId of callIds) await tx.$queryRaw`SELECT id FROM funding_calls WHERE id = ${callId} FOR UPDATE`
        const locked = await tx.fundingImportCandidate.findUnique({ where: { id: item.candidate_id }, include })
        if (!locked || inputHash(snapshotItem(locked)) !== item.input_hash) throw new Error('Call or conflict changed; review again')
        const result = validateRecommendation(item.result, item.snapshot)
        if (!canApproveDistinct(result, item.snapshot)) throw new Error('This recommendation requires individual review')
        if (locked.subject_call?.catalog_status !== 'STAGED' || locked.subject_call.visibility !== 'GLOBAL_CATALOG' || !locked.subject_call.import_run_id) throw new Error('Call is no longer a staged import')
        await tx.fundingImportCandidate.update({ where: { id: locked.id }, data: { resolution: 'create_new_anyway', resolution_note: `AI recommendation approved (${batchId}): ${result.explanation}`.slice(0, 1000), resolved_by_user_id: actor, resolved_at: new Date() } })
        await refreshReviewStatus(tx as unknown as PrismaClient, null, callIds)
        await tx.catalogAiReviewItem.update({ where: { id }, data: { approved_by: actor, approved_at: new Date() } })
      })
      outcome.push({ id, applied: true })
    } catch (error) { outcome.push({ id, applied: false, reason: error instanceof Error ? error.message : 'Approval failed' }) }
  }
  return outcome
}
