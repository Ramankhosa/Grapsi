import { GEMINI_MODEL_ALIASES } from '@/lib/metering/providers/gemini-provider'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/prisma-generated'

import { settleAttempt, type PriceSnapshot } from './budget'
import { validateBatch } from './candidates'
import { ROUTING_POLICY_VERSION, actualCost, jsonResponseText } from './paidCall'

/**
 * Provider batch mode for paid Source Watch work (29 Oct 2026). runPaidStage
 * leaves a request as a BATCH_QUEUED attempt (reserved at the batch price) and
 * defers its task. This module, run every 15 minutes by the scheduler's
 * liveness job:
 *   1. submits queued requests as one Gemini batch job per model (half price,
 *      answered within 24 hours, usually much sooner);
 *   2. collects finished jobs, settles each attempt at its actual batch cost,
 *      and files the answer — screening answers go straight into the per-page
 *      screening cache, so a page finds its answer however it is grouped next;
 *   3. wakes the deferred tasks, which then return the answer through
 *      runPaidStage's saved-receipt check.
 * A request whose batch fails or expires is released unbilled and its task
 * makes a normal, synchronous call on the next run.
 */

export interface BatchRequest { prompt: string; schema: Record<string, unknown>; maxOutputTokens: number; members: Array<Record<string, unknown>> }
export interface BatchAnswer { text: string | null; usage: { inputTokens?: number; outputTokens?: number; thoughtTokens?: number }; error: string | null }
export interface BatchJobView { state: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; answers: BatchAnswer[]; error: string | null }
export interface BatchClient {
  create(model: string, requests: BatchRequest[], label: string): Promise<string>
  get(job: string): Promise<BatchJobView>
  cancel(job: string): Promise<void>
}

const MAX_PER_JOB = 200
const QUEUE_GIVE_UP_MS = 3 * 3_600_000
const JOB_GIVE_UP_MS = 30 * 3_600_000

type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }

/** Gemini Developer API batch jobs with inline requests (answers come back in request order). */
export function geminiBatchClient(apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY): BatchClient {
  if (!apiKey) throw new Error('A Gemini API key is required for batch mode')
  const ai = (async () => { const { GoogleGenAI } = await import('@google/genai'); return new GoogleGenAI({ apiKey }) })()
  return {
    async create(model, requests, label) {
      const apiModel = GEMINI_MODEL_ALIASES[model] ?? model
      const job = await (await ai).batches.create({
        model: apiModel,
        src: requests.map(r => ({
          contents: [{ role: 'user', parts: [{ text: r.prompt }] }],
          config: {
            // The batch service ignores responseJsonSchema (checked 29 Oct 2026); responseSchema is
            // enforced, and the SDK converts the JSON Schema to Gemini's dialect.
            temperature: 0, maxOutputTokens: r.maxOutputTokens, responseMimeType: 'application/json', responseSchema: r.schema as never,
            ...(apiModel.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: 'LOW' as never } } : {}),
          },
        })),
        config: { displayName: label },
      })
      if (!job.name) throw new Error('Gemini returned a batch job without a name')
      return job.name
    },
    async get(name) {
      const job = await (await ai).batches.get({ name })
      const state = String(job.state ?? '')
      if (state === 'JOB_STATE_SUCCEEDED' || state === 'JOB_STATE_PARTIALLY_SUCCEEDED') {
        const answers = (job.dest?.inlinedResponses ?? []).map((item): BatchAnswer => {
          const response = item.response as GeminiResponse | undefined
          const text = response?.candidates?.[0]?.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('') || null
          const u = response?.usageMetadata
          return { text, usage: { inputTokens: u?.promptTokenCount, outputTokens: u?.candidatesTokenCount, thoughtTokens: u?.thoughtsTokenCount }, error: item.error ? String(item.error.message ?? 'batch item failed') : text ? null : 'empty answer' }
        })
        return { state: 'SUCCEEDED', answers, error: null }
      }
      if (['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'].includes(state)) return { state: 'FAILED', answers: [], error: job.error?.message ?? state }
      return { state: 'RUNNING', answers: [], error: null }
    },
    async cancel(name) { await (await ai).batches.cancel({ name }) },
  }
}

/** File a screening answer as per-page cache entries (the same validation as triageCandidates). */
async function fileTriageAnswer(text: string, request: BatchRequest, model: string, cost: bigint) {
  let parsed: unknown
  try { parsed = JSON.parse(jsonResponseText(text)) } catch { return 0 }
  const members = request.members as Array<{ id: string; cacheKey: string; completeness?: string }>
  const decisions = validateBatch(parsed, members.map(m => m.id))
  let filed = 0
  for (const m of members) {
    let decision = decisions.get(m.id)
    if (!decision) continue
    if (decision.verdict === 'NOT_FUNDING' && m.completeness === 'PARTIAL') decision = { ...decision, verdict: 'NEEDS_EVIDENCE', confidence: 0, reason: 'Only part of the source was available; a negative screening result requires further evidence.' }
    await prisma.monitorStageCache.upsert({ where: { cache_key: m.cacheKey }, create: {
      cache_key: m.cacheKey, stage: 'TRIAGE', result: decision as unknown as Prisma.InputJsonObject, model_used: model,
      routing_policy_version: ROUTING_POLICY_VERSION, cost_micros: cost / BigInt(Math.max(1, members.length)),
    }, update: {} })
    filed++
  }
  return filed
}

async function wake(taskIds: Array<string | null>) {
  const ids = [...new Set(taskIds.filter((id): id is string => Boolean(id)))]
  if (!ids.length) return
  await prisma.monitorTask.updateMany({ where: { id: { in: ids }, status: { in: ['QUEUED', 'DEFERRED_BUDGET', 'PAUSED_PROVIDER'] } }, data: { available_at: new Date() } })
}

async function release(attemptIds: string[], message: string) {
  for (const id of attemptIds) await settleAttempt(id, { status: 'FAILED_UNBILLED', actualMicros: 0n, errorClass: 'BATCH', errorMessage: message })
}

export interface BatchRunCounts { submitted: number; jobs: number; answered: number; failed: number; filed: number; skipped?: boolean }

/** One run at a time: an overlapping run (a manual liveness check, say) would submit the same requests twice. */
export async function runPaidBatches(client: BatchClient | null = null, now = new Date()): Promise<BatchRunCounts> {
  return prisma.$transaction(async tx => {
    const [{ acquired }] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(721023, 1) AS acquired`
    if (!acquired) return { submitted: 0, jobs: 0, answered: 0, failed: 0, filed: 0, skipped: true }
    return batchRun(client, now)
  }, { maxWait: 10_000, timeout: 10 * 60_000 })
}

async function batchRun(client: BatchClient | null, now: Date): Promise<BatchRunCounts> {
  const counts: BatchRunCounts = { submitted: 0, jobs: 0, answered: 0, failed: 0, filed: 0 }
  const queued = await prisma.monitorLlmAttempt.findMany({ where: { status: 'BATCH_QUEUED' }, orderBy: { created_at: 'asc' }, take: 1000 })
  const open = await prisma.monitorPaidBatch.findMany({ where: { state: 'SUBMITTED' }, orderBy: { submitted_at: 'asc' }, take: 50 })
  if (!queued.length && !open.length) return counts
  const api = client ?? geminiBatchClient()

  // 1. Submit, one job per model.
  const byModel = new Map<string, typeof queued>()
  for (const a of queued) byModel.set(`${a.stage}|${a.model}`, [...(byModel.get(`${a.stage}|${a.model}`) ?? []), a])
  for (const [key, attempts] of byModel) {
    const [stage, model] = key.split('|')
    for (let i = 0; i < attempts.length; i += MAX_PER_JOB) {
      const group = attempts.slice(i, i + MAX_PER_JOB)
      try {
        const job = await api.create(model, group.map(a => a.batch_request as unknown as BatchRequest), `source-watch ${stage} ${now.toISOString()}`)
        const batch = await prisma.monitorPaidBatch.create({ data: { provider: 'gemini', model, stage, provider_job: job, attempt_ids: group.map(a => a.id) } })
        await prisma.monitorLlmAttempt.updateMany({ where: { id: { in: group.map(a => a.id) }, status: 'BATCH_QUEUED' }, data: { status: 'BATCH_SUBMITTED', batch_id: batch.id, dispatched_at: now } })
        counts.submitted += group.length; counts.jobs++
      } catch (error) {
        console.error('[monitor] batch submission failed:', error instanceof Error ? error.message : error)
        // Requests that could not be submitted for hours go back to normal calls.
        const stale = group.filter(a => now.getTime() - a.created_at.getTime() > QUEUE_GIVE_UP_MS)
        await release(stale.map(a => a.id), 'Batch submission kept failing; the request will be sent normally')
        await wake(stale.map(a => a.task_id))
        counts.failed += stale.length
      }
    }
  }

  // 2. Collect finished jobs.
  for (const batch of open) {
    if (!batch.provider_job) continue
    let view: BatchJobView
    try { view = await api.get(batch.provider_job) } catch (error) {
      console.error('[monitor] batch status check failed:', error instanceof Error ? error.message : error)
      continue
    }
    await prisma.monitorPaidBatch.update({ where: { id: batch.id }, data: { last_polled_at: now } })
    const attempts = await prisma.monitorLlmAttempt.findMany({ where: { id: { in: batch.attempt_ids } } })
    const byId = new Map(attempts.map(a => [a.id, a]))
    if (view.state === 'RUNNING') {
      if (now.getTime() - batch.submitted_at.getTime() < JOB_GIVE_UP_MS) continue
      await api.cancel(batch.provider_job).catch(() => undefined)
      view = { state: 'FAILED', answers: [], error: 'Batch did not finish within 30 hours' }
    }
    if (view.state === 'FAILED') {
      await release(batch.attempt_ids, `Batch job failed: ${view.error ?? 'unknown'}`)
      await prisma.monitorPaidBatch.update({ where: { id: batch.id }, data: { state: 'FAILED', completed_at: now, error: view.error?.slice(0, 1000) } })
      await wake(attempts.map(a => a.task_id))
      counts.failed += batch.attempt_ids.length
      continue
    }
    for (const [index, attemptId] of batch.attempt_ids.entries()) {
      const attempt = byId.get(attemptId)
      if (!attempt) continue
      const answer = view.answers[index]
      const price = attempt.price_snapshot as unknown as PriceSnapshot
      if (!answer?.text) {
        await settleAttempt(attemptId, { status: answer && (answer.usage.inputTokens ?? 0) > 0 ? 'FAILED_BILLABLE' : 'FAILED_UNBILLED', actualMicros: answer ? actualCost(price, answer.usage) : 0n, errorClass: 'BATCH', errorMessage: answer?.error ?? 'No answer for this request' })
        counts.failed++
        continue
      }
      const cost = actualCost(price, answer.usage)
      await settleAttempt(attemptId, { status: 'SUCCEEDED', actualMicros: cost, usage: { ...answer.usage, outputText: answer.text.slice(0, 300000), batch: batch.provider_job } })
      if (attempt.stage === 'FUNDING_SOURCE_TRIAGE') counts.filed += await fileTriageAnswer(answer.text, attempt.batch_request as unknown as BatchRequest, attempt.model ?? batch.model, cost)
      counts.answered++
    }
    await prisma.monitorPaidBatch.update({ where: { id: batch.id }, data: { state: 'DONE', completed_at: now } })
    await wake(attempts.map(a => a.task_id))
  }
  return counts
}
