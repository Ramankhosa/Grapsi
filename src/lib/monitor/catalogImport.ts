import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { enqueueTask } from './queue'
import { identifyUrl, sameSiteHost } from './urlIdentity'
import { normalizeUrl } from './urls'

/**
 * Picking websites to watch from the funding database. Calls are grouped by
 * the host of their source URL: Source Watch watches a website's listing page,
 * never one call, so one row stands for every call published on that host.
 *
 * Funders carry no website of their own yet (website_url is empty everywhere),
 * so call URLs are the only evidence of where a funder publishes.
 */

export interface CatalogSearch {
  q: string
  country: string | null
  funderType: string | null
  /** LIVE: has an open, rolling or forthcoming call. CLOSED: none live. */
  status: 'LIVE' | 'ANY' | 'CLOSED'
  unwatchedOnly: boolean
  /** Websites with a single call are usually one-off links, hidden by default. */
  includeOneOff: boolean
  offset: number
  limit: number
}

export interface CatalogFunder { id: string; name: string; country: string | null; type: string | null; calls: number }

export interface WatchPageSuggestion { url: string; covers: number; reason: string }

export type WebsiteWarning = 'FILE_HOST' | 'SHARED_PORTAL' | 'FUNDER_MISMATCH' | 'NEEDS_BROWSER' | 'FEW_CALLS'

export interface CatalogWebsite {
  host: string
  calls: number
  liveCalls: number
  documents: number
  funders: CatalogFunder[]
  sampleUrls: string[]
  watched: { siteId: string; status: string; watchPoints: number } | null
  suggestions: WatchPageSuggestion[]
  warnings: Array<{ code: WebsiteWarning; message: string }>
  suggested: { frequencyMinutes: number; priority: 'HIGH' | 'NORMAL' | 'LOW'; documentHosts: string[] }
}

const LIVE_STATUSES = ['OPEN', 'ROLLING', 'FORTHCOMING']
const DOCUMENT_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rtf|odt)([?#]|$)/i
const FILE_HOST_RE = /^(cdn|files?|assets|static|storage|media|uploads?|docs?)[0-9]*\./i

/** Country implied by a host's top-level domain, for spotting a wrong funder link. */
function tldCountry(host: string): string | null {
  const tld = host.split('.').pop()?.toLowerCase() ?? ''
  if (tld === 'uk') return 'GB'
  if (tld.length !== 2 || ['eu', 'io', 'co', 'ai', 'me', 'tv'].includes(tld)) return null
  return tld.toUpperCase()
}

/**
 * Pages worth watching, from the call URLs on one host: the folder most call
 * pages share (a listing usually sits there), the nearest common parent, and
 * the homepage as the fallback the crawler explores from.
 */
export function suggestWatchPages(host: string, urls: string[], totalCalls = urls.length): WatchPageSuggestion[] {
  const pages: string[][] = []
  let secure = 0
  for (const raw of urls) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'https:') secure += 1
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length) parts.pop() // the call page or document itself
      pages.push(parts)
    } catch {
      // not a URL; skip
    }
  }
  // Keep the scheme the site itself uses; plain-http sites still exist.
  const origin = `${secure * 2 >= pages.length ? 'https' : 'http'}://${host}`
  const total = pages.length
  const of = (n: number) => `${n} of ${total}${total < totalCalls ? ' sampled' : ''} call pages sit under this folder`
  const counts = new Map<string, number>()
  for (const parts of pages) {
    const seen = new Set<string>()
    for (let i = 1; i <= parts.length; i += 1) {
      const folder = parts.slice(0, i).join('/')
      if (!seen.has(folder)) {
        seen.add(folder)
        counts.set(folder, (counts.get(folder) ?? 0) + 1)
      }
    }
  }
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= Math.max(2, Math.ceil(total * 0.2)))
    .sort((a, b) => b[1] - a[1] || b[0].split('/').length - a[0].split('/').length)

  const out: WatchPageSuggestion[] = []
  // Deepest folder that still holds at least half of the calls.
  const majority = [...counts.entries()]
    .filter(([, n]) => n >= Math.ceil(total * 0.5) && total >= 2)
    .sort((a, b) => b[0].split('/').length - a[0].split('/').length || b[1] - a[1])[0]
  if (majority) out.push({ url: `${origin}/${majority[0]}/`, covers: majority[1], reason: of(majority[1]) })
  for (const [folder, n] of ranked) {
    if (out.length >= 3) break
    const url = `${origin}/${folder}/`
    if (!out.some((s) => s.url === url)) out.push({ url, covers: n, reason: of(n) })
  }
  out.push({ url: `${origin}/`, covers: total, reason: 'Homepage; the crawler explores from here to find listings and feeds' })
  return out
}

export function websiteWarnings(input: { host: string; calls: number; documents: number; funders: CatalogFunder[]; sampleUrls: string[] }): CatalogWebsite['warnings'] {
  const warnings: CatalogWebsite['warnings'] = []
  if (FILE_HOST_RE.test(input.host) || (input.calls >= 3 && input.documents / input.calls >= 0.6)) {
    warnings.push({ code: 'FILE_HOST', message: 'Mostly files, not pages. Watch the page that links to them, and add this host as a document host there.' })
  }
  if (input.funders.length >= 5) {
    warnings.push({ code: 'SHARED_PORTAL', message: `${input.funders.length} funders publish here. Tick only the funders this watch is for.` })
  }
  const expected = tldCountry(input.host)
  const odd = expected ? input.funders.filter((f) => f.country && f.country !== expected) : []
  if (expected && odd.length) {
    warnings.push({ code: 'FUNDER_MISMATCH', message: `Some linked funders are from ${[...new Set(odd.map((f) => f.country))].join(', ')}, but this website is in ${expected}. Check the funder links.` })
  }
  // Hash routes (#/…, #!…) and portal "screens" are rendered by scripts; a plain
  // in-page anchor (#section) is not.
  const appStyle = input.sampleUrls.filter((u) => /#!|#\/|\/portal\/screen\//i.test(u)).length
  if (appStyle > 0 && appStyle * 4 >= input.sampleUrls.length) {
    warnings.push({ code: 'NEEDS_BROWSER', message: 'Looks like an app-style portal. It may only show calls in a browser.' })
  }
  if (input.calls < 3) warnings.push({ code: 'FEW_CALLS', message: 'Very few calls come from here.' })
  return warnings
}

export function suggestedSettings(input: { calls: number; liveCalls: number; sampleUrls: string[]; host: string }): CatalogWebsite['suggested'] {
  const documentHosts = new Set<string>()
  for (const raw of input.sampleUrls) {
    try {
      const url = new URL(raw)
      if (DOCUMENT_RE.test(url.pathname) && url.hostname !== input.host) documentHosts.add(url.hostname)
    } catch {
      // skip
    }
  }
  return {
    frequencyMinutes: input.calls >= 50 ? 1440 : input.calls >= 10 ? 4320 : 10080,
    priority: input.liveCalls >= 20 ? 'HIGH' : input.liveCalls >= 1 ? 'NORMAL' : 'LOW',
    documentHosts: [...documentHosts].slice(0, 5),
  }
}

interface HostRow {
  host: string
  calls: number
  live_calls: number
  documents: number
  sample_urls: string[]
  funders: CatalogFunder[] | null
  site_id: string | null
  site_status: string | null
  watch_points: number | null
  total: number
}

const HOST_SQL = Prisma.sql`lower(substring(coalesce(c.source_url, c."sourceUrl") from '^https?://([^/:?#]+)'))`

export async function searchCatalogWebsites(search: CatalogSearch): Promise<{ websites: CatalogWebsite[]; total: number }> {
  const q = search.q.trim().slice(0, 150)
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
  const live = Prisma.join(LIVE_STATUSES)
  const matchQ = q
    ? Prisma.sql`AND (${HOST_SQL} ILIKE ${like} OR f.name ILIKE ${like} OR f.acronym ILIKE ${like} OR c.title ILIKE ${like} OR c.agency_name ILIKE ${like} OR c."agencyName" ILIKE ${like} OR c.programme_framework ILIKE ${like})`
    : Prisma.empty
  const matchCountry = search.country ? Prisma.sql`AND (f.country_code = ${search.country} OR c.funder_country_code = ${search.country})` : Prisma.empty
  const matchType = search.funderType ? Prisma.sql`AND f.funder_type = ${search.funderType}` : Prisma.empty
  const having = [
    search.includeOneOff ? null : Prisma.sql`count(*) >= 2`,
    search.status === 'LIVE' ? Prisma.sql`count(*) FILTER (WHERE c.opportunity_status IN (${live})) > 0` : null,
    search.status === 'CLOSED' ? Prisma.sql`count(*) FILTER (WHERE c.opportunity_status IN (${live})) = 0` : null,
  ].filter((part): part is Prisma.Sql => part !== null)
  const unwatched = search.unwatchedOnly ? Prisma.sql`WHERE s.id IS NULL OR s.status <> 'ACTIVE'` : Prisma.empty

  const rows = await prisma.$queryRaw<HostRow[]>(Prisma.sql`
    WITH matched AS (
      SELECT DISTINCT ${HOST_SQL} AS host
      FROM funding_calls c LEFT JOIN funders f ON f.id = c.funder_id
      WHERE coalesce(c.source_url, c."sourceUrl") IS NOT NULL ${matchQ} ${matchCountry} ${matchType}
    ),
    calls AS (
      SELECT ${HOST_SQL} AS host, c.opportunity_status, coalesce(c.source_url, c."sourceUrl") AS url, c.funder_id
      FROM funding_calls c
      WHERE coalesce(c.source_url, c."sourceUrl") IS NOT NULL AND ${HOST_SQL} IN (SELECT host FROM matched WHERE host IS NOT NULL)
    ),
    per_host AS (
      SELECT host,
        count(*)::int AS calls,
        count(*) FILTER (WHERE opportunity_status IN (${live}))::int AS live_calls,
        count(*) FILTER (WHERE url ~* '\\.(pdf|docx?|xlsx?|pptx?|zip|rtf|odt)([?#]|$)')::int AS documents,
        (array_agg(url ORDER BY (opportunity_status IN (${live})) DESC, url))[1:300] AS sample_urls
      FROM calls c GROUP BY host
      ${having.length ? Prisma.sql`HAVING ${Prisma.join(having, ' AND ')}` : Prisma.empty}
    ),
    per_funder AS (
      SELECT c.host, json_agg(json_build_object('id', f.id, 'name', f.name, 'country', f.country_code, 'type', f.funder_type, 'calls', c.n) ORDER BY c.n DESC) AS funders
      FROM (SELECT host, funder_id, count(*)::int AS n FROM calls WHERE funder_id IS NOT NULL GROUP BY host, funder_id) c
      JOIN funders f ON f.id = c.funder_id
      GROUP BY c.host
    )
    SELECT h.*, pf.funders, s.id AS site_id, s.status AS site_status,
      (SELECT count(*)::int FROM monitored_sources ms WHERE ms.site_id = s.id) AS watch_points,
      count(*) OVER ()::int AS total
    FROM per_host h
    LEFT JOIN per_funder pf ON pf.host = h.host
    LEFT JOIN monitor_sites s ON regexp_replace(s.host, '^www\\.', '') = regexp_replace(h.host, '^www\\.', '')
    ${unwatched}
    ORDER BY h.live_calls DESC, h.calls DESC, h.host
    LIMIT ${search.limit} OFFSET ${search.offset}
  `)

  const websites = rows.map((row): CatalogWebsite => {
    const funders = row.funders ?? []
    const pageUrls = row.sample_urls.filter((u) => !DOCUMENT_RE.test(u))
    const base = { host: row.host, calls: row.calls, documents: row.documents, funders, sampleUrls: row.sample_urls }
    return {
      ...base,
      liveCalls: row.live_calls,
      sampleUrls: row.sample_urls.slice(0, 5),
      watched: row.site_id ? { siteId: row.site_id, status: row.site_status ?? 'UNKNOWN', watchPoints: row.watch_points ?? 0 } : null,
      suggestions: suggestWatchPages(row.host, pageUrls.length ? pageUrls : row.sample_urls, pageUrls.length ? row.calls - row.documents : row.calls),
      warnings: websiteWarnings(base),
      suggested: suggestedSettings({ calls: row.calls, liveCalls: row.live_calls, sampleUrls: row.sample_urls, host: row.host }),
    }
  })
  return { websites, total: rows[0]?.total ?? 0 }
}

export interface ImportWebsite {
  host: string
  watchUrl: string
  pageKind: 'PAGE' | 'FEED' | 'SITEMAP'
  funderIds: string[]
  officialWebsite: boolean
  frequencyMinutes: number
  priority: 'HIGH' | 'NORMAL' | 'LOW'
  relatedHosts: string[]
  documentHosts: string[]
  keywords: string
  excludeKeywords: string
  fetchMode: 'AUTO' | 'FETCH' | 'BROWSER'
  dailyBudgetUsd: number | null
  note: string | null
}

export interface ImportResult {
  host: string
  status: 'ADDED' | 'ALREADY_WATCHED' | 'PENDING_APPROVAL' | 'BLOCKED' | 'INVALID'
  message: string
  siteId: string | null
  funderLinks: 'CONFIRMED' | 'SUGGESTED' | 'NONE'
  websiteSaved: number
  notes: string[]
}

/**
 * Everything a catalogue import asks to change on a site beyond adding a
 * watched page: activation, crawl scope, priority, budget and funder links.
 * A super admin's import applies it at once; anyone else's is stored on the
 * site as `pending_scope` and applied only by a super admin's approval.
 */
export interface ImportRequest {
  watchUrl: string
  relatedHosts: string[]
  documentHosts: string[]
  dailyBudgetUsd: number | null
  priority: 'HIGH' | 'NORMAL' | 'LOW'
  funderIds: string[]
  officialWebsite: boolean
  requestedBy: string
  requestedAt: string
}

type Tx = Prisma.TransactionClient

function unionHosts(current: string[], extra: string[]) {
  return [...new Set([...current, ...extra.map((h) => h.toLowerCase())])].slice(0, 20)
}

/**
 * Apply an import request as a super admin: the site becomes ACTIVE with the
 * requested scope, priority and (only when one was given) budget; the funder
 * links are confirmed and, when asked, saved as the funders' website. The
 * pending request is cleared. Used by a super admin's own import and by the
 * approval of an operator's request on the Sites screen.
 */
export async function approveImportRequest(tx: Tx, siteId: string, request: ImportRequest, approverId: string) {
  const site = await tx.monitorSite.findUniqueOrThrow({ where: { id: siteId } })
  if (site.status === 'BLOCKED') throw new Error('This website is blocked. Unblock it before approving an import.')
  const funders = request.funderIds.length ? await tx.funder.findMany({ where: { id: { in: request.funderIds } }, select: { id: true, name: true } }) : []
  await tx.monitorSite.update({
    where: { id: siteId },
    data: {
      status: 'ACTIVE',
      priority: request.priority,
      related_hosts: unionHosts(site.related_hosts, request.relatedHosts),
      attachment_hosts: unionHosts(site.attachment_hosts, request.documentHosts),
      // The current spending cap stays unless a budget was explicitly asked for.
      ...(request.dailyBudgetUsd !== null ? { daily_budget_micros: BigInt(Math.round(request.dailyBudgetUsd * 1_000_000)) } : {}),
      display_name: site.display_name ?? funders[0]?.name ?? null,
      pending_scope: Prisma.DbNull,
    },
  })
  for (const funder of funders) {
    await tx.monitorSiteFunder.upsert({
      where: { site_id_funder_id: { site_id: siteId, funder_id: funder.id } },
      create: { site_id: siteId, funder_id: funder.id, status: 'CONFIRMED', evidence: { source: 'catalog-import', watchUrl: request.watchUrl }, decided_by_user_id: approverId, decided_at: new Date() },
      update: { status: 'CONFIRMED', decided_by_user_id: approverId, decided_at: new Date() },
    })
  }
  const websiteSaved = request.officialWebsite && funders.length
    ? (await tx.funder.updateMany({ where: { id: { in: funders.map((f) => f.id) }, website_url: null }, data: { website_url: `https://${site.host}/` } })).count
    : 0
  if (site.status !== 'ACTIVE') {
    await enqueueTask(tx, { kind: 'DISCOVER_SITE', operationKey: `discover-import:${siteId}:${randomUUID()}`, siteId, payload: { siteId }, priority: 30 })
  }
  return { websiteSaved, funders: funders.length }
}

/**
 * Add chosen websites to the pipeline. Every import adds the chosen page as a
 * watch point. A super admin's import also approves the site (ACTIVE, scope,
 * priority, budget, funder links) at once. A delegated operator can never
 * activate a site, widen its crawl scope or change its budget here: their
 * choices are saved as a request for a super admin, and a site they bring in
 * stays SUGGESTED — nothing is fetched — until that approval.
 */
export async function importWebsites(items: ImportWebsite[], actor: { userId: string; superAdmin: boolean }): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  const laptopNote = process.env.MONITOR_LOCAL_SCREENING_REQUIRED === 'true'
    ? 'Laptop-first screening is on: add this host to the laptop worker’s allowed hosts, or its pages will wait for analysis.'
    : null
  for (const item of items) {
    const id = identifyUrl(item.watchUrl)
    if (!id || !sameSiteHost(id.host, item.host)) {
      results.push({ host: item.host, status: 'INVALID', message: `The page to watch must be on ${item.host}`, siteId: null, funderLinks: 'NONE', websiteSaved: 0, notes: [] })
      continue
    }
    const url = normalizeUrl(id.canonical)
    const bare = item.host.toLowerCase().replace(/^www\./, '')
    const request: ImportRequest = {
      watchUrl: url,
      relatedHosts: item.relatedHosts,
      documentHosts: item.documentHosts,
      dailyBudgetUsd: item.dailyBudgetUsd,
      priority: item.priority,
      funderIds: item.funderIds,
      officialWebsite: item.officialWebsite,
      requestedBy: actor.userId,
      requestedAt: new Date().toISOString(),
    }
    results.push(await prisma.$transaction(async (tx): Promise<ImportResult> => {
      const existing = await tx.monitorSite.findFirst({ where: { host: { in: [bare, `www.${bare}`] } } })
      if (existing?.status === 'BLOCKED') {
        return { host: item.host, status: 'BLOCKED', message: 'This website is blocked. A super admin has to unblock it first.', siteId: existing.id, funderLinks: 'NONE', websiteSaved: 0, notes: [] }
      }
      const funders = item.funderIds.length ? await tx.funder.findMany({ where: { id: { in: item.funderIds } }, select: { id: true, name: true } }) : []
      // A new site starts SUGGESTED; only approval below makes it ACTIVE.
      const site = existing ?? await tx.monitorSite.create({
        data: { host: item.host.toLowerCase(), status: 'SUGGESTED', origin: 'CATALOG_IMPORT', created_by_user_id: actor.userId, display_name: funders[0]?.name ?? null },
      })

      const watching = await tx.monitoredSource.findFirst({ where: { site_id: site.id, OR: [{ url }, { url: `${url}/` }] }, select: { name: true } })
      if (!watching) {
        await tx.monitoredSource.create({
          data: {
            site_id: site.id,
            name: `${site.display_name ?? funders[0]?.name ?? site.host} ${item.pageKind === 'PAGE' ? 'listing' : item.pageKind.toLowerCase()}`,
            url,
            kind: item.pageKind,
            fetch_mode: item.fetchMode,
            frequency_minutes: item.frequencyMinutes,
            priority: item.priority,
            origin: 'CATALOG_IMPORT',
            keywords: item.keywords,
            exclude_keywords: item.excludeKeywords,
            notes: item.note,
            owner_user_id: actor.userId,
            created_by_user_id: actor.userId,
            next_check_at: new Date(),
          },
        })
      }
      const notes = laptopNote ? [laptopNote] : []

      if (actor.superAdmin) {
        const approved = await approveImportRequest(tx, site.id, request, actor.userId)
        return {
          host: item.host,
          status: watching ? 'ALREADY_WATCHED' : 'ADDED',
          message: watching ? `Already watching this page as "${watching.name}"; site settings updated` : 'Approved and checking',
          siteId: site.id,
          funderLinks: approved.funders ? 'CONFIRMED' : 'NONE',
          websiteSaved: approved.websiteSaved,
          notes,
        }
      }

      // Delegated operator: record the choices, change nothing else.
      for (const funder of funders) {
        await tx.monitorSiteFunder.upsert({
          where: { site_id_funder_id: { site_id: site.id, funder_id: funder.id } },
          create: { site_id: site.id, funder_id: funder.id, status: 'SUGGESTED', evidence: { source: 'catalog-import', watchUrl: url, requestedBy: actor.userId } },
          update: {},
        })
      }
      await tx.monitorSite.update({ where: { id: site.id }, data: { pending_scope: request as unknown as Prisma.InputJsonObject } })
      const active = site.status === 'ACTIVE'
      return {
        host: item.host,
        status: 'PENDING_APPROVAL',
        message: active
          ? `${watching ? 'Page already watched' : 'Page added to an approved site'}; scope, priority, budget and funder changes wait for a super admin`
          : 'Saved for super-admin approval; nothing is fetched until then',
        siteId: site.id,
        funderLinks: funders.length ? 'SUGGESTED' : 'NONE',
        websiteSaved: 0,
        notes,
      }
    }))
  }
  return results
}
