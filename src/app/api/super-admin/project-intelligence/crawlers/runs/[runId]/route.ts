import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectReadRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const auth = await requirePublicProjectReadRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  const run = await publicProjectCorpusService.getRun(params.runId)
  if (!run) {
    return NextResponse.json({ message: 'Crawl run not found' }, { status: 404 })
  }

  return NextResponse.json({ run })
}
