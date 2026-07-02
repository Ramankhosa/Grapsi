import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectWriteRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
      maxItems: body.maxItems ? Number(body.maxItems) : undefined,
    })
    return NextResponse.json({ processed })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to drain public project crawler work' },
      { status: 500 }
    )
  }
}
