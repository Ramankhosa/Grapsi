import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { isCronRequest, withJobRun } from '@/lib/jobs/jobRuns'
import { isV2Engine, monitorEngine } from '@/lib/monitor/engine'
import { dispatchPendingEvents, emitEvent } from '@/lib/monitor/events'
import { WORKER_STALE_MS, freshestWorkerAgeMs, resumeAfterLaptop } from '@/lib/monitor/planner'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/funding/monitor/liveness — unauthenticated, for an EXTERNAL uptime
 * check that is independent of both the scheduler and the worker. Answers 503
 * when the v2 engine is on and no worker has beaten recently. Says nothing
 * beyond that.
 */
export async function GET() {
  const engine = monitorEngine()
  if (engine !== 'v2') {
    return NextResponse.json({ ok: true, engine }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const ageMs = await freshestWorkerAgeMs()
  const ok = ageMs !== null && ageMs < WORKER_STALE_MS
  return NextResponse.json(
    { ok, engine, workerAgeSeconds: ageMs === null ? null : Math.round(ageMs / 1000) },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  )
}

/**
 * POST /api/funding/monitor/liveness — the scheduler's 15-minute check. Raises
 * one deduplicated WORKER_OFFLINE alert per hour while the worker is down, and
 * sends any queued Source Watch alerts (the worker normally does, but cannot
 * while it is the thing that is down), and returns laptop-judged pages to screening.
 */
export async function POST(request: NextRequest) {
  const cron = isCronRequest(request)
  let triggeredBy: string | null = null
  if (!cron) {
    const auth = await requireFundingOperatorRequest(request)
    if ('response' in auth) return auth.response
    triggeredBy = auth.actor.email
  }

  return withJobRun({ jobKey: 'funding.monitor.liveness', trigger: cron ? 'schedule' : 'manual', triggeredBy }, async () => {
    if (!isV2Engine()) {
      return NextResponse.json({ engine: monitorEngine(), checked: false })
    }
    const ageMs = await freshestWorkerAgeMs()
    const offline = ageMs === null || ageMs >= WORKER_STALE_MS
    let alerted = false
    if (offline) {
      const hourSlot = new Date().toISOString().slice(0, 13)
      await emitEvent(prisma, {
        kind: 'WORKER_OFFLINE',
        eventKey: `worker-offline:${hourSlot}`,
        payload: { ageMinutes: ageMs === null ? null : Math.round(ageMs / 60_000) },
      })
      alerted = true
    }
    const dispatched = await dispatchPendingEvents()
    // Pages the laptop has judged go back to screening within 15 minutes.
    const resumedAfterLaptop = process.env.MONITOR_PIPELINE_ENABLED === 'true' ? await resumeAfterLaptop() : 0
    return NextResponse.json({
      resumedAfterLaptop,
      engine: 'v2',
      workerAgeSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
      offline,
      alerted,
      dispatched,
    })
  })
}
