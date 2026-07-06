import { publicProjectCorpusService } from './service'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function boundedBatchSize(value: number | undefined, fallback: number) {
  const next = Number.isFinite(value) && value ? Number(value) : fallback
  return Math.min(Math.max(next, 1), 200)
}

export interface PublicProjectEmbeddingWorkerOptions {
  once?: boolean
  limit?: number
  includeFailed?: boolean
  pollIntervalMs?: number
  batchCooldownMs?: number
}

export async function runPublicProjectEmbeddingWorker(options: PublicProjectEmbeddingWorkerOptions = {}) {
  const pollIntervalMs = Math.max(options.pollIntervalMs || 15000, 1000)
  const batchCooldownMs = Math.max(
    options.batchCooldownMs ?? Number(process.env.PUBLIC_PROJECT_EMBEDDING_WORKER_BATCH_COOLDOWN_MS || 10000),
    0
  )
  const limit = boundedBatchSize(
    options.limit,
    Number(process.env.PUBLIC_PROJECT_EMBEDDING_WORKER_BATCH_SIZE || 5)
  )
  const includeFailed =
    options.includeFailed ?? process.env.PUBLIC_PROJECT_EMBEDDING_WORKER_INCLUDE_FAILED === 'true'

  do {
    const result = await publicProjectCorpusService.processPendingEmbeddings({
      limit,
      includeFailed,
      includeCoverage: false,
    })

    if (options.once) {
      return result
    }

    if (result.selected === 0 || result.failed > 0) {
      await sleep(pollIntervalMs)
    } else if (batchCooldownMs > 0) {
      await sleep(batchCooldownMs)
    }
  } while (true)
}
