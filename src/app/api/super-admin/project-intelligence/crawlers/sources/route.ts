import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectReadRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requirePublicProjectReadRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    return NextResponse.json(await publicProjectCorpusService.listSources())
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load public project sources' },
      { status: 500 }
    )
  }
}
