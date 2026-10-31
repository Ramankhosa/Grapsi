import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { isDue, runCheck } from '@/lib/monitor/checker'
import { isV2Engine } from '@/lib/monitor/engine'
import { WORKER_STALE_MS, drainInline, freshestWorkerAgeMs, planDueChecks } from '@/lib/monitor/planner'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Politeness gap between two fetches, so a sweep never hammers a host. */
const BETWEEN_CHECKS_MS = 2_000
/** Leave headroom under maxDuration so the response is always written. */
const SWEEP_BUDGET_MS = 240_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * POST /api/funding/monitor/sweep
 *
 * v2 engine: the planner. It enqueues every due watch point as a check task
 * and returns at once; the worker does the fetching. If no worker has beaten
 * for 15 minutes, it drains plain-fetch checks itself within the old 240 s
 * budget — through the same claims and host reservations — so monitoring
 * degrades instead of stopping.
 *
 * Legacy engine: the original daily one-page sweep, unchanged.
 */
export async function POST(request: NextRequest) {
  const cron = isCronRequest(request)
  let triggeredBy: string | null = null
  if (!cron) {
    const auth = await requireFundingOperatorRequest(request)
    if ('response' in auth) return auth.response
    triggeredBy = auth.actor.email
  }

  return withJobRun(
    { jobKey: 'funding.monitor.sweep', trigger: cron ? 'schedule' : 'manual', triggeredBy },
    async () => {
      if (isV2Engine()) {
        const planned = await planDueChecks()
        const ageMs = await freshestWorkerAgeMs()
        const workerStale = ageMs === null || ageMs >= WORKER_STALE_MS
        const fallback = workerStale ? await drainInline({ budgetMs: SWEEP_BUDGET_MS, owner: `sweep-fallback:${process.pid}` }) : null
        return NextResponse.json({ engine: 'v2', ...planned, workerStale, fallbackExecuted: fallback?.executed ?? 0 })
      }

      const startedAt = Date.now()
      const now = new Date()

      const sources = await prisma.monitoredSource.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { last_checked_at: { sort: 'asc', nulls: 'first' } },
        select: { id: true, name: true, last_checked_at: true, frequency_minutes: true },
      })
      const due = sources.filter((source) => isDue(source, now))

      const counts = {
        engine: 'legacy',
        sources: sources.length,
        due: due.length,
        checked: 0,
        baseline: 0,
        unchanged: 0,
        changed: 0,
        failed: 0,
        skippedForTime: 0,
      }

      for (const source of due) {
        // Anything left when the budget runs out simply waits for the next
        // run: a truncated sweep must still return a recorded result.
        if (Date.now() - startedAt > SWEEP_BUDGET_MS) {
          counts.skippedForTime = due.length - counts.checked
          break
        }

        const result = await runCheck(source.id)
        counts.checked += 1
        if (result.status === 'baseline') counts.baseline += 1
        else if (result.status === 'unchanged') counts.unchanged += 1
        else if (result.status === 'changed') counts.changed += 1
        else {
          counts.failed += 1
          console.error(`[monitor] ${source.name}: ${result.message}`)
        }

        await sleep(BETWEEN_CHECKS_MS)
      }

      return NextResponse.json(counts)
    }
  )
}
