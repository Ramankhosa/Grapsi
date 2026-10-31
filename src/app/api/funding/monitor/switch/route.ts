import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'
import { CRAWL_KINDS, pipelineSwitch, setPipelineSwitch } from '@/lib/monitor/pipelineSwitch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ mode: z.enum(['RUNNING', 'CRAWL_PAUSED', 'STOPPED']), reason: z.string().max(300).optional() })

const WAITING = ['QUEUED', 'DEFERRED_BUDGET', 'PAUSED_PROVIDER']

/** What the pipeline is holding: tasks running now, and waiting work by what it does. */
async function holding() {
  const [running, rows] = await Promise.all([
    prisma.monitorTask.count({ where: { status: 'RUNNING' } }),
    prisma.monitorTask.groupBy({ by: ['kind'], where: { status: { in: WAITING as never } }, _count: true }),
  ])
  const count = (kinds: readonly string[]) => rows.filter(r => kinds.includes(r.kind)).reduce((n, r) => n + r._count, 0)
  const waiting = rows.reduce((n, r) => n + r._count, 0)
  return { running, waiting, waitingCrawl: count(CRAWL_KINDS), waitingScreening: count(['TRIAGE']), waitingExtraction: count(['EXTRACT']) }
}

/** GET /api/funding/monitor/switch — the pipeline's position, who last moved it, and what is waiting. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  return NextResponse.json({ ...await pipelineSwitch(), ...await holding() }, { headers: { 'Cache-Control': 'private, no-store' } })
}

/** POST /api/funding/monitor/switch — run, pause crawling only, or stop the whole pipeline. */
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Say whether to run, pause crawling or stop' }, { status: 400 })
  const value = await setPipelineSwitch(parsed.data.mode, { by: auth.operator.email, reason: parsed.data.reason })
  console.info(`[monitor] pipeline switched to ${value.mode} by ${value.by}${value.reason ? `: ${value.reason}` : ''}`)
  return NextResponse.json({ ...value, ...await holding() })
}
