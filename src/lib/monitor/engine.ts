/**
 * Which Source Watch engine runs: `legacy` (the original one-page diff checker)
 * or `v2` (the queue-backed worker). One switch, read by every entry point —
 * the sweep, Check now, the preview, and triage — so the two can never both
 * do work against the same sources.
 *
 * Default is `legacy`, so a deploy changes nothing until an operator starts the
 * v2 worker and flips MONITOR_ENGINE=v2. Rolling back means stopping the worker
 * first; the legacy path then fetches and diffs again.
 */
export type MonitorEngine = 'legacy' | 'v2'

export function monitorEngine(): MonitorEngine {
  return process.env.MONITOR_ENGINE?.trim().toLowerCase() === 'v2' ? 'v2' : 'legacy'
}

export function isV2Engine(): boolean {
  return monitorEngine() === 'v2'
}

export class EngineDisabledError extends Error {
  constructor(what: string) {
    super(`${what} is disabled while MONITOR_ENGINE=${monitorEngine()}`)
    this.name = 'EngineDisabledError'
  }
}

/** Throw unless the legacy engine is selected. Guards every legacy entry point. */
export function assertLegacyEngine(what: string): void {
  if (isV2Engine()) throw new EngineDisabledError(what)
}

/** The v2 browser tier is loaded only inside the worker process, and only when enabled. */
export function browserTierEnabled(): boolean {
  return process.env.MONITOR_BROWSER_ENABLED === 'true' && process.env.MONITOR_WORKER_PROCESS === '1'
}
