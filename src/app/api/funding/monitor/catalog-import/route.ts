import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { MIN_FREQUENCY_MINUTES } from '@/lib/monitor/checker'
import { catalogFacets, importAllMatching, importWebsites, parseCatalogSearch, searchCatalogWebsites } from '@/lib/monitor/catalogImport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/funding/monitor/catalog-import — websites behind the calls in the
 * funding database. `?facets=1` returns the categories that exist instead.
 * Operators only.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const headers = { 'Cache-Control': 'private, no-store' }
  if (request.nextUrl.searchParams.get('facets') === '1') return NextResponse.json(await catalogFacets(), { headers })
  return NextResponse.json(await searchCatalogWebsites(parseCatalogSearch(request.nextUrl.searchParams)), { headers })
}

const host = z.string().min(3).max(253).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i)
const website = z.object({
  host,
  watchUrl: z.string().url().max(2000),
  pageKind: z.enum(['PAGE', 'FEED', 'SITEMAP']).default('PAGE'),
  funderIds: z.array(z.string().max(64)).max(40).default([]),
  officialWebsite: z.boolean().default(false),
  frequencyMinutes: z.number().int().min(MIN_FREQUENCY_MINUTES).max(20160).default(1440),
  priority: z.enum(['HIGH', 'NORMAL', 'LOW']).default('NORMAL'),
  relatedHosts: z.array(host).max(20).default([]),
  documentHosts: z.array(host).max(20).default([]),
  keywords: z.string().max(1000).default(''),
  excludeKeywords: z.string().max(1000).default(''),
  fetchMode: z.enum(['AUTO', 'FETCH', 'BROWSER']).default('AUTO'),
  dailyBudgetUsd: z.number().min(0).max(100).nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null),
})
const body = z.union([
  z.object({ websites: z.array(website).min(1).max(200) }),
  // Every website matching a search, with suggested settings.
  z.object({
    all: z.object({
      query: z.string().max(4000),
      defaults: z.object({
        frequencyMinutes: z.number().int().min(MIN_FREQUENCY_MINUTES).max(20160).nullable().default(null),
        priority: z.enum(['HIGH', 'NORMAL', 'LOW']).nullable().default(null),
        excludeKeywords: z.string().max(1000).default(''),
      }).default({}),
      excludeHosts: z.array(host).max(2000).default([]),
    }),
  }),
])

/** POST — add websites to the pipeline: the chosen ones, or every match of a search. */
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid input' }, { status: 400 })
  }
  const actor = { userId: auth.operator.userId, superAdmin: auth.actor.roles.includes('SUPER_ADMIN') }
  if ('all' in parsed.data) {
    const { query, defaults, excludeHosts } = parsed.data.all
    return NextResponse.json(await importAllMatching(parseCatalogSearch(new URLSearchParams(query)), defaults, excludeHosts, actor))
  }
  return NextResponse.json({ results: await importWebsites(parsed.data.websites, actor) })
}
