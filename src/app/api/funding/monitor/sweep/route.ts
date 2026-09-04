import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { isDue, runCheck } from '@/lib/monitor/checker'
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
 * The daily watch. Cron calls this once a day (see the deploy note); a funding
 * operator can also run it by hand from the Jobs panel. Checking is daily by
 * design — funding calls do not appear hourly, and a daily rhythm is far
 * gentler on the funders' servers.
 *
 * Sources never checked before are swept first so a fresh bulk import gets its
 * baseline on the next run rather than a day later.
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
      const startedAt = Date.now()
      const now = new Date()

      const sources = await prisma.monitoredSource.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { last_checked_at: { sort: 'asc', nulls: 'first' } },
        select: { id: true, name: true, last_checked_at: true, frequency_minutes: true },
      })
      const due = sources.filter((source) => isDue(source, now))

      const counts = {
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
