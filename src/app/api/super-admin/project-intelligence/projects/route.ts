import { NextRequest, NextResponse } from 'next/server'

import type { PublicProjectSourceKey } from '@/lib/prisma-generated'
import { requirePublicProjectReadRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'
import { PUBLIC_PROJECT_SOURCE_DEFINITIONS } from '@/lib/publicProjects/sourceRegistry'

export const runtime = 'nodejs'

const VALID_SOURCES = new Set(PUBLIC_PROJECT_SOURCE_DEFINITIONS.map((source) => source.sourceKey))

export async function GET(request: NextRequest) {
  const auth = await requirePublicProjectReadRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  const sourceKeyParam = request.nextUrl.searchParams.get('sourceKey')
  const sourceKey = sourceKeyParam ? sourceKeyParam.toUpperCase() : null
  if (sourceKey && !VALID_SOURCES.has(sourceKey as PublicProjectSourceKey)) {
    return NextResponse.json({ message: 'Unsupported public project source' }, { status: 400 })
  }

  try {
    const projects = await publicProjectCorpusService.listProjects({
      sourceKey: sourceKey as PublicProjectSourceKey | null,
      status: request.nextUrl.searchParams.get('status'),
      query: request.nextUrl.searchParams.get('query'),
      state: request.nextUrl.searchParams.get('state'),
      limit: Number(request.nextUrl.searchParams.get('limit') || 50),
      includeContacts: request.nextUrl.searchParams.get('includeContacts') === 'true',
    })
    return NextResponse.json({ projects })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load public projects' },
      { status: 500 }
    )
  }
}
