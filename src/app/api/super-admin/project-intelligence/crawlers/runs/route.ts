import { NextRequest, NextResponse } from 'next/server'

import type { PublicProjectCrawlMode, PublicProjectSourceKey } from '@/lib/prisma-generated'
import { requirePublicProjectReadRequest, requirePublicProjectWriteRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'
import { PUBLIC_PROJECT_SOURCE_DEFINITIONS } from '@/lib/publicProjects/sourceRegistry'

export const runtime = 'nodejs'

const VALID_SOURCES = new Set(PUBLIC_PROJECT_SOURCE_DEFINITIONS.map((source) => source.sourceKey))
const VALID_MODES = new Set(['pilot', 'full', 'incremental'])

export async function GET(request: NextRequest) {
  const auth = await requirePublicProjectReadRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') || 20)
    return NextResponse.json({ runs: await publicProjectCorpusService.listRuns(limit) })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load public project crawl runs' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePublicProjectWriteRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json().catch(() => ({}))
    const sourceKey = String(body.sourceKey || 'PRISM').toUpperCase()
    const mode = String(body.mode || 'pilot')

    if (!VALID_SOURCES.has(sourceKey as PublicProjectSourceKey)) {
      return NextResponse.json({ message: 'Unsupported public project source' }, { status: 400 })
    }
    if (!VALID_MODES.has(mode)) {
      return NextResponse.json({ message: 'Unsupported crawl mode' }, { status: 400 })
    }

    const run = await publicProjectCorpusService.createRun(
      {
        sourceKey: sourceKey as PublicProjectSourceKey,
        mode: mode as PublicProjectCrawlMode,
        filters: body.filters || {},
        confirmFullProduction: Boolean(body.confirmFullProduction),
      },
      auth.actor.id
    )

    return NextResponse.json({ run }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create public project crawl run' },
      { status: 400 }
    )
  }
}
