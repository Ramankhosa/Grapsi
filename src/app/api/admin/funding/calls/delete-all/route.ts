import { NextRequest, NextResponse } from 'next/server'

import {
  DELETE_ALL_CALLS_CONFIRMATION_PHRASE,
  isDeleteAllCallsConfirmation,
} from '@/lib/funding/catalogWipeConfirmation'
import { requireFundingPublisherRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const impact = await fundingCatalogService.getCatalogWipeImpact()
    return NextResponse.json({ impact, confirmationPhrase: DELETE_ALL_CALLS_CONFIRMATION_PHRASE })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load catalog wipe impact' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json().catch(() => ({}))
    if (!isDeleteAllCallsConfirmation(body?.confirmation)) {
      return NextResponse.json(
        {
          message: `Type "${DELETE_ALL_CALLS_CONFIRMATION_PHRASE}" to confirm deleting every funding call.`,
          reason: 'confirmation_required',
        },
        { status: 400 }
      )
    }

    const result = await fundingCatalogService.deleteAllFundingCalls(auth.operator)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Funding Catalog] delete-all error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to delete funding calls' },
      { status: 500 }
    )
  }
}
