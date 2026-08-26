import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { actorCanSeeTenantDrafts, buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingDocumentRetrievalService } from '@/lib/fundingDocuments/retrieval'
import { toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
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

    const accessibleCall = await prisma.fundingCall.findFirst({
      where: {
        id: fundingCallId,
        ...buildFundingCallAccessWhere(auth.actor, { includeTenantDrafts: await actorCanSeeTenantDrafts(auth.actor) }),
      },
      select: { id: true },
    })
    if (!accessibleCall) {
      return NextResponse.json({ error: 'Funding call not found' }, { status: 404 })
    }

    const fundingCall = await fundingCallsService.getFundingCallById(fundingCallId)
    if (!fundingCall || fundingCall.status !== 'PUBLISHED' || !fundingCall.isActive) {
      return NextResponse.json({ error: 'Funding call not found' }, { status: 404 })
    }

    let documentEvidence: Array<{
      sectionTitle: string | null
      sectionType: string
      pageStart: number
      pageEnd: number
      documentVersion: number
      text: string
    }> = []
    let documentQualityWarnings: string[] = []
    if (isFeatureEnabled('ENABLE_FUNDING_DOC_INTELLIGENCE')) {
      const evidenceChunks = await fundingDocumentRetrievalService.searchChunks({
        query: [userQuery || '', ...(userContext?.researchInterests || [])].filter(Boolean).join('\n') || 'research funding opportunity fit',
        fundingCallId,
        sectionTypes: ['thematic_areas', 'objectives', 'evaluation_criteria', 'eligibility'],
        callStatus: 'any',
        topK: 4,
        minSimilarity: 0.22,
        access: toRecommendationAccessScope(auth.actor),
        llmContext: {
          tenantId: auth.actor.tenantId,
          userId: auth.actor.id,
        },
      })
      documentEvidence = evidenceChunks.map((chunk) => ({
        sectionTitle: chunk.sectionTitle,
        sectionType: chunk.sectionType,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        documentVersion: chunk.documentVersion,
        text: chunk.chunkText,
      }))
      const warnings = new Set<string>()
      for (const chunk of evidenceChunks) {
        const flags = chunk.qualityFlags
        if (flags && typeof flags === 'object' && !Array.isArray(flags)) {
          const rawFlags = Array.isArray((flags as any).flags) ? (flags as any).flags : []
          rawFlags.forEach((flag: any) => {
            if (flag?.severity === 'warning' || flag?.severity === 'conflict') {
              warnings.add(String(flag.message || flag.code))
            }
          })
        }
      }
      documentQualityWarnings = Array.from(warnings)
    }

    const analysis = await sqlToLLMConnector.analyzeFundingOpportunity(fundingCall, userQuery || 'Seeking research funding', {
      userResearchInterests: userContext?.researchInterests,
      userInstitutionType: userContext?.institutionType,
      userCountry: userContext?.country,
      detailedAnalysis: true,
      llmContext: {
        tenantId: auth.actor.tenantId,
        userId: auth.actor.id,
      },
      documentEvidence,
      documentQualityWarnings,
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
