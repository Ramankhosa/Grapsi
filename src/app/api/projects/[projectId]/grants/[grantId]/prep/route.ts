import { NextRequest } from 'next/server'

import { GET as getGrantPrepSession } from '@/app/api/grant-prep/sessions/[id]/route'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { grantId } = await params
  return getGrantPrepSession(request, {
    params: Promise.resolve({ id: grantId }),
  })
}
