import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { replayTask } from '@/lib/monitor/queue'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/tasks/:id — poll a queued task (Check now) and its check run. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const task = await prisma.monitorTask.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      kind: true,
      status: true,
      attempts: true,
      max_attempts: true,
      available_at: true,
      last_error: true,
      terminal_reason: true,
      result: true,
      source_id: true,
      payload: true,
      finished_at: true,
    },
  })
  if (!task) return NextResponse.json({ message: 'Not found' }, { status: 404 })

  const generation = Number((task.payload as { generation?: number } | null)?.generation ?? -1)
  const checkRun =
    task.kind === 'CHECK_SOURCE' && task.source_id
      ? await prisma.monitorCheckRun.findUnique({
          where: { source_id_check_generation: { source_id: task.source_id, check_generation: generation } },
        })
      : null
  return NextResponse.json({ task, checkRun }, { headers: { 'Cache-Control': 'private, no-store' } })
}

const replaySchema = z.object({ action: z.literal('replay'), reason: z.string().trim().min(3).max(500) })

/**
 * POST /api/funding/monitor/tasks/:id — deliberate replay from the dead-letter
 * view. A DONE task replays as a new, recorded occurrence; a dead one is reset.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  const parsed = replaySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Give a reason for the replay' }, { status: 400 })
  try {
    const result = await replayTask(params.id, `${parsed.data.reason} (by ${auth.actor.email})`)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Replay failed' }, { status: 409 })
  }
}
