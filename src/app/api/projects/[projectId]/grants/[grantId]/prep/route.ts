import { NextRequest } from 'next/server'

import { GET as getProjectGrantPrepSession } from '@/app/api/projects/[projectId]/grants/[grantId]/route'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  return getProjectGrantPrepSession(request, { params })
}
