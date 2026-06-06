import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { toFundingCallSummary } from '@/lib/fundingIntake/compat'
import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import type { Prisma } from '@/lib/prisma-generated'

export const runtime = 'nodejs'

const STOP_WORDS = new Set([
  'about',
  'after',
  'against',
  'also',
  'and',
  'application',
  'applications',
  'available',
  'call',
  'calls',
  'can',
  'deadline',
  'for',
  'from',
  'funding',
  'grant',
  'grants',
  'guideline',
  'guidelines',
  'into',
  'joint',
  'may',
  'must',
  'not',
  'only',
  'proposal',
  'proposals',
  'research',
  'shall',
  'should',
  'submit',
  'submission',
  'that',
  'the',
  'their',
  'this',
  'through',
  'under',
  'with',
])

function clampLimit(value: string | null) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 100
  return Math.max(1, Math.min(50, Math.floor(parsed)))
}

function normalizeQuery(value: string | null | undefined, maxLength = 400) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s._/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function extractSearchTokens(...values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const value of values) {
    const normalized = normalizeQuery(value, 1200).toLowerCase()
    for (const token of normalized.match(/[\p{L}\p{N}][\p{L}\p{N}._/-]{1,}/gu) || []) {
      if (STOP_WORDS.has(token) || seen.has(token)) continue
      seen.add(token)
      tokens.push(token)
      if (tokens.length >= 8) return tokens
    }
  }
  return tokens
}

function scoreCall(call: any, tokens: string[], titleQuery: string, fullQuery: string) {
  const title = String(call.scheme_title || call.title || '').toLowerCase()
  const agency = String(call.agency_name || call.agencyName || '').toLowerCase()
  const description = String(call.description || call.summary || '').toLowerCase()
  const eligibility = String(call.eligibility_text || '').toLowerCase()
  const sourceUrl = String(call.source_url || call.sourceUrl || '').toLowerCase()
  const officialUrls = Array.isArray(call.official_urls) ? call.official_urls.join(' ').toLowerCase() : ''
  const disciplines = Array.isArray(call.disciplines) ? call.disciplines.join(' ').toLowerCase() : ''
  const haystack = [title, agency, description, eligibility, sourceUrl, officialUrls, disciplines].join(' ')
  let score = 0

  const titleNeedle = titleQuery.toLowerCase()
  const fullNeedle = fullQuery.toLowerCase()
  if (titleNeedle && title.includes(titleNeedle)) score += 80
  if (fullNeedle && title.includes(fullNeedle)) score += 60
  if (fullNeedle && agency.includes(fullNeedle)) score += 35
  if (fullNeedle && haystack.includes(fullNeedle)) score += 20

  for (const token of tokens) {
    if (title.includes(token)) score += 12
    else if (agency.includes(token)) score += 8
    else if (disciplines.includes(token)) score += 6
    else if (description.includes(token)) score += 4
    else if (eligibility.includes(token)) score += 3
    else if (sourceUrl.includes(token) || officialUrls.includes(token)) score += 10
  }

  return score
}

export async function GET(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const q = normalizeQuery(searchParams.get('q'), 240)
    const title = normalizeQuery(searchParams.get('title'), 200)
    const text = normalizeQuery(searchParams.get('text'), 500)
    const requestedLimit = clampLimit(searchParams.get('limit'))
    const query = normalizeQuery([title, q].filter(Boolean).join(' ') || text, 300)
    const tokens = extractSearchTokens(title, q, text)
    const urls = Array.from(
      new Set(`${q} ${title} ${text}`.match(/https?:\/\/[^\s"'<>]+/gi) || [])
    ).slice(0, 8)
    const searching = Boolean(query || tokens.length > 0)
    const textFilters: Prisma.FundingCallWhereInput[] = []

    for (const token of tokens.slice(0, 6)) {
      textFilters.push(
        { scheme_title: { contains: token, mode: 'insensitive' } },
        { title: { contains: token, mode: 'insensitive' } },
        { agency_name: { contains: token, mode: 'insensitive' } },
        { agencyName: { contains: token, mode: 'insensitive' } },
        { description: { contains: token, mode: 'insensitive' } },
        { summary: { contains: token, mode: 'insensitive' } },
        { eligibility_text: { contains: token, mode: 'insensitive' } },
        { source_url: { contains: token, mode: 'insensitive' } },
        { sourceUrl: { contains: token, mode: 'insensitive' } },
        { disciplines: { has: token } },
        { official_urls: { has: token } }
      )
    }

    if (urls.length > 0) {
      textFilters.push({ official_urls: { hasSome: urls } })
    }

    if (query) {
      textFilters.push(
        { scheme_title: { contains: query, mode: 'insensitive' } },
        { title: { contains: query, mode: 'insensitive' } },
        { agency_name: { contains: query, mode: 'insensitive' } },
        { agencyName: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
        { eligibility_text: { contains: query, mode: 'insensitive' } },
        { source_url: { contains: query, mode: 'insensitive' } },
        { sourceUrl: { contains: query, mode: 'insensitive' } }
      )
    }

    const calls = await prisma.fundingCall.findMany({
      where: searching
        ? {
            AND: [
              buildFundingCallAccessWhere(auth.actor),
              {
                OR: textFilters.length > 0 ? textFilters : undefined,
              },
            ],
          }
        : buildFundingCallAccessWhere(auth.actor),
      orderBy: { updatedAt: 'desc' },
      take: searching ? Math.max(40, requestedLimit * 6) : requestedLimit,
    })

    const rankedCalls = searching
      ? calls
          .map((call) => ({
            call,
            score: scoreCall(call, tokens, title || q, query),
          }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, requestedLimit)
          .map((item) => item.call)
      : calls

    return NextResponse.json({ calls: rankedCalls.map((call) => toFundingCallSummary(call)) })
  } catch (error) {
    console.error('[Funding/Calls] GET error:', error)
    return NextResponse.json({ error: 'Failed to list funding calls' }, { status: 500 })
  }
}
