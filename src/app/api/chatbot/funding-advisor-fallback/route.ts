import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'
import { ResponseFormattingService } from '@/lib/services/responseFormattingService'

const responseFormatter = new ResponseFormattingService()

const MAX_CONVERSATION_HISTORY = 10
const conversationHistory: Record<string, { messages: { role: 'user' | 'assistant'; content: string }[] }> = {}

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { query, conversationId = 'default' } = body as {
      query?: string
      conversationId?: string
    }

    if (!query) {
      return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
    }

    if (!conversationHistory[conversationId]) {
      conversationHistory[conversationId] = { messages: [] }
    }

    conversationHistory[conversationId].messages.push({ role: 'user', content: query })
    if (conversationHistory[conversationId].messages.length > MAX_CONVERSATION_HISTORY) {
      conversationHistory[conversationId].messages = conversationHistory[conversationId].messages.slice(-MAX_CONVERSATION_HISTORY)
    }

    const previousMessages = conversationHistory[conversationId].messages
    const previousResponseHadResults =
      previousMessages.length > 1 &&
      previousMessages[previousMessages.length - 2]?.role === 'assistant' &&
      previousMessages[previousMessages.length - 2]?.content.includes('funding opportunities that might interest you')

    const isFollowUpQuestion =
      query.toLowerCase().includes('more details') ||
      query.toLowerCase().includes('tell me more') ||
      query.toLowerCase().includes('about number') ||
      query.toLowerCase().includes('about the') ||
      /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b/i.test(query) ||
      /\b([1-5])\b/.test(query) ||
      query.length < 20

    const fundingKeywords = ['grant', 'funding', 'money', 'financial', 'support', 'scholarship', 'agriculture', 'agri', 'farm', 'food']
    const isFundingQuery = fundingKeywords.some((kw) => query.toLowerCase().includes(kw))
    const greetingKeywords = ['hello', 'hi', 'hey', 'greetings']
    const farewellKeywords = ['bye', 'goodbye', 'farewell', 'see you']
    const isGreeting = greetingKeywords.some((kw) => query.toLowerCase().match(new RegExp(`\\b${kw}\\b`)))
    const isFarewell = farewellKeywords.some((kw) => query.toLowerCase().match(new RegExp(`\\b${kw}\\b`)))

    let response = ''
    let results: any[] = []

    if (isGreeting) {
      response = "Hello! I'm your AI funding advisor. How can I help you find suitable grants and funding opportunities today?"
    } else if (isFarewell) {
      response = 'Goodbye! Feel free to come back when you need assistance with finding funding opportunities.'
    } else if (isFollowUpQuestion && previousResponseHadResults) {
      const lastSearchQuery = previousMessages[previousMessages.length - 3]?.content || ''
      const searchResult = await recommendationSearchService.search({
        inputMode: 'research_area',
        query: { researchArea: lastSearchQuery },
        filters: { limit: 5, includeExpired: false },
        access: toRecommendationAccessScope(auth.actor),
      })

      results = searchResult.rawResults.map((call) => ({
        id: call.id,
        agency: call.agencyName,
        title: call.schemeTitle,
        description: call.fullDescription || call.shortDescription || call.description,
        deadline: call.closeDate ? new Date(call.closeDate).toLocaleDateString() : 'Not specified',
        fundingAmount:
          call.amountMin !== null || call.amountMax !== null
            ? `${call.currency || ''} ${call.amountMin ?? ''}${call.amountMax !== null ? ` - ${call.amountMax}` : ''}`.trim()
            : 'Not specified',
        eligibility: call.eligibilityText || call.eligibilitySummary,
        researchAreas: call.disciplines,
        urls: call.officialUrls,
        similarity: call.score || 0.8,
      }))

      response = results.length
        ? `Here are more details about the latest published funding matches for "${lastSearchQuery}":\n\n` +
          results
            .slice(0, 5)
            .map(
              (item: any, index: number) =>
                `**${index + 1}. ${item.title}** by ${item.agency}\n` +
                `**Description:** ${String(item.description || '').slice(0, 200)}${String(item.description || '').length > 200 ? '...' : ''}\n` +
                `**Deadline:** ${item.deadline}\n` +
                `**Funding Amount:** ${item.fundingAmount}\n` +
                `**Research Areas:** ${item.researchAreas.join(', ')}`
            )
            .join('\n\n')
        : 'I could not match that follow-up to a current published funding result. Please run a new funding search.'
    } else if (isFundingQuery) {
      const searchResult = await recommendationSearchService.search({
        inputMode: 'research_area',
        query: { researchArea: query },
        filters: { limit: 5, includeExpired: false },
        access: toRecommendationAccessScope(auth.actor),
      })
      results = searchResult.rawResults.map((call) => ({
        id: call.id,
        agencyName: call.agencyName,
        schemeTitle: call.schemeTitle,
        description: call.fullDescription || call.shortDescription || call.description,
        deadline: call.closeDate,
        fundingAmount:
          call.amountMin !== null || call.amountMax !== null
            ? `${call.currency || ''} ${call.amountMin ?? ''}${call.amountMax !== null ? ` - ${call.amountMax}` : ''}`.trim()
            : null,
        eligibility: call.eligibilityText || call.eligibilitySummary,
        researchAreas: call.disciplines,
        urls: call.officialUrls,
        score: call.score,
      }))
      response = results.length
        ? `I found ${results.length} potential funding opportunities for "${query}":\n\n` +
          results
            .slice(0, 5)
            .map(
              (call: any, index: number) =>
                `${index + 1}. **${call.schemeTitle || call.title}** by ${call.agencyName || call.agency}\n   - Deadline: ${
                  call.deadline ? new Date(call.deadline).toLocaleDateString() : 'Not specified'
                }\n   - Funding: ${call.fundingAmount || 'Not specified'}`
            )
            .join('\n\n') +
          '\n\nWould you like more details about any of these opportunities?'
        : responseFormatter.formatFallbackResponse(query).message
    } else {
      response =
        'I can help with funding searches, eligibility questions, and grant-application advice. Tell me your research area or ask for funding opportunities relevant to your work.'
    }

    conversationHistory[conversationId].messages.push({ role: 'assistant', content: response })
    if (conversationHistory[conversationId].messages.length > MAX_CONVERSATION_HISTORY) {
      conversationHistory[conversationId].messages = conversationHistory[conversationId].messages.slice(-MAX_CONVERSATION_HISTORY)
    }

    return NextResponse.json({
      success: true,
      response,
      message: response,
      results,
      conversationId,
      messageHistory: conversationHistory[conversationId].messages,
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process fallback chatbot request', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
