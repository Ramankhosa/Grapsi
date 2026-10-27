import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { MIN_FREQUENCY_MINUTES } from '@/lib/monitor/checker'
import { importWebsites, searchCatalogWebsites } from '@/lib/monitor/catalogImport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/catalog-import — websites behind the calls in the funding database. Operators only. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const p = request.nextUrl.searchParams
  const status = p.get('status')
  const country = (p.get('country') ?? '').toUpperCase()
  const result = await searchCatalogWebsites({
    q: p.get('q') ?? '',
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    funderType: p.get('type') || null,
    status: status === 'ANY' || status === 'CLOSED' ? status : 'LIVE',
    unwatchedOnly: p.get('unwatched') !== '0',
    includeOneOff: p.get('oneOff') === '1',
    offset: Math.max(0, Math.min(5000, Number(p.get('offset')) || 0)),
    limit: 25,
  })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
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
const body = z.object({ websites: z.array(website).min(1).max(25) })

/** POST — add the chosen websites to the pipeline, approved and due for a first check. */
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid input' }, { status: 400 })
  }
  const results = await importWebsites(parsed.data.websites, {
    userId: auth.operator.userId,
    superAdmin: auth.actor.roles.includes('SUPER_ADMIN'),
  })
  return NextResponse.json({ results })
}
