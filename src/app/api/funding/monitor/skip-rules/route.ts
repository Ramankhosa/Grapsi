import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { reconcileSkipRules, skipRuleKey } from '@/lib/monitor/skipRules'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createSchema = z.object({
  url: z.string().url().max(2000),
  match: z.enum(['PAGE', 'FOLDER']).default('PAGE'),
  reason: z.string().trim().max(500).optional(),
  /** Null or omitted: until an admin removes the rule. */
  days: z.number().int().min(1).max(365).nullish(),
})

/** GET /api/funding/monitor/skip-rules?siteId= — a site's "don't visit" marks. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const siteId = request.nextUrl.searchParams.get('siteId')
  if (!siteId) return NextResponse.json({ message: 'siteId is required' }, { status: 400 })
  const rules = await prisma.monitorSkipRule.findMany({ where: { site_id: siteId }, orderBy: { created_at: 'desc' } })
  return NextResponse.json({ rules }, { headers: { 'Cache-Control': 'private, no-store' } })
}

/** POST — mark a page, or everything under a folder, "don't visit". */
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  const { url, match, reason, days } = parsed.data

  const key = skipRuleKey(url, match)
  if (!key) return NextResponse.json({ message: 'Enter a web address that starts with http or https' }, { status: 400 })
  const bare = key.host.replace(/^www\./, '')
  const site = await prisma.monitorSite.findFirst({ where: { host: { in: [bare, `www.${bare}`] } } })
  if (!site) return NextResponse.json({ message: `${key.host} is not a watched website` }, { status: 404 })
  if (match === 'FOLDER' && new URL(key.url).pathname === '/') {
    return NextResponse.json({ message: 'To stop the whole website, pause it instead of marking its top folder' }, { status: 400 })
  }

  const expires_at = days ? new Date(Date.now() + days * 86400_000) : null
  const result = await prisma.$transaction(async (tx) => {
    const rule = await tx.monitorSkipRule.upsert({
      where: { site_id_dedup_key_match: { site_id: site.id, dedup_key: key.dedupKey, match } },
      create: { site_id: site.id, url: key.url, dedup_key: key.dedupKey, match, reason: reason || null, expires_at, created_by_user_id: auth.operator.userId },
      update: { reason: reason || null, expires_at, created_by_user_id: auth.operator.userId, created_at: new Date() },
    })
    return { rule, ...(await reconcileSkipRules(tx, site.id)) }
  })
  return NextResponse.json(result, { status: 201 })
}

/** DELETE ?id= — visit the page again from the next crawl. */
export async function DELETE(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ message: 'id is required' }, { status: 400 })
  const rule = await prisma.monitorSkipRule.findUnique({ where: { id } })
  if (!rule) return NextResponse.json({ message: 'That rule was already removed' }, { status: 404 })
  const result = await prisma.$transaction(async (tx) => {
    await tx.monitorSkipRule.delete({ where: { id } })
    return reconcileSkipRules(tx, rule.site_id)
  })
  return NextResponse.json({ ok: true, ...result })
}
