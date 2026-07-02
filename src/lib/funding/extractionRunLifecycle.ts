const DEFAULT_STALE_RUN_MS = 20 * 60 * 1000
const DEFAULT_HEARTBEAT_MS = 30 * 1000

export const EXTRACTION_RUN_STALE_MS = Math.max(
  60_000,
  Number(process.env.FUNDING_EXTRACTION_RUN_STALE_MS || DEFAULT_STALE_RUN_MS)
)

export function getStaleExtractionRunCutoff(now = Date.now()) {
  return new Date(now - EXTRACTION_RUN_STALE_MS)
}

export function startExtractionHeartbeat(
  heartbeat: () => Promise<unknown>,
  intervalMs = Math.min(DEFAULT_HEARTBEAT_MS, Math.max(10_000, Math.floor(EXTRACTION_RUN_STALE_MS / 3)))
) {
  let stopped = false
  let inFlight: Promise<unknown> | null = null

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = heartbeat()
      .catch((error) => {
        console.warn('[Funding Extraction] heartbeat failed:', error)
      })
      .finally(() => {
        inFlight = null
      })
  }

  const timer = setInterval(tick, intervalMs)
  timer.unref?.()

  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}
