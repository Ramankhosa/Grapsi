import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { EmbeddingService, areStoredEmbeddingJobsEnabled } from '@/lib/services/embeddingService'
import { fundingCallEmbeddingInput, fundingCallEmbeddingTarget } from '@/lib/services/fundingCatalogService'
import { resolveMonitorActor, MonitorConfigError } from './actor'
import { markDispatched, markUncertain, priceFor, reserveAttempt, settleAttempt, tokenMicros } from './budget'
import { fingerprint } from './hashing'
import { maxPaidAttempts } from './paidCall'
import { acquireProviderProbe, breakerState, classifyProviderFailure, recordProviderFailure, recordProviderSuccess, ProviderPausedError } from './providers'
import { completeTaskInTx, enqueueTask, withFence, type Db, type Lease } from './queue'

const VERSION = 'monitor-embedding-1'
const service = new EmbeddingService()
export async function queueCallEmbedding(db: Db, callId: string) {
  if (!await areStoredEmbeddingJobsEnabled()) return
  const call = await db.fundingCall.findUniqueOrThrow({ where: { id: callId } })
  const target = fundingCallEmbeddingTarget()
  const input = fundingCallEmbeddingInput(call)
  const hash = fingerprint({ text: input.text, title: input.title, model: target.modelName, dimensions: target.outputDimensionality, task: target.taskType })
  const opportunity = await db.monitorOpportunity.findFirst({ where: { funding_call_id: callId }, orderBy: { updated_at: 'desc' }, select: { site_id: true, bootstrap: true } })
  await enqueueTask(db, { kind: 'EMBED', operationKey: `embed-call:${call.id}:${hash}`, siteId: opportunity?.site_id, payload: { callId, hash, bootstrap: opportunity?.bootstrap ?? false }, priority: 180 })
}

/** EmbeddingService makes one HTTP call, with no provider retries or fallback. */
export async function embeddingForText(text: string, title: string, lease: Lease, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
  const target = fundingCallEmbeddingTarget()
  const health = service.getHealth({ taskType })
  if (!health.configured || !await areStoredEmbeddingJobsEnabled()) throw new MonitorConfigError('EMBEDDING_DISABLED', 'Budgeted embeddings are not configured or have been disabled')
  if (process.env.MONITOR_PAID_WORK_ENABLED !== 'true') throw new MonitorConfigError('PAID_WORK_DISABLED', 'Paid Source Watch work is disabled')
  const actor = await resolveMonitorActor()
  const model = await prisma.lLMModel.findUnique({ where: { code: health.modelName } })
  if (!model?.isActive || model.inputCostPer1M <= 0) throw new MonitorConfigError('EMBEDDING_PRICE_MISSING', `No active input price for ${health.modelName}`)
  // A bounded prefix is recorded as such; this is candidate retrieval only.
  const selected = text.slice(0, Math.min(120000, model.contextWindow * 2))
  const key = fingerprint({ stage: VERSION, text: selected, title, model: health.modelName, taskType, dimensions: target.outputDimensionality })
  const cached = await prisma.monitorStageCache.findUnique({ where: { cache_key: key } })
  if (cached) {
    await withFence(lease, tx => tx.monitorStageCache.update({ where: { id: cached.id }, data: { hit_count: { increment: 1 }, last_hit_at: new Date() } }))
    return { vector: (cached.result as unknown as { vector: number[] }).vector, target, truncated: selected.length !== text.length }
  }
  const account = health.provider === 'google' ? 'gemini' : 'voyage'
  const state = await breakerState(account)
  if (state.state === 'OPEN' || !await acquireProviderProbe(account)) throw new ProviderPausedError(account, state.reason ?? 'provider paused', state.retryAt ?? new Date(Date.now() + 60000))
  const previous = await prisma.monitorLlmAttempt.count({ where: { operation_key: `embed:${key}` } })
  if (previous >= maxPaidAttempts()) throw new Error('Embedding attempts exhausted; a deliberate replay is required')
  const price = await priceFor(health.modelName)
  const reserved = tokenMicros(Math.ceil(Buffer.byteLength(selected + title) * 1.15), price.inputCentsPer1M)
  const attempt = await reserveAttempt({ operationKey: `embed:${key}`, attemptNo: previous + 1, stage: 'EMBED', model: health.modelName, provider: account, price,
    reservedMaxMicros: reserved, scopes: ['PLATFORM', ...(lease.siteId ? [`SITE:${lease.siteId}`] : []), ...(lease.payload.bootstrap === true ? ['BOOTSTRAP'] : [])], taskId: lease.taskId, leaseGeneration: lease.generation })
  await markDispatched(attempt)
  const response = await service.generateEmbedding(selected, { tenantId: actor.tenantId, userId: actor.userId, taskCode: 'FUNDING_CALL_INGEST', stageCode: 'FUNDING_SOURCE_EMBED', operation: 'source_watch_embedding', metadata: { operationKey: `embed:${key}`, attemptId: attempt } }, { modelName: health.modelName, taskType, title, outputDimensionality: target.outputDimensionality })
  const vector = response.embedding
  if (vector.length !== target.outputDimensionality || !vector.every(Number.isFinite)) {
    const errorClass = classifyProviderFailure(response.providerError, response.error)
    if (['BILLING', 'AUTH', 'CONFIG', 'RATE'].includes(errorClass)) await settleAttempt(attempt, { status: 'FAILED_UNBILLED', actualMicros: 0n, errorClass, errorMessage: response.error })
    else await markUncertain(attempt, response.error ?? 'Invalid embedding response')
    await recordProviderFailure(account, errorClass, response.providerError)
    if (errorClass === 'BILLING' || errorClass === 'AUTH') throw new ProviderPausedError(account, errorClass, (await breakerState(account)).retryAt!)
    throw new Error(response.error ?? 'Invalid embedding response')
  }
  const actual = typeof response.inputTokens === 'number' ? tokenMicros(response.inputTokens, price.inputCentsPer1M) : reserved
  await settleAttempt(attempt, { status: 'SUCCEEDED', actualMicros: actual, usage: { inputTokens: response.inputTokens ?? null, estimatedConservative: response.inputTokens === undefined } })
  await recordProviderSuccess(account)
  await withFence(lease, tx => tx.monitorStageCache.upsert({ where: { cache_key: key }, create: { cache_key: key, stage: 'EMBED', result: { vector } as Prisma.InputJsonObject, model_used: health.modelName, cost_micros: actual }, update: {} }))
  return { vector, target, truncated: selected.length !== text.length }
}

export async function embedCall(lease: Lease) {
  const call = await prisma.fundingCall.findUniqueOrThrow({ where: { id: String(lease.payload.callId) } })
  const input = fundingCallEmbeddingInput(call)
  const result = await embeddingForText(input.text, input.title, lease, 'RETRIEVAL_DOCUMENT')
  await withFence(lease, async tx => {
    const latest = await tx.fundingCall.findUniqueOrThrow({ where: { id: call.id } })
    if (latest.revision !== call.revision) { await queueCallEmbedding(tx, call.id); await completeTaskInTx(tx, lease, { superseded: true }); return }
    const column = Prisma.raw(result.target.column === 'embedding_voyage_1024' ? 'embedding_voyage_1024' : 'embedding')
    const vector = `[${result.vector.join(',')}]`
    const metadata = { ...((call.metadata as Prisma.InputJsonObject) ?? {}), embedding_status: 'generated', embedding_version: result.target.version, embedding_model: result.target.modelName, embedding_dimensions: result.target.outputDimensionality, embedding_task_type: result.target.taskType, embedding_updated_at: new Date().toISOString(), embedding_text_truncated: result.truncated }
    const changed = await tx.$executeRaw`UPDATE "funding_calls" SET ${column} = ${vector}::vector, "metadata" = ${JSON.stringify(metadata)}::jsonb WHERE "id" = ${call.id} AND "revision" = ${call.revision}`
    if (changed !== 1) throw new Error('Funding call changed while storing its embedding')
    if (latest.catalog_status === 'PUBLISHED') await enqueueTask(tx, { kind: 'NOTIFY', operationKey: `published-call:${call.id}`, siteId: lease.siteId, payload: { callId: call.id }, priority: 190 })
    await completeTaskInTx(tx, lease, { callId: call.id })
  })
}

export async function semanticCandidates(text: string, lease: Lease) {
  if (process.env.MONITOR_SEMANTIC_MATCHING_ENABLED !== 'true') return []
  const result = await embeddingForText(text, '', lease, 'RETRIEVAL_QUERY')
  const column = Prisma.raw(result.target.column === 'embedding_voyage_1024' ? 'embedding_voyage_1024' : 'embedding')
  const vector = `[${result.vector.join(',')}]`
  return prisma.$queryRaw<Array<{ id: string; title: string; similarity: number }>>`SELECT "id", "title", 1 - (${column} <=> ${vector}::vector) AS similarity FROM "funding_calls" WHERE ${column} IS NOT NULL AND "catalog_status" = 'PUBLISHED' ORDER BY ${column} <=> ${vector}::vector LIMIT 8`
}
