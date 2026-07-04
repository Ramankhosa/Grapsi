import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectWriteRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function readDrainBatchSize(value: unknown) {
  const parsed = Number(value ?? process.env.PUBLIC_PROJECT_CRAWLER_HTTP_BATCH_SIZE ?? 100)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100
  }
  return Math.min(Math.floor(parsed), 250)
}

export async function POST(request: NextRequest) {
  const auth = await requirePublicProjectWriteRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json().catch(() => ({}))
    const processed = await publicProjectCorpusService.processNextRun({
      workerId: `api-drain:${auth.actor.id}`,
      runId: body.runId || undefined,
      // Keep request-triggered drains bounded, but avoid the old 10-item cap
      // that made file import runs appear to stop immediately.
      maxItems: readDrainBatchSize(body.maxItems),
    })
    return NextResponse.json({ processed })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to drain public project crawler work' },
      { status: 500 }
    )
  }
}
