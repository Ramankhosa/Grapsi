import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingActor } from '@/lib/funding/access'
import { publicProjectSearchService } from '@/lib/publicProjects/searchService'

export const runtime = 'nodejs'
export const maxDuration = 60

const filtersSchema = z.object({
  sourceKeys: z.array(z.string().max(40)).max(10).optional(),
  yearFrom: z.number().int().min(1900).max(2100).optional(),
  yearTo: z.number().int().min(1900).max(2100).optional(),
  states: z.array(z.string().max(120)).max(20).optional(),
  schemes: z.array(z.string().max(240)).max(20).optional(),
  institutions: z.array(z.string().max(300)).max(20).optional(),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().nonnegative().optional(),
  disciplines: z.array(z.string().max(160)).max(20).optional(),
}).default({})

const searchSchema = z.object({
  query: z.string().max(1200).optional().default(''),
  filters: filtersSchema,
  limit: z.number().int().min(1).max(50).optional().default(20),
  offset: z.number().int().min(0).max(500).optional().default(0),
  sort: z.enum(['relevance', 'newest', 'largest_budget']).optional(),
})

export async function POST(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const input = searchSchema.parse(await request.json())
    if (input.filters.yearFrom && input.filters.yearTo && input.filters.yearFrom > input.filters.yearTo) {
      return NextResponse.json({ error: 'The start year cannot be after the end year.' }, { status: 400 })
    }
    if (input.filters.budgetMin && input.filters.budgetMax && input.filters.budgetMin > input.filters.budgetMax) {
      return NextResponse.json({ error: 'The minimum budget cannot exceed the maximum budget.' }, { status: 400 })
    }

    const response = await publicProjectSearchService.search({
      ...input,
      tenantId: auth.actor.tenantId,
      userId: auth.actor.id,
    })
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid search request' }, { status: 400 })
    }
    console.error('[ProjectIntelligence/Search] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Project search failed' },
      { status: 500 }
    )
  }
}
