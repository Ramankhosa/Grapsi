import * as cheerio from 'cheerio'
import { prisma } from '@/lib/prisma'
import { fingerprint } from './hashing'
import { completeTaskInTx, enqueueTask, withFence, type Db, type Lease } from './queue'
import { scoreRelevance } from './relevance'
import { decodeBody, type SafeFetch } from './safeFetch'
import { sameSiteHost, identifyUrl } from './urlIdentity'
import type { MonitorSite } from '@/lib/prisma-generated'
import { tlsExceptionHosts } from './sites'
import { isMonitorFetchError } from './errors'
import { retainCoverageGap } from './coverage'

export const DISCOVERY_LIMITS = { requests: 10, frontier: 2000, depth: 4, linksPerPage: 150 }
export function isCrawlTrap(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.pathname.length > 600 || u.search.length > 250 || [...u.searchParams].length > 3) return true
    if ([...u.searchParams.keys()].some(k => /^(sort|filter|facet|session|sid|calendar|replytocom|print|share|search|q)$/i.test(k))) return true
    if (/\/(login|logout|signin|cart|checkout|wp-admin|search|calendar)\b/i.test(u.pathname)) return true
    const parts = u.pathname.split('/').filter(Boolean)
    return parts.some((p, i) => parts.slice(0, i).filter(v => v === p).length >= 2)
  } catch { return true }
}
export function discoveryScope(site: Pick<MonitorSite, 'host' | 'related_hosts'>) {
  return (host: string) => [site.host, ...site.related_hosts].some(h => sameSiteHost(h, host))
}
export async function addFrontier(db: Db, site: MonitorSite, urls: Array<{ url: string; title?: string; depth?: number; from?: string }>) {
  const count = await db.monitorCrawlFrontier.count({ where: { site_id: site.id } })
  const capacity = Math.max(0, DISCOVERY_LIMITS.frontier - count)
  for(const input of urls){
    const id=identifyUrl(input.url)
    if(id&&!discoveryScope(site)(id.host)&&/fund|grant|call|proposal|appl|fellow|scholar|अनुदान/i.test(`${input.title??''} ${id.canonical}`))await retainCoverageGap(db,site.id,id.canonical,'HOST_APPROVAL','Observed funding link requires related-host approval before fetching.')
    else if(id&&discoveryScope(site)(id.host))await db.monitorCoverageGap.updateMany({where:{site_id:site.id,url:id.canonical,kind:'HOST_APPROVAL',state:'OPEN'},data:{state:'RESOLVED',last_seen_at:new Date()}})
  }
  const candidates = urls.map(input => {
    const id = identifyUrl(input.url)
    if (!id || !discoveryScope(site)(id.host) || isCrawlTrap(id.canonical) || (input.depth ?? 0) > DISCOVERY_LIMITS.depth || /\.(pdf|docx?|png|zip|jpe?g|gif)([?#]|$)/i.test(id.canonical)) return null
    const score = scoreRelevance(input.title ?? '', '', id.canonical).score
    return { site_id: site.id, dedup_key: id.dedupKey, url: id.canonical, depth: input.depth ?? 0, discovered_from: input.from, score }
  }).filter((v): v is NonNullable<typeof v> => v !== null).sort((a, b) => b.score - a.score)
  const existing = new Set((await db.monitorCrawlFrontier.findMany({ where: { site_id: site.id, dedup_key: { in: candidates.map(c => c.dedup_key) } }, select: { dedup_key: true } })).map(c => c.dedup_key))
  const fresh = [...new Map(candidates.filter(c => !existing.has(c.dedup_key)).map(c => [c.dedup_key, c])).values()]
  const records = fresh.slice(0, capacity)
  for(const input of fresh.slice(capacity))await retainCoverageGap(db,site.id,input.url,'UNVISITED_LIMIT','Site exploration reached its retained frontier limit; this link has not been visited.')
  const added = records.length ? (await db.monitorCrawlFrontier.createMany({ data: records, skipDuplicates: true })).count : 0
  return { added, limited: fresh.length > capacity }
}
export async function watch(db: Db, site: MonitorSite, url: string, kind: 'PAGE' | 'FEED' | 'SITEMAP') {
  const existing = await db.monitoredSource.findFirst({ where: { site_id: site.id, url, kind } })
  if (existing) return
  await db.monitoredSource.create({ data: { site_id: site.id, name: `${site.display_name ?? site.host} ${kind.toLowerCase()}`, url, kind, fetch_mode: 'AUTO', frequency_minutes: 1440, next_check_at: new Date() } })
}
export async function discoverSite(lease: Lease, fetch: SafeFetch, signal?: AbortSignal) {
  const site = await prisma.monitorSite.findUniqueOrThrow({ where: { id: lease.siteId ?? String(lease.payload.siteId) }, include: { sources: true } })
  if (site.status !== 'ACTIVE') { await withFence(lease, tx => completeTaskInTx(tx, lease, { skipped: true })); return }
  const scope = discoveryScope(site)
  let initializationRequests = 0
  if (!await prisma.monitorSyncCursor.findUnique({ where: { name: `discovery-init:${site.id}` } })) {
    const urls = [{ url: `https://${site.host}/` }, ...site.sources.map(s => ({ url: s.url }))]
    for (const source of site.sources) {
      const u = new URL(source.url)
      const parts = u.pathname.split('/').filter(Boolean)
      while (parts.length > 1) { parts.pop(); urls.push({ url: `${u.origin}/${parts.join('/')}/` }) }
    }
    await withFence(lease, tx => addFrontier(tx, site, urls))
    let robotsText = ''
    initializationRequests = 1
    try { robotsText = decodeBody(await fetch(`https://${site.host}/robots.txt`, { robots: false, inScope: scope, signal, maxBytes: 512 * 1024 })) }
    catch (error) { if (!isMonitorFetchError(error) || !error.httpStatus || error.httpStatus < 400 || error.httpStatus >= 500 || error.httpStatus === 429) throw error }
    const hints = robotsText.matchAll(/^\s*Sitemap:\s*(https?:\/\/\S+)/gim)
    await withFence(lease, async tx => {
      for (const hint of [...hints].slice(0, 20)) {
        const id = identifyUrl(hint[1]); if (id && scope(id.host)) await watch(tx, site, id.canonical, 'SITEMAP')
      }
      await tx.monitorSyncCursor.upsert({ where: { name: `discovery-init:${site.id}` }, create: { name: `discovery-init:${site.id}`, cursor: { initialized: true } }, update: {} })
    })
  }
  const frontier = await prisma.monitorCrawlFrontier.findMany({ where: { site_id: site.id, state: { in: ['PENDING', 'VISITED', 'FAILED'] }, OR: [{ next_visit_at: null }, { next_visit_at: { lte: new Date() } }] }, orderBy: [{ score: 'desc' }, { created_at: 'asc' }], take: DISCOVERY_LIMITS.requests - initializationRequests })
  let visited = 0
  for (const entry of frontier) {
    let result
    try { result = await fetch(entry.url, { inScope: scope, signal, minDelayMs: site.min_delay_ms, tlsInsecureHosts: tlsExceptionHosts(site), maxBytes: 2_500_000 }) }
    catch (error) {
      if (isMonitorFetchError(error) && error.isDeferral) throw error
      await withFence(lease, tx => tx.monitorCrawlFrontier.update({ where: { id: entry.id }, data: { state: 'FAILED', next_visit_at: new Date(Date.now() + 7 * 86400_000) } }))
      continue
    }
    if (result.truncated || result.contentKind !== 'html') {
      await withFence(lease, tx => tx.monitorCrawlFrontier.update({ where: { id: entry.id }, data: { state: 'FAILED', next_visit_at: new Date(Date.now() + 7 * 86400_000) } }))
      continue
    }
    const $ = cheerio.load(decodeBody(result))
    $('script,style,noscript,footer').remove()
    const links: Array<{ url: string; title: string; depth: number; from: string }> = []
    $('a[href]').each((_, el) => {
      const id = identifyUrl($(el).attr('href') ?? '', result.finalUrl)
      if (id && scope(id.host)) links.push({ url: id.canonical, title: $(el).text().slice(0, 300), depth: entry.depth + 1, from: result.finalUrl })
    })
    await withFence(lease, async tx => {
      const cursorName = `discovery-links:${entry.id}`
      const previous = (await tx.monitorSyncCursor.findUnique({ where: { name: cursorName } }))?.cursor as { hash?: string; offset?: number } | undefined
      const hash = fingerprint(links.map(l => l.url))
      const offset = previous?.hash === hash ? previous.offset ?? 0 : 0
      const slice = links.slice(offset, offset + DISCOVERY_LIMITS.linksPerPage)
      const added = await addFrontier(tx, site, slice)
      const next = added.limited ? offset : offset + slice.length
      const depthLimited = entry.depth >= DISCOVERY_LIMITS.depth && links.some(l => !isCrawlTrap(l.url))
      const limited = added.limited || depthLimited
      const more = !limited && next < links.length
      await tx.monitorSyncCursor.upsert({ where: { name: cursorName }, create: { name: cursorName, cursor: { hash, offset: more || limited ? next : 0, limited } }, update: { cursor: { hash, offset: more || limited ? next : 0, limited } } })
      const title = $('h1').first().text() || $('title').text()
      const relevantLinks = links.filter(l => scoreRelevance(l.title, '', l.url).outcome === 'STRONG_POSITIVE')
      if (scoreRelevance(title, '', result.finalUrl).outcome === 'STRONG_POSITIVE' || relevantLinks.length >= 2) await watch(tx, site, result.finalUrl, 'PAGE')
      const feeds = $('link[rel="alternate"][type*="rss"],link[rel="alternate"][type*="atom"]').map((_, el) => $(el).attr('href') ?? '').get()
      for (const href of feeds.slice(0, 5)) {
        const id = identifyUrl(href, result.finalUrl)
        if (id && scope(id.host)) await tx.monitorCrawlFrontier.upsert({ where: { site_id_dedup_key: { site_id: site.id, dedup_key: id.dedupKey } }, create: { site_id: site.id, dedup_key: id.dedupKey, url: id.canonical, state: 'SUGGESTED_FEED', discovered_from: result.finalUrl }, update: {} })
      }
      // A feed stays a suggestion until its coverage is checked; no automatic switch.
      await tx.monitorCrawlFrontier.update({ where: { id: entry.id }, data: { state: limited ? 'SKIPPED_LIMIT' : more ? 'PENDING' : 'VISITED', visited_at: new Date(), next_visit_at: new Date(Date.now() + (more ? 3600000 : (relevantLinks.length ? 7 : 30) * 86400_000)) } })
    })
    visited += 1
  }
  const remaining = await prisma.monitorCrawlFrontier.count({ where: { site_id: site.id, state: 'PENDING' } })
  const failed = await prisma.monitorCrawlFrontier.count({ where: { site_id: site.id, state: { in: ['FAILED', 'SKIPPED_LIMIT'] } } })
  const total = await prisma.monitorCrawlFrontier.count({ where: { site_id: site.id } })
  await withFence(lease, async tx => {
    if (remaining) await enqueueTask(tx, { kind: 'DISCOVER_SITE', operationKey: `discover-continuation:${site.id}:${fingerprint({ parent: lease.operationKey, remaining, visited })}`, siteId: site.id, payload: { siteId: site.id }, availableAt: new Date(Date.now() + 3600_000), priority: 230 })
    await completeTaskInTx(tx, lease, { visited, pending: remaining, failed, frontierCap: DISCOVERY_LIMITS.frontier, limited: total >= DISCOVERY_LIMITS.frontier, complete: remaining === 0 && failed === 0 && total < DISCOVERY_LIMITS.frontier })
  })
}

/** Catalog URLs seed suggestions only: this function never performs network I/O. */
export async function seedCatalogSuggestions(limit = 500, after = '') {
  const calls = await prisma.fundingCall.findMany({ where: { id: { gt: after }, OR: [{ source_url: { not: null } }, { sourceUrl: { not: null } }] }, orderBy: { id: 'asc' }, take: Math.min(1000, limit), select: { id: true, source_url: true, sourceUrl: true, funder_id: true } })
  for (const call of calls) {
    const id = identifyUrl(call.source_url ?? call.sourceUrl ?? '')
    if (!id) continue
    await prisma.$transaction(async tx => {
      const site = await tx.monitorSite.upsert({ where: { host: id.host }, create: { host: id.host, origin: 'CATALOG_SEED', status: 'SUGGESTED' }, update: {} })
      if (call.funder_id) await tx.monitorSiteFunder.upsert({ where: { site_id_funder_id: { site_id: site.id, funder_id: call.funder_id } }, create: { site_id: site.id, funder_id: call.funder_id, status: 'SUGGESTED', evidence: { sourceUrl: id.canonical, callId: call.id } }, update: {} })
      if (await tx.monitorCrawlFrontier.count({ where: { site_id: site.id } }) < 100) {
        const url = new URL(id.canonical)
        const parts = url.pathname.split('/').filter(Boolean)
        const seeds = [{ url: `${url.origin}/`, from: `catalog:${call.id}` }]
        while (parts.length > 1) { parts.pop(); seeds.push({ url: `${url.origin}/${parts.join('/')}/`, from: `catalog:${call.id}` }) }
        await addFrontier(tx, site, [...seeds, { url: id.canonical, from: `catalog:${call.id}` }])
      }
    })
  }
  return { count: calls.length, next: calls.length ? calls[calls.length - 1].id : null }
}
