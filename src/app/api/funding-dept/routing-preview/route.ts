import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { managementAccess } from '@/lib/fundingDept/managementAccess'
import { researcherRoutingPreview, RoutingPreviewError } from '@/lib/fundingDept/researcherRoutingPreview'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const querySchema = z.object({ callId: z.string().trim().min(1).max(150).optional(), search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()

export async function GET(request: NextRequest) {
  const access = await managementAccess(request)
  if ('response' in access) {
    const response = access.response || NextResponse.json({ error: 'Funding department access required.' }, { status: 403 })
    response.headers.set('Cache-Control', headers['Cache-Control'])
    return response
  }
  if (!access.department) return NextResponse.json({ error: 'Department head access required.' }, { status: 403, headers })
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Check the preview filters.' }, { status: 400, headers })
  try {
    return NextResponse.json(await researcherRoutingPreview(access.context.tenantId, parsed.data), { headers })
  } catch (error) {
    if (error instanceof RoutingPreviewError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    console.error('Researcher routing preview unavailable', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Routing preview is temporarily unavailable. Retry shortly.' }, { status: 503, headers })
  }
}
