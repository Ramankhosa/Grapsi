import { publicProjectCorpusService } from './service'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface PublicProjectCrawlerWorkerOptions {
  once?: boolean
  runId?: string
  maxItems?: number
  pollIntervalMs?: number
  workerId?: string
}

function getCrawlerEmbeddingBatchSize() {
  if (process.env.PUBLIC_PROJECT_CRAWLER_AUTO_EMBEDDINGS === 'false') {
    return 0
  }

  const configured = Number(process.env.PUBLIC_PROJECT_CRAWLER_EMBEDDING_BATCH_SIZE || 25)
  if (!Number.isFinite(configured) || configured <= 0) {
    return 25
  }

  return Math.min(Math.max(configured, 1), 200)
}

export async function runPublicProjectCrawlerWorker(options: PublicProjectCrawlerWorkerOptions = {}) {
  const pollIntervalMs = Math.max(options.pollIntervalMs || 15000, 1000)
  const workerId = options.workerId || `public-project-crawler:${process.pid}`
  const embeddingBatchSize = getCrawlerEmbeddingBatchSize()

  await publicProjectCorpusService.ensureSources()

  do {
    const processed = await publicProjectCorpusService.processNextRun({
      workerId,
      runId: options.runId,
      maxItems: options.maxItems,
    })

    let embeddingResult: Awaited<ReturnType<typeof publicProjectCorpusService.processPendingEmbeddings>> | null = null
    if (embeddingBatchSize > 0) {
      embeddingResult = await publicProjectCorpusService.processPendingEmbeddings({
        limit: embeddingBatchSize,
        includeFailed: false,
      })
    }

    if (options.once) {
      return processed
    }

    if (!processed && (!embeddingResult || embeddingResult.selected === 0 || embeddingResult.failed > 0)) {
      await maybeScheduleMonthlyIncremental()
      await sleep(pollIntervalMs)
    }
  } while (true)
}

async function maybeScheduleMonthlyIncremental() {
  if (process.env.PUBLIC_PROJECT_CRAWLER_ENABLE_SCHEDULER !== 'true') {
    return
  }

  const health = await publicProjectCorpusService.listSources()
  const prism = health.sources.find((source) => source.sourceKey === 'PRISM')
  if (!prism?.enabled) {
    return
  }

  const lastRunAt = prism.lastRunAt ? new Date(prism.lastRunAt).getTime() : 0
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  if (Date.now() - lastRunAt < thirtyDaysMs) {
    return
  }

  const recentRuns = await publicProjectCorpusService.listRuns(20)
  const hasOpenPrismRun = recentRuns.some(
    (run) =>
      run.source.sourceKey === 'PRISM' &&
      ['queued', 'running', 'cancel_requested'].includes(run.status)
  )
  if (hasOpenPrismRun) {
    return
  }

  await publicProjectCorpusService.createRun({
    sourceKey: 'PRISM',
    mode: 'incremental',
    filters: {},
  })
}
