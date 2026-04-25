import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import type { RecommendationSearchRequest } from '@/lib/recommendations/types'
import { FundingAdvisorService } from '@/lib/services/fundingAdvisorService'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'
import { ResponseFormattingService, ResponseFormatType } from '@/lib/services/responseFormattingService'
import { SQLToLLMConnector } from '@/lib/services/sqlToLLMConnector'

const fundingAdvisorService = new FundingAdvisorService()
const sqlToLLMConnector = new SQLToLLMConnector()
const responseFormatter = new ResponseFormattingService()

const MAX_CONVERSATION_HISTORY = 10
const conversationHistory: Record<string, { userId: string; messages: { role: string; content: string }[] }> = {}

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { action, query, params, conversationId, messageHistory } = body as {
      action?: string
      query?: string
      params?: any
      conversationId?: string
      messageHistory?: { role: string; content: string }[]
      sort?: string
      format?: string
      highlightKeywords?: string[]
    }

    if (!action) {
      return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 })
    }

    const userId = auth.actor.id || auth.actor.email || 'anonymous'
    const convId = conversationId || `conv_${Date.now()}`
    if (!conversationHistory[convId]) {
      conversationHistory[convId] = { userId, messages: [] }
    }
    if (Array.isArray(messageHistory)) {
      conversationHistory[convId].messages = messageHistory.slice(-MAX_CONVERSATION_HISTORY)
    }

    let result: string

    switch (action) {
      case 'conversation': {
        if (!query) {
          return NextResponse.json({ error: 'Missing query parameter for conversation' }, { status: 400 })
        }
        const history = conversationHistory[convId].messages
          .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n\n')
        result = await fundingAdvisorService.processQuery({
          query,
          conversationHistory: history,
          access: toRecommendationAccessScope(auth.actor),
        })
        conversationHistory[convId].messages.push({ role: 'user', content: query })
        conversationHistory[convId].messages.push({ role: 'assistant', content: result })
        if (conversationHistory[convId].messages.length > MAX_CONVERSATION_HISTORY) {
          conversationHistory[convId].messages = conversationHistory[convId].messages.slice(-MAX_CONVERSATION_HISTORY)
        }
        return NextResponse.json({
          success: true,
          message: result,
          rawMessage: result,
          conversationId: convId,
          messageHistory: conversationHistory[convId].messages,
        })
      }
      case 'introduction':
        result = await fundingAdvisorService.getIntroduction()
        break
      case 'search': {
        if (!query) {
          return NextResponse.json({ error: 'Missing query parameter for search' }, { status: 400 })
        }
        const recommendationRequest: RecommendationSearchRequest = {
          inputMode: 'research_area',
          query: { researchArea: query },
          filters: {
            institutionTypes: params?.applicantTypes || [],
            fundingKinds: params?.grantTypes || [],
            eligibleCountries: params?.countries || [],
            includeExpired: params?.includeExpired || false,
            limit: params?.limit || 5,
            sort: body.sort === 'deadline_soonest' ? 'deadline_soonest' : 'best_match',
          },
          access: toRecommendationAccessScope(auth.actor),
        }
        const searchResult = await recommendationSearchService.search(recommendationRequest)
        if (searchResult.results.length === 0) {
          const fallbackResponse = responseFormatter.formatFallbackResponse(query)
          const suggestions =
            searchResult.relaxationSuggestions.length > 0
              ? `\n\nTry this next:\n- ${searchResult.relaxationSuggestions.join('\n- ')}`
              : ''
          return NextResponse.json({
            success: true,
            ...fallbackResponse,
            message: `${fallbackResponse.message}${suggestions}`,
            dataSource: 'database',
            hasResults: false,
            noResultsReason: searchResult.noResultsReason,
            relaxationSuggestions: searchResult.relaxationSuggestions,
          })
        }

        const legacyResults = searchResult.rawResults.map((item) => recommendationSearchService.toLegacyFundingCall(item))
        const similarities = searchResult.rawResults.map((item) => item.score)
        const llmResponse = await sqlToLLMConnector.generateSearchResponse(legacyResults, similarities, query, {
          userResearchInterests: params?.subjects,
          userInstitutionType: params?.orgType,
          userCountry: params?.countries?.[0],
          maxResultsToAnalyze: 5,
          detailedAnalysis: params?.detailedAnalysis,
        })

        const formattedSearchResponse = responseFormatter.formatSearchResults(llmResponse, legacyResults, similarities, {
          format:
            body.format === 'html'
              ? ResponseFormatType.HTML
              : body.format === 'json'
                ? ResponseFormatType.JSON
                : ResponseFormatType.MARKDOWN,
          includeRawResults: params?.includeRawResults || false,
          includeSimilarityScores: params?.includeSimilarityScores || false,
          includeMetadata: params?.includeMetadata || false,
          maxResultsToInclude: params?.maxResultsToInclude || 5,
          highlightKeywords: body.highlightKeywords || [],
        })

        return NextResponse.json({
          success: true,
          ...formattedSearchResponse,
          degradedMode: searchResult.degradedMode,
          lowConfidence: searchResult.lowConfidence,
        })
      }
      case 'eligibility':
        if (!params?.opportunityDetails) {
          return NextResponse.json({ error: 'Missing opportunity details for eligibility assessment' }, { status: 400 })
        }
        result = await fundingAdvisorService.assessEligibility({
          opportunityDetails: params.opportunityDetails,
          userCountry: params.userCountry || '',
          userOrgType: params.userOrgType || '',
          userCareerStage: params.userCareerStage || '',
          userResearchField: params.userResearchField || '',
        })
        break
      case 'advice':
        if (!params?.opportunityDetails) {
          return NextResponse.json({ error: 'Missing opportunity details for application advice' }, { status: 400 })
        }
        result = await fundingAdvisorService.getApplicationAdvice({ opportunityDetails: params.opportunityDetails })
        break
      case 'question':
        if (!query) {
          return NextResponse.json({ error: 'Missing query parameter for question' }, { status: 400 })
        }
        result = await fundingAdvisorService.answerQuestion(query)
        break
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    const format =
      body.format === 'html'
        ? ResponseFormatType.HTML
        : body.format === 'json'
          ? ResponseFormatType.JSON
          : ResponseFormatType.MARKDOWN

    const formattedResponse = responseFormatter.formatTextResponse(result, {
      format,
      highlightKeywords: body.highlightKeywords,
    })

    const isDatabaseResponse = result.includes('[Results from: **Database')
    const isNoMatchesFound = result.includes('No Matches Found')

    return NextResponse.json({
      success: true,
      ...formattedResponse,
      dataSource: isDatabaseResponse ? 'database' : 'other',
      hasResults: !isNoMatchesFound,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'An error occurred while processing your request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
