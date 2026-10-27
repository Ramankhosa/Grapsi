import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { callAreaRowsSql } from '@/lib/researchAreas/queries'
import { Prisma } from '@/lib/prisma-generated'

import { enqueueTask } from './queue'
import { staggeredStart } from './schedule'
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

/**
 * Every filter narrows the CALLS that count; a website matches when at least
 * one of its calls passes them all. Counts shown for a website are its matching
 * calls, beside the total it publishes.
 */
export interface CatalogSearch {
  q: string
  /** Call title (or scheme title) contains these words. */
  title: string
  country: string | null
  funderType: string | null
  /** LIVE: has an open, rolling or forthcoming matching call. CLOSED: none live. */
  status: 'LIVE' | 'ANY' | 'CLOSED'
  /** Which date of a call the range applies to. */
  dateField: 'DEADLINE' | 'OPENS' | 'PUBLISHED' | 'ADDED'
  dateFrom: string | null
  dateTo: string | null
  /** Grant categories (funding_calls.funding_kinds), any of. */
  kinds: string[]
  /** Research areas (level-1 names of the call's taxonomy), any of. */
  areas: string[]
  /** Career stages the call is open to, any of. */
  careerStages: string[]
  /** Largest award at least this much, in estimated USD. */
  minAwardUsd: number | null
  unwatchedOnly: boolean
  /** Websites with a single call are usually one-off links, hidden by default. */
  includeOneOff: boolean
  sort: 'LIVE' | 'DEADLINE' | 'RECENT' | 'CALLS' | 'NAME'
  offset: number
  limit: number
}

export const EMPTY_SEARCH: CatalogSearch = {
  q: '', title: '', country: null, funderType: null, status: 'LIVE', dateField: 'DEADLINE', dateFrom: null, dateTo: null,
  kinds: [], areas: [], careerStages: [], minAwardUsd: null, unwatchedOnly: true, includeOneOff: false, sort: 'LIVE', offset: 0, limit: 25,
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const list = (value: string | null) => (value ?? '').split('|').map((v) => v.trim()).filter(Boolean).slice(0, 30).map((v) => v.slice(0, 120))

/** Read a search from query parameters (the GET request and the bulk import share it). */
export function parseCatalogSearch(p: URLSearchParams): CatalogSearch {
  const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(value ?? '') ? value as T : fallback
  const country = (p.get('country') ?? '').toUpperCase()
  const date = (key: string) => { const v = p.get(key); return v && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null }
  const minAward = Number(p.get('minAward'))
  return {
    q: (p.get('q') ?? '').slice(0, 150),
    title: (p.get('title') ?? '').slice(0, 150),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    funderType: p.get('type') || null,
    status: pick(p.get('status'), ['LIVE', 'ANY', 'CLOSED'] as const, 'LIVE'),
    dateField: pick(p.get('dateField'), ['DEADLINE', 'OPENS', 'PUBLISHED', 'ADDED'] as const, 'DEADLINE'),
    dateFrom: date('from'),
    dateTo: date('to'),
    kinds: list(p.get('kinds')),
    areas: list(p.get('areas')),
    careerStages: list(p.get('stages')),
    minAwardUsd: Number.isFinite(minAward) && minAward > 0 ? Math.min(minAward, 1e10) : null,
    unwatchedOnly: p.get('unwatched') !== '0',
    includeOneOff: p.get('oneOff') === '1',
    sort: pick(p.get('sort'), ['LIVE', 'DEADLINE', 'RECENT', 'CALLS', 'NAME'] as const, 'LIVE'),
    offset: Math.max(0, Math.min(5000, Number(p.get('offset')) || 0)),
    limit: 25,
  }
}

export interface CatalogFunder { id: string; name: string; country: string | null; type: string | null; calls: number }

export interface WatchPageSuggestion { url: string; covers: number; reason: string }

export type WebsiteWarning = 'FILE_HOST' | 'SHARED_PORTAL' | 'FUNDER_MISMATCH' | 'NEEDS_BROWSER' | 'FEW_CALLS'

export interface CatalogWebsite {
  host: string
  calls: number
  liveCalls: number
  /** Calls on this website that pass the search filters. */
  matchedCalls: number
  /** Soonest deadline still ahead among the matching calls (YYYY-MM-DD). */
  nextDeadline: string | null
  /** When the newest matching call entered the database. */
  latestAdded: string | null
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
  matched_calls: number
  next_deadline: string | null
  latest_added: Date | null
  documents: number
  sample_urls: string[]
  funders: CatalogFunder[] | null
  site_id: string | null
  site_status: string | null
  watch_points: number | null
  total: number
}

const HOST_SQL = Prisma.sql`lower(substring(coalesce(c.source_url, c."sourceUrl") from '^https?://([^/:?#]+)'))`

/** The call date a range applies to. Deadlines prefer the derived next deadline. */
const DATE_SQL: Record<CatalogSearch['dateField'], Prisma.Sql> = {
  DEADLINE: Prisma.sql`coalesce(c.next_deadline_at, c.final_deadline_at, c.close_date::date, c."deadlineAt"::date)`,
  OPENS: Prisma.sql`c.open_date::date`,
  PUBLISHED: Prisma.sql`c."publishedAt"::date`,
  ADDED: Prisma.sql`c."createdAt"::date`,
}
const DEADLINE_SQL = DATE_SQL.DEADLINE
const TODAY_UTC = Prisma.sql`(now() at time zone 'utc')::date`

function escapeLike(value: string) {
  return `%${value.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

/** The WHERE conditions a call must meet to count for the search. */
function callConditions(search: CatalogSearch): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`coalesce(c.source_url, c."sourceUrl") IS NOT NULL`]
  const q = search.q.trim()
  if (q) {
    const like = escapeLike(q)
    parts.push(Prisma.sql`(${HOST_SQL} ILIKE ${like} OR f.name ILIKE ${like} OR f.acronym ILIKE ${like} OR c.title ILIKE ${like} OR c.agency_name ILIKE ${like} OR c."agencyName" ILIKE ${like} OR c.programme_framework ILIKE ${like})`)
  }
  // Title words in any order: "early career fellowship" finds "Fellowship for early-career…".
  for (const word of search.title.trim().split(/\s+/).filter((w) => w.length >= 2).slice(0, 8)) {
    const like = escapeLike(word)
    parts.push(Prisma.sql`(c.title ILIKE ${like} OR c.scheme_title ILIKE ${like})`)
  }
  if (search.country) parts.push(Prisma.sql`(f.country_code = ${search.country} OR c.funder_country_code = ${search.country})`)
  if (search.funderType) parts.push(Prisma.sql`f.funder_type = ${search.funderType}`)
  if (search.kinds.length) parts.push(Prisma.sql`c.funding_kinds && ${search.kinds}::text[]`)
  if (search.careerStages.length) parts.push(Prisma.sql`c.career_stages && ${search.careerStages}::text[]`)
  if (search.areas.length) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM ${callAreaRowsSql()} t WHERE t.funding_call_id = c.id AND t.taxonomy_level1_name = ANY(${search.areas}::text[]))`)
  }
  if (search.minAwardUsd !== null) parts.push(Prisma.sql`c.amount_max_usd_est >= ${search.minAwardUsd}`)
  const dateCol = DATE_SQL[search.dateField]
  if (search.dateFrom) parts.push(Prisma.sql`${dateCol} >= ${search.dateFrom}::date`)
  if (search.dateTo) parts.push(Prisma.sql`${dateCol} <= ${search.dateTo}::date`)
  return Prisma.join(parts, ' AND ')
}

const ORDER_SQL: Record<CatalogSearch['sort'], Prisma.Sql> = {
  LIVE: Prisma.sql`m.matched_live DESC, h.calls DESC, h.host`,
  DEADLINE: Prisma.sql`m.next_deadline ASC NULLS LAST, m.matched_live DESC, h.host`,
  RECENT: Prisma.sql`m.latest_added DESC NULLS LAST, h.host`,
  CALLS: Prisma.sql`m.matched_calls DESC, h.calls DESC, h.host`,
  NAME: Prisma.sql`regexp_replace(h.host, '^www\\.', ''), h.host`,
}

export async function searchCatalogWebsites(search: CatalogSearch): Promise<{ websites: CatalogWebsite[]; total: number }> {
  const live = Prisma.join(LIVE_STATUSES)
  const statusHaving = search.status === 'LIVE'
    ? Prisma.sql`HAVING count(*) FILTER (WHERE opportunity_status IN (${live})) > 0`
    : search.status === 'CLOSED' ? Prisma.sql`HAVING count(*) FILTER (WHERE opportunity_status IN (${live})) = 0` : Prisma.empty
  const unwatched = search.unwatchedOnly ? Prisma.sql`WHERE s.id IS NULL OR s.status <> 'ACTIVE'` : Prisma.empty

  const rows = await prisma.$queryRaw<HostRow[]>(Prisma.sql`
    WITH matched_calls AS (
      SELECT ${HOST_SQL} AS host, c.opportunity_status, ${DEADLINE_SQL} AS deadline, c."createdAt" AS added
      FROM funding_calls c LEFT JOIN funders f ON f.id = c.funder_id
      WHERE ${callConditions(search)}
    ),
    m AS (
      SELECT host,
        count(*)::int AS matched_calls,
        count(*) FILTER (WHERE opportunity_status IN (${live}))::int AS matched_live,
        min(deadline) FILTER (WHERE deadline >= ${TODAY_UTC}) AS next_deadline,
        max(added) AS latest_added
      FROM matched_calls WHERE host IS NOT NULL GROUP BY host
      ${statusHaving}
    ),
    calls AS (
      SELECT ${HOST_SQL} AS host, c.opportunity_status, coalesce(c.source_url, c."sourceUrl") AS url, c.funder_id
      FROM funding_calls c
      WHERE coalesce(c.source_url, c."sourceUrl") IS NOT NULL AND ${HOST_SQL} IN (SELECT host FROM m)
    ),
    per_host AS (
      SELECT host,
        count(*)::int AS calls,
        count(*) FILTER (WHERE opportunity_status IN (${live}))::int AS live_calls,
        count(*) FILTER (WHERE url ~* '\\.(pdf|docx?|xlsx?|pptx?|zip|rtf|odt)([?#]|$)')::int AS documents,
        (array_agg(url ORDER BY (opportunity_status IN (${live})) DESC, url))[1:300] AS sample_urls
      FROM calls c GROUP BY host
      ${search.includeOneOff ? Prisma.empty : Prisma.sql`HAVING count(*) >= 2`}
    ),
    per_funder AS (
      SELECT c.host, json_agg(json_build_object('id', f.id, 'name', f.name, 'country', f.country_code, 'type', f.funder_type, 'calls', c.n) ORDER BY c.n DESC) AS funders
      FROM (SELECT host, funder_id, count(*)::int AS n FROM calls WHERE funder_id IS NOT NULL GROUP BY host, funder_id) c
      JOIN funders f ON f.id = c.funder_id
      GROUP BY c.host
    )
    SELECT h.*, m.matched_calls, to_char(m.next_deadline, 'YYYY-MM-DD') AS next_deadline, m.latest_added,
      pf.funders, s.id AS site_id, s.status AS site_status,
      (SELECT count(*)::int FROM monitored_sources ms WHERE ms.site_id = s.id) AS watch_points,
      count(*) OVER ()::int AS total
    FROM per_host h
    JOIN m ON m.host = h.host
    LEFT JOIN per_funder pf ON pf.host = h.host
    LEFT JOIN monitor_sites s ON regexp_replace(s.host, '^www\\.', '') = regexp_replace(h.host, '^www\\.', '')
    ${unwatched}
    ORDER BY ${ORDER_SQL[search.sort]}
    LIMIT ${search.limit} OFFSET ${search.offset}
  `)

  const websites = rows.map((row): CatalogWebsite => {
    const funders = row.funders ?? []
    const pageUrls = row.sample_urls.filter((u) => !DOCUMENT_RE.test(u))
    const base = { host: row.host, calls: row.calls, documents: row.documents, funders, sampleUrls: row.sample_urls }
    return {
      ...base,
      liveCalls: row.live_calls,
      matchedCalls: row.matched_calls,
      nextDeadline: row.next_deadline,
      latestAdded: row.latest_added ? row.latest_added.toISOString() : null,
      sampleUrls: row.sample_urls.slice(0, 5),
      watched: row.site_id ? { siteId: row.site_id, status: row.site_status ?? 'UNKNOWN', watchPoints: row.watch_points ?? 0 } : null,
      suggestions: suggestWatchPages(row.host, pageUrls.length ? pageUrls : row.sample_urls, pageUrls.length ? row.calls - row.documents : row.calls),
      warnings: websiteWarnings(base),
      suggested: suggestedSettings({ calls: row.calls, liveCalls: row.live_calls, sampleUrls: row.sample_urls, host: row.host }),
    }
  })
  return { websites, total: rows[0]?.total ?? 0 }
}

export interface CatalogFacet { value: string; calls: number }
export interface CatalogFacets { kinds: CatalogFacet[]; areas: CatalogFacet[]; careerStages: CatalogFacet[]; countries: CatalogFacet[]; funderTypes: CatalogFacet[] }

let facetCache: { at: number; value: CatalogFacets } | null = null

/** The categories that exist in the database, with call counts, for the filter menus. Cached ten minutes. */
export async function catalogFacets(): Promise<CatalogFacets> {
  if (facetCache && Date.now() - facetCache.at < 10 * 60_000) return facetCache.value
  const withUrl = Prisma.sql`coalesce(c.source_url, c."sourceUrl") IS NOT NULL`
  const [kinds, areas, careerStages, countries, funderTypes] = await Promise.all([
    prisma.$queryRaw<CatalogFacet[]>`SELECT k AS value, count(*)::int AS calls FROM funding_calls c, unnest(c.funding_kinds) k WHERE ${withUrl} GROUP BY k HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 40`,
    prisma.$queryRaw<CatalogFacet[]>`SELECT t.taxonomy_level1_name AS value, count(DISTINCT c.id)::int AS calls FROM funding_calls c JOIN ${callAreaRowsSql()} t ON t.funding_call_id = c.id WHERE ${withUrl} AND t.taxonomy_level1_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 40`,
    prisma.$queryRaw<CatalogFacet[]>`SELECT k AS value, count(*)::int AS calls FROM funding_calls c, unnest(c.career_stages) k WHERE ${withUrl} GROUP BY k ORDER BY 2 DESC LIMIT 20`,
    prisma.$queryRaw<CatalogFacet[]>`SELECT coalesce(f.country_code, c.funder_country_code) AS value, count(*)::int AS calls FROM funding_calls c LEFT JOIN funders f ON f.id = c.funder_id WHERE ${withUrl} AND coalesce(f.country_code, c.funder_country_code) ~ '^[A-Z]{2}$' GROUP BY 1 ORDER BY 2 DESC LIMIT 80`,
    prisma.$queryRaw<CatalogFacet[]>`SELECT f.funder_type AS value, count(*)::int AS calls FROM funding_calls c JOIN funders f ON f.id = c.funder_id WHERE ${withUrl} AND f.funder_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
  ])
  const value = { kinds, areas, careerStages, countries, funderTypes }
  facetCache = { at: Date.now(), value }
  return value
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
  status: 'ADDED' | 'ALREADY_WATCHED' | 'PENDING_APPROVAL' | 'BLOCKED' | 'INVALID' | 'SKIPPED'
  message: string
  siteId: string | null
  funderLinks: 'CONFIRMED' | 'SUGGESTED' | 'NONE'
  websiteSaved: number
  notes: string[]
  /** Set when a bulk import spread first checks out: when this site's starts. */
  firstCheckAt?: string | null
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

/**
 * Funders in the order they were asked for. The catalogue lists a website's
 * funders by how many calls each publishes there, so the first one names the
 * site (NIH for grants.nih.gov, not whichever row the database returned first).
 */
function inRequestOrder<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  return [...rows].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

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
export async function approveImportRequest(tx: Tx, siteId: string, request: ImportRequest, approverId: string, firstCheckAt: Date | null = null) {
  const site = await tx.monitorSite.findUniqueOrThrow({ where: { id: siteId } })
  if (site.status === 'BLOCKED') throw new Error('This website is blocked. Unblock it before approving an import.')
  const funders = inRequestOrder(request.funderIds, request.funderIds.length ? await tx.funder.findMany({ where: { id: { in: request.funderIds } }, select: { id: true, name: true } }) : [])
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
    await enqueueTask(tx, { kind: 'DISCOVER_SITE', operationKey: `discover-import:${siteId}:${randomUUID()}`, siteId, payload: { siteId }, priority: 30, availableAt: firstCheckAt ?? undefined })
  }
  if (firstCheckAt) {
    // A bulk approval spreads first checks out; nothing on this site starts earlier.
    await tx.monitoredSource.updateMany({ where: { site_id: siteId, OR: [{ next_check_at: null }, { next_check_at: { lt: firstCheckAt } }] }, data: { next_check_at: firstCheckAt } })
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
export async function importWebsites(requested: ImportWebsite[], actor: { userId: string; superAdmin: boolean }, now = new Date()): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  // grants.gov and www.grants.gov are one website: watch it once, with the
  // funders of both, instead of crawling the same listing twice.
  const byBareHost = new Map<string, ImportWebsite>()
  for (const item of requested) {
    const bare = item.host.toLowerCase().replace(/^www\./, '')
    const first = byBareHost.get(bare)
    if (!first) { byBareHost.set(bare, { ...item }); continue }
    first.funderIds = [...new Set([...first.funderIds, ...item.funderIds])].slice(0, 40)
    first.documentHosts = [...new Set([...first.documentHosts, ...item.documentHosts])].slice(0, 20)
    results.push({ host: item.host, status: 'ALREADY_WATCHED', message: `Same website as ${first.host}; watched once, with its funders merged`, siteId: null, funderLinks: 'NONE', websiteSaved: 0, notes: [] })
  }
  const items = [...byBareHost.values()]
  const laptopNote = process.env.MONITOR_LOCAL_SCREENING_REQUIRED === 'true'
    ? 'Laptop-first screening is on: add this host to the laptop worker’s allowed hosts, or its pages will wait for analysis.'
    : null
  for (const [index, item] of items.entries()) {
    // Many sites at once: spread their first checks so the queue, the network
    // and the AI budget see a steady trickle, not one burst.
    const firstCheckAt = staggeredStart(now, index, items.length)
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
      const funders = inRequestOrder(item.funderIds, item.funderIds.length ? await tx.funder.findMany({ where: { id: { in: item.funderIds } }, select: { id: true, name: true } }) : [])
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
            next_check_at: firstCheckAt ?? now,
          },
        })
      }
      const notes = laptopNote ? [laptopNote] : []

      if (actor.superAdmin) {
        const approved = await approveImportRequest(tx, site.id, request, actor.userId, firstCheckAt)
        return {
          host: item.host,
          status: watching ? 'ALREADY_WATCHED' : 'ADDED',
          message: watching ? `Already watching this page as "${watching.name}"; site settings updated` : firstCheckAt ? 'Approved; first check scheduled' : 'Approved and checking',
          firstCheckAt: firstCheckAt?.toISOString() ?? null,
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

export interface BulkDefaults {
  /** null keeps each website's suggested cadence and priority. */
  frequencyMinutes: number | null
  priority: 'HIGH' | 'NORMAL' | 'LOW' | null
  excludeKeywords: string
}

/** Most websites one bulk import may add; the rest wait for the next run. */
export const BULK_IMPORT_CAP = 500

/**
 * The setup a website gets when it is added without being reviewed one by
 * one. Funders in the catalogue are already vetted, so every funder whose calls
 * are published on the website is linked. Saving a funder's official website
 * stays a deliberate, per-site choice. A file store is skipped: the crawler
 * watches pages that list calls, and a file host has none.
 */
export function bulkWebsite(site: CatalogWebsite, defaults: BulkDefaults): ImportWebsite | { skip: string; status: ImportResult['status'] } {
  if (site.watched?.status === 'ACTIVE') return { status: 'ALREADY_WATCHED', skip: 'Already watched' }
  if (site.watched?.status === 'BLOCKED') return { status: 'BLOCKED', skip: 'This website is blocked. A super admin has to unblock it first.' }
  if (site.warnings.some((w) => w.code === 'FILE_HOST')) {
    return { status: 'SKIPPED', skip: 'Mostly files, not pages: add it as a document host on the website that links to these files' }
  }
  return {
    host: site.host,
    watchUrl: site.suggestions[0]?.url ?? `https://${site.host}/`,
    pageKind: 'PAGE',
    funderIds: site.funders.slice(0, 40).map((f) => f.id),
    officialWebsite: false,
    frequencyMinutes: defaults.frequencyMinutes ?? site.suggested.frequencyMinutes,
    priority: defaults.priority ?? site.suggested.priority,
    relatedHosts: [],
    documentHosts: site.suggested.documentHosts,
    keywords: '',
    excludeKeywords: defaults.excludeKeywords,
    fetchMode: site.warnings.some((w) => w.code === 'NEEDS_BROWSER') ? 'BROWSER' : 'AUTO',
    dailyBudgetUsd: null,
    note: 'Added in bulk from the funding database',
  }
}

/**
 * Add every website matching a search (up to BULK_IMPORT_CAP), with suggested
 * settings. The matching set is read in full first, so adding sites (which
 * removes them from an "unwatched" search) cannot shift later pages.
 */
export async function importAllMatching(
  search: CatalogSearch,
  defaults: BulkDefaults,
  excludeHosts: string[],
  actor: { userId: string; superAdmin: boolean },
): Promise<{ results: ImportResult[]; matched: number; capped: boolean }> {
  const skip = new Set(excludeHosts.map((h) => h.toLowerCase()))
  const sites: CatalogWebsite[] = []
  let matched = 0
  for (let offset = 0; sites.length < BULK_IMPORT_CAP; offset += 100) {
    const page = await searchCatalogWebsites({ ...search, offset, limit: 100 })
    matched = page.total
    sites.push(...page.websites.filter((w) => !skip.has(w.host.toLowerCase())))
    if (page.websites.length < 100) break
  }
  const chosen = sites.slice(0, BULK_IMPORT_CAP)
  const results: ImportResult[] = []
  const items: ImportWebsite[] = []
  for (const site of chosen) {
    const setup = bulkWebsite(site, defaults)
    if ('skip' in setup) results.push({ host: site.host, status: setup.status, message: setup.skip, siteId: site.watched?.siteId ?? null, funderLinks: 'NONE', websiteSaved: 0, notes: [] })
    else items.push(setup)
  }
  results.push(...await importWebsites(items, actor))
  return { results, matched, capped: matched - skip.size > BULK_IMPORT_CAP }
}

/**
 * A super admin approves operators' import requests, one or many. Scope,
 * budget, priority and funder links are applied only here. Each site commits
 * on its own, and first checks of a large batch are spread out.
 */
export async function approveImportRequests(ids: string[], approverId: string, now = new Date()): Promise<{ approved: number; failed: Array<{ siteId: string; host: string | null; message: string }>; lastFirstCheckAt: string | null }> {
  const failed: Array<{ siteId: string; host: string | null; message: string }> = []
  let approved = 0
  let last: Date | null = null
  for (const [index, siteId] of ids.entries()) {
    const firstCheckAt = staggeredStart(now, index, ids.length)
    try {
      await prisma.$transaction(async (tx) => {
        const site = await tx.monitorSite.findUniqueOrThrow({ where: { id: siteId } })
        const request = site.pending_scope as unknown as ImportRequest | null
        if (!request) throw new Error('This site has no import request waiting')
        await approveImportRequest(tx, siteId, request, approverId, firstCheckAt)
      })
      approved += 1
      if (firstCheckAt) last = firstCheckAt
    } catch (error) {
      const site = await prisma.monitorSite.findUnique({ where: { id: siteId }, select: { host: true } }).catch(() => null)
      failed.push({ siteId, host: site?.host ?? null, message: error instanceof Error ? error.message : 'Approval failed' })
    }
  }
  return { approved, failed, lastFirstCheckAt: last?.toISOString() ?? null }
}
