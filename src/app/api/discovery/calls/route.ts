import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { requireRecommendationUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'
import { loadStandardAreas } from '@/lib/researchAreas/store'
import { validateDiscoveryAreas } from '@/lib/discovery/server'

export const dynamic = 'force-dynamic'
const schema = z.object({ mode: z.enum(['standard', 'semantic']), query: z.string().trim().max(300).default(''),
  areaIds: z.array(z.string().max(120)).max(20).default([]), page: z.number().int().min(1).max(500).default(1),
  includeClosed: z.boolean().default(false), sort: z.enum(['best_match', 'deadline_soonest']).default('best_match') }).strict()

export const GET = withCatalogueProtection(async (request: NextRequest) => {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) return auth.response
  return NextResponse.json({ areas: await loadStandardAreas() })
}, 'metadata')

export const POST = withCatalogueProtection(async (request: NextRequest) => {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Check your search: choose up to 20 areas or enter a topic of up to 300 characters.' }, { status: 400 })
  const input = parsed.data
  if (input.mode === 'semantic' && input.query.length < 3) return NextResponse.json({ error: 'Describe the research you want to find (at least 3 characters).' }, { status: 400 })
  try { await validateDiscoveryAreas(input.areaIds) } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
  const access = toRecommendationAccessScope(auth.actor)
  const filters = { lifecycleStatuses: input.includeClosed ? [] : ['OPEN', 'ROLLING'] as Array<'OPEN' | 'ROLLING'>,
    importedAreaIds: input.mode === 'standard' ? input.areaIds : [], limit: input.mode === 'semantic' ? 50 : 12, sort: input.sort }
  try {
    if (input.mode === 'standard') {
      const result = await recommendationSearchService.browseDirectory({ query: input.query, filters, access, page: input.page })
      return NextResponse.json({ calls: result.results, total: result.totalResults, page: result.page, totalPages: result.totalPages, basis: 'directory' })
    }
    // A topic is input evidence, not an instruction to generate or expand a query.
    const result = await recommendationSearchService.search({ inputMode: 'paper_metadata', query: { title: input.query }, filters, access })
    return NextResponse.json({ calls: result.results, total: result.results.length, page: 1, totalPages: 1, basis: 'semantic', bounded: true,
      warning: result.degradedMode ? 'Semantic retrieval is unavailable. These suggestions use text matching.' : result.lowConfidence ? 'These suggestions have limited evidence of relevance. Check the call scope carefully.' : null })
  } catch {
    return NextResponse.json({ error: 'Call search is temporarily unavailable. Please retry.' }, { status: 503 })
  }
}, 'summary', 'FUNDING_DISCOVERY')
