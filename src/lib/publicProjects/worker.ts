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

export async function runPublicProjectCrawlerWorker(options: PublicProjectCrawlerWorkerOptions = {}) {
  const pollIntervalMs = Math.max(options.pollIntervalMs || 15000, 1000)
  const workerId = options.workerId || `public-project-crawler:${process.pid}`

  await publicProjectCorpusService.ensureSources()

  do {
    const processed = await publicProjectCorpusService.processNextRun({
      workerId,
      runId: options.runId,
      maxItems: options.maxItems,
    })

    if (options.once) {
      return processed
    }

    if (!processed) {
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
