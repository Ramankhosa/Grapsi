import type { Renderer } from './browser'
import { recordCheckFailure, runSourceCheck } from './checkSource'
import { isMonitorFetchError } from './errors'
import { emitEvent } from './events'
import { runHousekeeping } from './housekeeping'
import { LeaseLostError, cancelTask, deferTask, failTask, type Lease, type TaskKind } from './queue'
import type { SafeFetch } from './safeFetch'
import { refreshUrlIndex } from './urlKeys'

/** Kinds this phase can execute. Others stay queued for the phase that adds them. */
export const EXECUTABLE_KINDS: TaskKind[] = ['CHECK_SOURCE', 'REFRESH_URL_INDEX', 'HOUSEKEEPING']

export interface ExecuteDeps {
  fetch: SafeFetch
  renderer: Renderer | null
  signal?: AbortSignal
}

/**
 * Run one claimed task and settle it. Every outcome goes through the lease's
 * fence: success, a deferral (which spends no attempt), a retryable failure
 * (backoff, then DEAD), or a permanent one. A lost lease ends quietly — the
 * task now belongs to whoever reclaimed it, and nothing here committed.
 */
export async function executeTask(lease: Lease, deps: ExecuteDeps): Promise<void> {
  try {
    switch (lease.kind) {
      case 'CHECK_SOURCE':
        await runSourceCheck(lease, { fetch: deps.fetch, renderer: deps.renderer, signal: deps.signal })
        return
      case 'REFRESH_URL_INDEX':
        await refreshUrlIndex(lease)
        return
      case 'HOUSEKEEPING':
        await runHousekeeping(lease)
        return
      default:
        await cancelTask(lease, `No executor for ${lease.kind} in this phase`)
    }
  } catch (error) {
    if (error instanceof LeaseLostError) return
    try {
      await settleFailure(lease, error)
    } catch (settleError) {
      if (settleError instanceof LeaseLostError) return
      throw settleError
    }
  }
}

async function settleFailure(lease: Lease, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const isCheck = lease.kind === 'CHECK_SOURCE'

  const domain = isCheck
    ? async (tx: Parameters<NonNullable<Parameters<typeof failTask>[2]>>[0]) => {
        const outcome = await recordCheckFailure(tx, lease, error)
        if (outcome.sitePaused && outcome.siteId) {
          const site = await tx.monitorSite.findUnique({ where: { id: outcome.siteId } })
          await emitEvent(tx, {
            kind: 'SITE_PAUSED',
            eventKey: `site-paused:${outcome.siteId}:${new Date().toISOString().slice(0, 10)}`,
            payload: {
              siteId: outcome.siteId,
              host: site?.host,
              failures: site?.consecutive_fetch_failures,
              lastError: site?.last_fetch_error,
            },
          })
        }
      }
    : undefined

  if (isMonitorFetchError(error) && error.isDeferral) {
    await deferTask(lease, error.retryAt ?? new Date(Date.now() + 10 * 60 * 1000), message, 'QUEUED', domain)
    return
  }
  const retryable = isMonitorFetchError(error) ? error.retryable : true
  await failTask(lease, { message, retryable, retryAt: isMonitorFetchError(error) ? error.retryAt : undefined }, domain)
}
