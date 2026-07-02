import { NextRequest, NextResponse } from 'next/server'

import { requirePublicProjectReadRequest } from '@/lib/publicProjects/auth'
import { publicProjectCorpusService } from '@/lib/publicProjects/service'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const auth = await requirePublicProjectReadRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  const project = await publicProjectCorpusService.getProject(
    params.projectId,
    request.nextUrl.searchParams.get('includeContacts') === 'true'
  )

  if (!project) {
    return NextResponse.json({ message: 'Public project not found' }, { status: 404 })
  }

  return NextResponse.json({ project })
}
