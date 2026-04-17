import { NextRequest } from 'next/server'

import { POST as postGrantPrepMessage } from '@/app/api/grant-prep/sessions/[id]/message/route'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { grantId } = await params
  return postGrantPrepMessage(request, {
    params: Promise.resolve({ id: grantId }),
  })
}
