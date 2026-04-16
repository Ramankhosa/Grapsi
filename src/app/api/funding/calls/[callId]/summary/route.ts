import { NextRequest, NextResponse } from 'next/server'

import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const fundingCall = await prisma.fundingCall.findFirst({
      where: {
        AND: [{ id: params.callId }, buildFundingCallAccessWhere(auth.actor)],
      },
    })

    if (!fundingCall) {
      return NextResponse.json({ error: 'Funding call not found' }, { status: 404 })
    }

    return NextResponse.json({
      summary: {
        id: fundingCall.id,
        agency_name: fundingCall.agency_name,
        scheme_title: fundingCall.scheme_title,
        description: fundingCall.description,
        status: fundingCall.catalog_status,
        close_date: fundingCall.close_date,
        is_rolling: fundingCall.is_rolling,
        official_urls: fundingCall.official_urls,
        template_status: fundingCall.template_status,
        guideline_status: fundingCall.guideline_status,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load funding call summary',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
