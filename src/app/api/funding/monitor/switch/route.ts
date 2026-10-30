import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'
import { pipelineSwitch, setPipelineSwitch } from '@/lib/monitor/pipelineSwitch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({ paused: z.boolean(), reason: z.string().max(300).optional() })

/** What a stopped pipeline is holding: tasks running now, and work waiting to resume. */
async function holding() {
  const [running, waiting] = await Promise.all([
    prisma.monitorTask.count({ where: { status: 'RUNNING' } }),
    prisma.monitorTask.count({ where: { status: { in: ['QUEUED', 'DEFERRED_BUDGET', 'PAUSED_PROVIDER'] } } }),
  ])
  return { running, waiting }
}

/** GET /api/funding/monitor/switch — is the pipeline on, and who last changed it. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  return NextResponse.json({ ...await pipelineSwitch(), ...await holding() }, { headers: { 'Cache-Control': 'private, no-store' } })
}

/** POST /api/funding/monitor/switch — the master switch: stop or start the whole pipeline. */
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Say whether to stop or start' }, { status: 400 })
  const value = await setPipelineSwitch(parsed.data.paused, { by: auth.operator.email, reason: parsed.data.reason })
  console.info(`[monitor] pipeline switched ${value.paused ? 'OFF' : 'ON'} by ${value.by}${value.reason ? `: ${value.reason}` : ''}`)
  return NextResponse.json({ ...value, ...await holding() })
}
