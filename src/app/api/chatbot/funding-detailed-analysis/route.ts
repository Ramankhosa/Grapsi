import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCallsService } from '@/lib/services/fundingCallsService'
import { ResponseFormattingService, ResponseFormatType } from '@/lib/services/responseFormattingService'
import { SQLToLLMConnector } from '@/lib/services/sqlToLLMConnector'

const sqlToLLMConnector = new SQLToLLMConnector()
const responseFormatter = new ResponseFormattingService()

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { fundingCallId, userQuery, userContext } = body as {
      fundingCallId?: string
      userQuery?: string
      userContext?: {
        researchInterests?: string[]
        institutionType?: string
        country?: string
      }
      format?: string
      includeRawResults?: boolean
      includeMetadata?: boolean
      highlightKeywords?: string[]
    }

    if (!fundingCallId) {
      return NextResponse.json({ error: 'Missing fundingCallId parameter' }, { status: 400 })
    }

    const fundingCall = await fundingCallsService.getFundingCallById(fundingCallId)
    if (!fundingCall || fundingCall.status !== 'PUBLISHED' || !fundingCall.isActive) {
      return NextResponse.json({ error: 'Funding call not found' }, { status: 404 })
    }

    const analysis = await sqlToLLMConnector.analyzeFundingOpportunity(fundingCall, userQuery || 'Seeking research funding', {
      userResearchInterests: userContext?.researchInterests,
      userInstitutionType: userContext?.institutionType,
      userCountry: userContext?.country,
      detailedAnalysis: true,
    })

    const format =
      body.format === 'html'
        ? ResponseFormatType.HTML
        : body.format === 'json'
          ? ResponseFormatType.JSON
          : ResponseFormatType.MARKDOWN

    const formattedResponse = responseFormatter.formatDetailedAnalysis(analysis, fundingCall, {
      format,
      includeRawResults: Boolean(body.includeRawResults),
      includeMetadata: Boolean(body.includeMetadata),
      highlightKeywords: body.highlightKeywords || [],
    })

    return NextResponse.json({
      success: true,
      ...formattedResponse,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'An error occurred while analyzing the funding opportunity',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
