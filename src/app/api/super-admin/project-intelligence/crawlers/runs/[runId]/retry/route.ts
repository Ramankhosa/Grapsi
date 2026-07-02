import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectWriteRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const auth = await requirePublicProjectWriteRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    return NextResponse.json({ run: await publicProjectCorpusService.retryRun(params.runId, auth.actor.id) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to retry public project crawl run' },
      { status: 400 }
    )
  }
}
