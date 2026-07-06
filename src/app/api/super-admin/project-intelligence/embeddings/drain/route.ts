import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectWriteRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function readEmbeddingDrainBatchSize(value: unknown) {
  const parsed = Number(value ?? process.env.PUBLIC_PROJECT_EMBEDDING_HTTP_BATCH_SIZE ?? 5)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5
  }
  return Math.min(Math.floor(parsed), 10)
}

export async function POST(request: NextRequest) {
  const auth = await requirePublicProjectWriteRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await publicProjectCorpusService.processPendingEmbeddings({
      limit: readEmbeddingDrainBatchSize(body.limit),
      includeFailed: body.includeFailed === true,
      includeCoverage: body.includeCoverage === true,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to drain public project embeddings' },
      { status: 500 }
    )
  }
}
