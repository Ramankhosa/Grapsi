import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest, requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { approveImportRequest, type ImportRequest } from '@/lib/monitor/catalogImport'
import { z } from 'zod'
import { seedCatalogSuggestions } from '@/lib/monitor/discovery'
import { enqueueTask } from '@/lib/monitor/queue'
import { discoveryScope } from '@/lib/monitor/discovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/sites — every site with its watch points and evidence counts. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const funderQuery = request.nextUrl.searchParams.get('funders')
  if (funderQuery !== null) return NextResponse.json({ funders: await prisma.funder.findMany({ where: { OR: [{ name: { contains: funderQuery.slice(0, 150), mode: 'insensitive' } }, { acronym: { contains: funderQuery.slice(0, 150), mode: 'insensitive' } }] }, select: { id: true, name: true, country_code: true }, take: 30, orderBy: { name: 'asc' } }) })

  const status = request.nextUrl.searchParams.get('status')
  const cursor = request.nextUrl.searchParams.get('cursor')
  const search = (request.nextUrl.searchParams.get('search') ?? '').slice(0, 150)
  const sites = await prisma.monitorSite.findMany({
    where: { ...(status ? { status } : {}), ...(cursor ? { id: { gt: cursor } } : {}), ...(search ? { host: { contains: search, mode: 'insensitive' } } : {}) },
    orderBy: { id: 'asc' },
    take: 100,
    include: {
      frontier: { where: { state: 'SUGGESTED_FEED' }, take: 20, select: { id: true, url: true } },
      sources: {
        select: {
          id: true,
          name: true,
          url: true,
          kind: true,
          status: true,
          fetch_mode: true,
          next_check_at: true,
          last_checked_at: true,
          last_complete_check_at: true,
          last_error: true,
          check_generation: true,
        },
      },
      _count: { select: { resources: true } },
    },
  })
  return NextResponse.json({ sites: sites.map(s => ({ ...s, daily_budget_micros: s.daily_budget_micros?.toString() ?? null, storage_quota_bytes: s.storage_quota_bytes?.toString() ?? null })), next: sites.length === 100 ? sites[99].id : null }, { headers: { 'Cache-Control': 'private, no-store' } })
}

const host = z.string().min(3).max(253).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i)
const change = z.object({ action: z.enum(['activate', 'pause', 'discover', 'configure', 'seed', 'approve_feed', 'confirm_website', 'approve_import', 'reject_import']), ids: z.array(z.string()).max(100).default([]), cursor: z.string().optional(), feedId: z.string().optional(), relatedHosts: z.array(host).max(20).optional(), attachmentHosts: z.array(host).max(20).optional(), funderId: z.string().optional(), confirmWebsite: z.boolean().optional(), tlsException: z.object({ reason: z.string().min(20).max(1000), expiresAt: z.string().datetime() }).nullable().optional() })
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  if (!auth.actor.roles.includes('SUPER_ADMIN')) return NextResponse.json({ message: 'A super admin approves sites and crawl scope' }, { status: 403 })
  const parsed = change.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Invalid site action' }, { status: 400 })
  const body = parsed.data
  if ((body.action === 'approve_feed' && (!body.feedId || body.ids.length !== 1)) || (body.action === 'confirm_website' && (!body.funderId || body.ids.length !== 1))) return NextResponse.json({ message: 'Select one site and its feed or funder' }, { status: 400 })
  if (body.confirmWebsite && !body.funderId) return NextResponse.json({ message: 'Select the confirmed funder for this website' }, { status: 400 })
  if (body.action === 'seed') return NextResponse.json(await seedCatalogSuggestions(500, body.cursor))
  if (body.tlsException && (Date.parse(body.tlsException.expiresAt) <= Date.now() || Date.parse(body.tlsException.expiresAt) > Date.now() + 7 * 86400_000)) return NextResponse.json({ message: 'A TLS exception must expire within seven days' }, { status: 400 })
  await prisma.$transaction(async tx => {
    for (const id of body.ids) {
      if (body.action === 'approve_import' || body.action === 'reject_import') {
        // An operator's catalogue-import request: scope, budget, priority and
        // funder links are applied only here, by a super admin.
        const site = await tx.monitorSite.findUniqueOrThrow({ where: { id } })
        const request = site.pending_scope as unknown as ImportRequest | null
        if (!request) throw new Error('This site has no import request waiting')
        if (body.action === 'approve_import') await approveImportRequest(tx, id, request, auth.actor.id)
        else await tx.monitorSite.update({ where: { id }, data: { pending_scope: Prisma.DbNull } })
        continue
      }
      if (body.action === 'approve_feed') {
        const site = await tx.monitorSite.findUniqueOrThrow({ where: { id } })
        const feed = await tx.monitorCrawlFrontier.findFirst({ where: { id: body.feedId, site_id: id, state: 'SUGGESTED_FEED' } })
        if (!feed || !discoveryScope(site)(new URL(feed.url).hostname)) throw new Error('Feed is no longer an in-scope suggestion')
        if (!await tx.monitoredSource.findFirst({ where: { site_id: id, url: feed.url, kind: 'FEED' } })) await tx.monitoredSource.create({ data: { site_id: id, name: `${site.host} approved feed`, url: feed.url, kind: 'FEED', frequency_minutes: 1440, next_check_at: new Date() } })
        await tx.monitorCrawlFrontier.update({ where: { id: feed.id }, data: { state: 'APPROVED_FEED' } })
      }
      if (body.action === 'confirm_website') {
        const site = await tx.monitorSite.findUniqueOrThrow({ where: { id } })
        const association = await tx.monitorSiteFunder.findUnique({ where: { site_id_funder_id: { site_id: id, funder_id: body.funderId! } } })
        if (association?.status !== 'CONFIRMED') throw new Error('Confirm the associated funder before saving its website')
        // A deliberate admin action; catalog seeding never writes funder websites.
        await tx.funder.update({ where: { id: body.funderId }, data: { website_url: `https://${site.host}/` } })
      }
      if (body.action === 'activate' || body.action === 'pause') await tx.monitorSite.update({ where: { id }, data: { status: body.action === 'activate' ? 'ACTIVE' : 'PAUSED' } })
      if (body.action === 'configure') {
        await tx.monitorCrawlFrontier.updateMany({ where: { site_id: id, state: 'SKIPPED_LIMIT' }, data: { state: 'PENDING', next_visit_at: new Date() } })
        await tx.monitorSite.update({ where: { id }, data: { ...(body.relatedHosts ? { related_hosts: body.relatedHosts } : {}), ...(body.attachmentHosts ? { attachment_hosts: body.attachmentHosts } : {}), ...(body.tlsException !== undefined ? { tls_exception: body.tlsException ? { reason: body.tlsException.reason, expires_at: body.tlsException.expiresAt, approved_by: auth.actor.id } : {} } : {}) } })
        if (body.funderId) await tx.monitorSiteFunder.upsert({ where: { site_id_funder_id: { site_id: id, funder_id: body.funderId } }, create: { site_id: id, funder_id: body.funderId, status: 'CONFIRMED', decided_by_user_id: auth.actor.id, decided_at: new Date() }, update: { status: 'CONFIRMED', decided_by_user_id: auth.actor.id, decided_at: new Date() } })
        if (body.confirmWebsite && body.funderId) { const site = await tx.monitorSite.findUniqueOrThrow({ where: { id } }); await tx.funder.update({ where: { id: body.funderId }, data: { website_url: `https://${site.host}/` } }) }
      }
      if (body.action === 'activate' || body.action === 'discover') await enqueueTask(tx, { kind: 'DISCOVER_SITE', operationKey: `discover-manual:${id}:${crypto.randomUUID()}`, siteId: id, payload: { siteId: id }, priority: 30 })
    }
  })
  return NextResponse.json({ ok: true })
}
