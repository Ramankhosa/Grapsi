import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import type { MonitoredIgnoreRule, MonitoredSource, MonitorSite } from '@/lib/prisma-generated'

import type { Renderer } from './browser'
import { MonitorFetchError, isMonitorFetchError } from './errors'
import { extractFeedItems, parseSitemap, titleFromUrl } from './feeds'
import { fingerprint, listingMeaningfulHash, meaningfulText, sha256 } from './hashing'
import { extractListing, extractScopeText, type ListingItem } from './items'
import { completeTaskInTx, withFence, type Lease } from './queue'
import { decodeBody, gunzipCapped, type SafeFetch } from './safeFetch'
import { botChallenge, botChallengeError, frameLinks } from './pageText'
import { SITE_AUTO_PAUSE_FAILURES, siteScope, tlsExceptionHosts } from './sites'
import { identifyUrl, type UrlIdentityOptions } from './urlIdentity'
import { queueCandidates } from './candidates'
import { loadSkipRules, skipRuleFor, type SkipRuleLike } from './skipRules'
import { assertContentCapacity, assertResourceCapacity } from './capacity'

/**
 * One scheduled check of one watch point (v2).
 *
 * The page is fetched (conditionally), its items extracted, and everything —
 * the listing's own version, each item's resource and this watch point's
 * observation of it — is written in fenced transactions, one per page, so a
 * crash can lose at most the page in flight and never commit a half-recorded
 * one. (The legacy checker committed its snapshot before recording the
 * change; a failure in between lost the find.)
 *
 * Absence is only ever established by a COMPLETE pass: a page budget, a
 * truncated body, a selector that stopped matching or an error leaves every
 * observation as it was. Pagination and sitemap indexes carry a cursor
 * between checks, so a budget defers the rest of a listing instead of
 * dropping it.
 */

export const CHECK_LIMITS = {
  pagesPerCheck: Number(process.env.MONITOR_MAX_PAGES_PER_CHECK) || 5,
  headPages: 2,
  /** Sitemap documents fetched per check — every fetch counts, indexes included. */
  sitemapChildrenPerCheck: 3,
  sitemapEntriesPerCheck: 5000,
  /** Pending sitemap documents and visited ones remembered across a pass. */
  sitemapQueueMax: 1000,
  sitemapVisitedMax: 2000,
  listingTextChars: 200_000,
  listingMaxBytes: 2_500_000,
  sitemapMaxBytes: 10_000_000,
}

/**
 * Meaningful items: links with words on them, not bare icons. Letters, marks
 * and digits in any script count — a Hindi-only listing is a real listing.
 */
function meaningfulItems(items: ListingItem[]): number {
  return items.filter((item) => item.anchorText.replace(/[^\p{L}\p{M}\p{N}]/gu, '').length >= 3).length
}

export interface PageCursor {
  /** Where the deeper part of a paginated listing resumes. */
  nextUrl?: string | null
  /**
   * Page one's own "next" link as of its last full read. A listing that has
   * one is paginated: a 304 on page one says nothing about the pages behind
   * it, so page one is always re-read in full.
   */
  headNextUrl?: string | null
  /** Sitemap documents still to read this pass (depth-first; siblings kept). */
  sitemapQueue?: string[]
  /** Sitemap documents already read this pass (cycle guard). */
  sitemapVisited?: string[]
  entryOffset?: number
  /** Sitemap entries read so far this pass: a pass that read none is not complete. */
  passEntries?: number
  /** When the current full pass began: observations older than this are absent once it completes. */
  passStartedAt?: string
}

export interface CheckOutcome {
  status: 'COMPLETE' | 'PARTIAL' | 'NOT_MODIFIED' | 'CANCELED' | 'SKIPPED'
  complete: boolean
  pagesVisited: number
  itemsObserved: number
  newResources: number
  fetchModeUsed: 'FETCH' | 'BROWSER' | 'MIXED' | null
  errorClass?: string
  message?: string
}

export interface CheckDeps {
  fetch: SafeFetch
  renderer: Renderer | null
  signal?: AbortSignal
  now?: () => Date
}

type SourceWithSite = MonitoredSource & { site: MonitorSite | null; ignoreRules: MonitoredIgnoreRule[] }

interface FetchedPage {
  url: string
  finalUrl: string
  notModified: boolean
  rawHash: string
  truncated: boolean
  httpStatus: number
  etag: string | null
  lastModified: string | null
  items: ListingItem[]
  scopeText: string
  nextPageUrl: string | null
  scopeMatched: boolean
  mode: 'FETCH' | 'BROWSER'
  tlsExceptionUsed: boolean
  mimeType: string
  /** Browser renders only: off-scope hosts the page tried to reach. */
  blockedHosts?: string[]
}

function lineIgnorePatterns(source: SourceWithSite, now: Date): string[] {
  return source.ignoreRules
    .filter((rule) => rule.is_active && rule.scope === 'LINE' && (!rule.expires_at || rule.expires_at > now))
    .map((rule) => rule.pattern)
}

function urlPrefixRules(source: SourceWithSite, now: Date): string[] {
  return source.ignoreRules
    .filter((rule) => rule.is_active && rule.scope === 'URL_PREFIX' && (!rule.expires_at || rule.expires_at > now))
    .map((rule) => rule.pattern)
}

function identityOptions(site: MonitorSite): UrlIdentityOptions {
  return { fragmentRules: site.fragment_rules, sessionParams: site.session_params }
}

async function fetchListingPage(
  source: SourceWithSite,
  site: MonitorSite,
  url: string,
  deps: CheckDeps,
  options: { conditional: boolean; preferBrowser: boolean; probePlainFetch: boolean }
): Promise<FetchedPage> {
  const scope = siteScope(site)
  const idOptions = identityOptions(site)

  const fromHtml = (html: string, finalUrl: string) => {
    const extraction = extractListing(html, finalUrl, { ...idOptions, selector: source.selector, inScope: scope })
    return { extraction, scopeText: extractScopeText(html, source.selector) }
  }

  const tryRender = async (): Promise<FetchedPage | null> => {
    if (!deps.renderer) return null
    const rendered = await deps.renderer.render(url, {
      inScope: scope,
      readinessSelector: source.readiness_selector ?? source.selector,
      minDelayMs: site.min_delay_ms,
      signal: deps.signal,
    })
    const { extraction, scopeText } = fromHtml(rendered.html, rendered.finalUrl)
    return {
      url,
      finalUrl: rendered.finalUrl,
      notModified: false,
      rawHash: sha256(rendered.html),
      truncated: rendered.truncated || !rendered.ready,
      httpStatus: 200,
      etag: null,
      lastModified: null,
      items: extraction.items,
      scopeText,
      nextPageUrl: extraction.nextPageUrl,
      scopeMatched: extraction.scopeMatched,
      mode: 'BROWSER',
      tlsExceptionUsed: false,
      mimeType: 'text/html',
      blockedHosts: rendered.blockedHosts,
    }
  }

  // A browser-mode watch point renders directly (an SPA shell's bytes say
  // nothing), except on the periodic probe that may demote it.
  if (options.preferBrowser && !options.probePlainFetch && deps.renderer) {
    const rendered = await tryRender()
    if (rendered) return rendered
  }

  const headers: Record<string, string> = {}
  if (options.conditional && source.etag) headers['if-none-match'] = source.etag
  if (options.conditional && source.last_modified) headers['if-modified-since'] = source.last_modified

  const result = await deps.fetch(url, {
    headers,
    inScope: scope,
    minDelayMs: site.min_delay_ms,
    tlsInsecureHosts: tlsExceptionHosts(site),
    maxBytes: CHECK_LIMITS.listingMaxBytes,
    signal: deps.signal,
  })

  if (result.notModified) {
    return {
      url,
      finalUrl: result.finalUrl,
      notModified: true,
      rawHash: '',
      truncated: false,
      httpStatus: 304,
      etag: result.headers.etag ?? source.etag,
      lastModified: result.headers['last-modified'] ?? source.last_modified,
      items: [],
      scopeText: '',
      nextPageUrl: null,
      scopeMatched: true,
      mode: 'FETCH',
      tlsExceptionUsed: result.tlsExceptionUsed,
      mimeType: '',
    }
  }
  if (result.contentKind !== 'html') {
    throw new MonitorFetchError('UNEXPECTED_CONTENT_TYPE', `${url} returned ${result.contentType || 'unknown content'}, not an HTML listing`, {
      url,
    })
  }

  const html = decodeBody(result)
  const vendor = botChallenge(result.status, result.headers, html)
  if (vendor) throw botChallengeError(result.finalUrl, vendor, result.status)
  let { extraction, scopeText } = fromHtml(html, result.finalUrl)
  // An old-style site keeps its listing in a frame or iframe: read the
  // same-site frame documents (at most two) when the page itself lists nothing.
  let rawHash = sha256(result.body)
  if (meaningfulItems(extraction.items) === 0 && !source.selector) {
    const skipRules = await loadSkipRules(prisma, site.id)
    for (const frameUrl of frameLinks(html, result.finalUrl, scope).slice(0, 2)) {
      if (skipRuleFor(skipRules, frameUrl)) continue
      try {
        const frame = await deps.fetch(frameUrl, { inScope: scope, minDelayMs: site.min_delay_ms, tlsInsecureHosts: tlsExceptionHosts(site), maxBytes: CHECK_LIMITS.listingMaxBytes, signal: deps.signal })
        if (frame.contentKind !== 'html') continue
        const framed = fromHtml(decodeBody(frame), frame.finalUrl)
        if (meaningfulItems(framed.extraction.items) > meaningfulItems(extraction.items)) {
          extraction = framed.extraction
          scopeText = framed.scopeText
          rawHash = sha256(Buffer.concat([result.body, frame.body]))
        }
      } catch {
        // a frame that cannot be read leaves the page as it was
      }
    }
  }
  const plain: FetchedPage = {
    url,
    finalUrl: result.finalUrl,
    notModified: false,
    rawHash,
    truncated: result.truncated,
    httpStatus: result.status,
    etag: result.headers.etag ?? null,
    lastModified: result.headers['last-modified'] ?? null,
    items: extraction.items,
    scopeText,
    nextPageUrl: extraction.nextPageUrl,
    scopeMatched: extraction.scopeMatched,
    mode: 'FETCH',
    tlsExceptionUsed: result.tlsExceptionUsed,
    mimeType: result.contentType,
  }

  // AUTO: a page that shows no meaningful items in its HTML may be built by
  // script. Render it; if the render shows items the plain fetch did not,
  // this watch point is a browser one from now on.
  const wantsRender =
    (source.fetch_mode === 'AUTO' && meaningfulItems(plain.items) === 0) ||
    (source.fetch_mode === 'BROWSER' && options.probePlainFetch && meaningfulItems(plain.items) === 0)
  if (wantsRender) {
    const rendered = await tryRender()
    if (rendered && meaningfulItems(rendered.items) > meaningfulItems(plain.items)) return rendered
  }
  return plain
}

interface PersistContext {
  source: SourceWithSite
  site: MonitorSite
  generation: number
  now: Date
  lineRules: string[]
  urlRules: string[]
  /** Site-wide "don't visit" marks; matching items are never recorded. */
  skipRules: SkipRuleLike[]
}

function itemContextHash(item: ListingItem, lineRules: string[]): string {
  return sha256(meaningfulText(`${item.anchorText}\n${item.heading ?? ''}\n${item.contextText}`, lineRules))
}

/**
 * Write one page: the listing's resource + version, each item's resource
 * (alias-aware), and this watch point's observation of each item.
 */
async function persistPage(
  tx: Prisma.TransactionClient,
  ctx: PersistContext,
  page: FetchedPage
): Promise<{ itemsObserved: number; newResources: number; itemsChanged: number }> {
  const { source, site, now } = ctx
  const listingIdentity = identifyUrl(page.finalUrl, undefined, identityOptions(site)) ?? identifyUrl(page.url)
  if (!listingIdentity) return { itemsObserved: 0, newResources: 0, itemsChanged: 0 }

  const items = page.items.filter(
    (item) => !ctx.urlRules.some((prefix) => item.url.startsWith(prefix)) && !skipRuleFor(ctx.skipRules, item.url, now)
  )
  await assertResourceCapacity(tx, site.id, [listingIdentity.dedupKey, ...items.map(item => item.dedupKey)])

  // The listing page itself.
  const listing = await tx.monitorResource.upsert({
    where: { site_id_dedup_key: { site_id: site.id, dedup_key: listingIdentity.dedupKey } },
    create: {
      site_id: site.id,
      kind: 'PAGE',
      role: 'LISTING',
      raw_url: page.url,
      final_url: page.finalUrl,
      canonical_url: listingIdentity.canonical,
      dedup_key: listingIdentity.dedupKey,
      mime_type: page.mimeType || null,
      last_validated_at: now,
      last_validation_status: page.truncated ? 'TRUNCATED' : 'CHANGED',
    },
    update: { final_url: page.finalUrl, last_observed_at: now, role: 'LISTING' },
  })
  const meaningful = listingMeaningfulHash(items.map((item) => `${item.dedupKey}|${itemContextHash(item, ctx.lineRules)}`))
  const existingVersion = await tx.monitorResourceVersion.findUnique({
    where: { resource_id_raw_hash: { resource_id: listing.id, raw_hash: page.rawHash } },
  })
  const previousVersion = listing.current_version_id
    ? await tx.monitorResourceVersion.findUnique({ where: { id: listing.current_version_id }, select: { id: true, meaningful_hash: true, truncated: true } })
    : null
  // Same links and context in different bytes: keep the current version
  // rather than store another copy of an unchanged listing.
  const sameMeaning = !page.truncated && previousVersion && !previousVersion.truncated && previousVersion.meaningful_hash === meaningful
  const version =
    existingVersion ??
    (sameMeaning ? previousVersion : null) ??
    (await (async () => {
      const bytes = Buffer.byteLength(page.scopeText.slice(0, CHECK_LIMITS.listingTextChars))
      await assertContentCapacity(tx, site.id, bytes, site.storage_quota_bytes)
      return tx.monitorResourceVersion.create({
      data: {
        resource_id: listing.id,
        raw_hash: page.rawHash,
        meaningful_hash: meaningful,
        http_status: page.httpStatus,
        final_url: page.finalUrl,
        mime_type: page.mimeType || null,
        byte_length: bytes,
        truncated: page.truncated,
        text: page.scopeText.slice(0, CHECK_LIMITS.listingTextChars),
        tls_exception_used: page.tlsExceptionUsed,
      },
    }) })())
  await tx.monitorResource.update({
    where: { id: listing.id },
    data: {
      current_version_id: version.id,
      last_validated_at: now,
      last_validation_status: page.truncated
        ? 'TRUNCATED'
        : previousVersion && previousVersion.meaningful_hash === version.meaningful_hash
          ? 'OK'
          : 'CHANGED',
    },
  })

  if (items.length === 0) return { itemsObserved: 0, newResources: 0, itemsChanged: 0 }

  // Alias-aware identity: an observed redirect or confirmed canonical maps a
  // key onto the resource it already names.
  const keys = items.map((item) => item.dedupKey)
  const aliases = await tx.monitorResourceAlias.findMany({
    where: { site_id: site.id, dedup_key: { in: keys } },
    select: { dedup_key: true, resource_id: true },
  })
  const aliasMap = new Map(aliases.map((alias) => [alias.dedup_key, alias.resource_id]))

  const unaliased = items.filter((item) => !aliasMap.has(item.dedupKey))
  const created = await tx.monitorResource.createMany({
    data: unaliased.map((item) => ({
      site_id: site.id,
      kind: item.isDocument ? 'DOCUMENT' : 'PAGE',
      role: item.isDocument ? 'DOCUMENT' : 'UNKNOWN',
      raw_url: item.url,
      canonical_url: item.url,
      dedup_key: item.dedupKey,
      title: item.anchorText || titleFromUrl(item.url) || null,
      first_seen_at: now,
      last_observed_at: now,
    })),
    skipDuplicates: true,
  })
  const resources = await tx.monitorResource.findMany({
    where: { site_id: site.id, dedup_key: { in: unaliased.map((item) => item.dedupKey) } },
    select: { id: true, dedup_key: true },
  })
  const resourceByKey = new Map<string, string>(resources.map((r) => [r.dedup_key, r.id]))
  for (const [key, resourceId] of aliasMap) resourceByKey.set(key, resourceId)

  const resourceIds = [...new Set(items.map((item) => resourceByKey.get(item.dedupKey)).filter((id): id is string => Boolean(id)))]
  await tx.monitorResource.updateMany({ where: { id: { in: resourceIds } }, data: { last_observed_at: now } })

  const existing = await tx.monitorObservation.findMany({
    where: { source_id: source.id, resource_id: { in: resourceIds } },
    select: { id: true, resource_id: true, context_hash: true },
  })
  const existingByResource = new Map(existing.map((obs) => [obs.resource_id, obs]))

  const toCreate: Prisma.MonitorObservationCreateManyInput[] = []
  const unchangedIds: string[] = []
  const seenResource = new Set<string>()
  const changedResources: string[] = []
  for (const item of items) {
    const resourceId = resourceByKey.get(item.dedupKey)
    if (!resourceId || seenResource.has(resourceId)) continue
    seenResource.add(resourceId)
    const contextHash = itemContextHash(item, ctx.lineRules)
    const prior = existingByResource.get(resourceId)
    if (!prior || prior.context_hash !== contextHash) {
      changedResources.push(resourceId)
      await tx.monitorResource.update({ where: { id: resourceId }, data: { title: item.anchorText || titleFromUrl(item.url) || null } })
    }
    if (!prior) {
      toCreate.push({
        source_id: source.id,
        resource_id: resourceId,
        site_id: site.id,
        anchor_text: item.anchorText || null,
        context_text: item.contextText || null,
        context_hash: contextHash,
        date_hints: item.dateHints,
        position: item.position,
        first_seen_at: now,
        last_seen_at: now,
        last_check_generation: ctx.generation,
      })
    } else if (prior.context_hash !== contextHash) {
      await tx.monitorObservation.update({
        where: { id: prior.id },
        data: {
          anchor_text: item.anchorText || null,
          context_text: item.contextText || null,
          context_hash: contextHash,
          date_hints: item.dateHints,
          position: item.position,
          last_seen_at: now,
          last_check_generation: ctx.generation,
          missing_since: null,
        },
      })
    } else {
      unchangedIds.push(prior.id)
    }
  }
  if (toCreate.length > 0) await tx.monitorObservation.createMany({ data: toCreate, skipDuplicates: true })
  if (unchangedIds.length > 0) {
    await tx.monitorObservation.updateMany({
      where: { id: { in: unchangedIds } },
      data: { last_seen_at: now, last_check_generation: ctx.generation, missing_since: null },
    })
  }
  // Screen only what this listing changed: new entries, entries whose words
  // changed, and entries never screened. An unchanged page is not fetched
  // again just because a neighbour on the same listing changed.
  const screened = new Set((await tx.monitorOpportunity.findMany({
    where: { primary_resource_id: { in: resourceIds } },
    select: { primary_resource_id: true },
    distinct: ['primary_resource_id'],
  })).map((row) => row.primary_resource_id))
  const toScreen = [...new Set([...changedResources, ...resourceIds.filter((id) => !screened.has(id))])]
  if (process.env.MONITOR_PIPELINE_ENABLED === 'true' && toScreen.length) {
    await queueCandidates(tx, site.id, toScreen, ctx.generation === 1, fingerprint({
      items: items.map(i => [i.dedupKey, itemContextHash(i, ctx.lineRules)]).sort(),
      keywords: source.keywords, excludes: source.exclude_keywords, languages: site.language_profile,
    }))
  }
  return { itemsObserved: seenResource.size, newResources: created.count, itemsChanged: changedResources.length }
}

async function loadSource(sourceId: string): Promise<SourceWithSite | null> {
  return prisma.monitoredSource.findUnique({
    where: { id: sourceId },
    include: { site: true, ignoreRules: true },
  })
}

/** Start (or, after a crash, restart) this occurrence's check run. */
async function startCheckRun(tx: Prisma.TransactionClient, lease: Lease, source: SourceWithSite, generation: number) {
  await tx.monitorCheckRun.upsert({
    where: { source_id_check_generation: { source_id: source.id, check_generation: generation } },
    create: {
      source_id: source.id,
      site_id: source.site_id,
      check_generation: generation,
      task_id: lease.taskId,
      status: 'RUNNING',
    },
    update: {
      task_id: lease.taskId,
      status: 'RUNNING',
      complete: false,
      truncated: false,
      pages_visited: 0,
      items_observed: 0,
      new_resources: 0,
      error_class: null,
      error_message: null,
      started_at: new Date(),
      finished_at: null,
    },
  })
}

export async function runSourceCheck(lease: Lease, deps: CheckDeps): Promise<CheckOutcome> {
  const now = deps.now?.() ?? new Date()
  const sourceId = String(lease.payload.sourceId ?? lease.sourceId ?? '')
  const generation = Number(lease.payload.generation ?? 0)
  const source = await loadSource(sourceId)

  if (!source || !source.site || source.status !== 'ACTIVE' || source.site.status !== 'ACTIVE') {
    const reason = !source ? 'source deleted' : !source.site ? 'source has no site' : 'source or site is not active'
    await withFence(lease, (tx) => completeTaskInTx(tx, lease, { status: 'CANCELED', reason }))
    return { status: 'CANCELED', complete: false, pagesVisited: 0, itemsObserved: 0, newResources: 0, fetchModeUsed: null, message: reason }
  }
  const site = source.site
  const skipRules = await loadSkipRules(prisma, site.id, now)
  const watched = source.kind === 'FEED' ? source.feed_url || source.url : source.url
  if (skipRuleFor(skipRules, watched, now)) {
    // Marked "don't visit": no request, and not a failure. The run is recorded
    // as SKIPPED so the check log says why nothing was read; nothing is marked
    // missing and the site's failure streak is untouched.
    const message = `${watched} is marked don't visit; the check made no request.`
    await withFence(lease, async (tx) => {
      await tx.monitorCheckRun.upsert({
        where: { source_id_check_generation: { source_id: source.id, check_generation: generation } },
        create: { source_id: source.id, site_id: source.site_id, check_generation: generation, task_id: lease.taskId, status: 'SKIPPED', error_message: message, finished_at: new Date() },
        update: { task_id: lease.taskId, status: 'SKIPPED', complete: false, error_class: null, error_message: message, finished_at: new Date() },
      })
      await completeTaskInTx(tx, lease, { status: 'SKIPPED', reason: 'SKIPPED_BY_ADMIN' })
    })
    return { status: 'SKIPPED', complete: false, pagesVisited: 0, itemsObserved: 0, newResources: 0, fetchModeUsed: null, message }
  }
  await withFence(lease, (tx) => startCheckRun(tx, lease, source, generation))

  const ctx: PersistContext = {
    source,
    site,
    generation,
    now,
    lineRules: lineIgnorePatterns(source, now),
    urlRules: urlPrefixRules(source, now),
    skipRules,
  }

  const cursor: PageCursor = (source.cursor as PageCursor | null) ?? {}
  const passStartedAt = cursor.passStartedAt ? new Date(cursor.passStartedAt) : now

  let pagesVisited = 0
  let itemsObserved = 0
  let newResources = 0
  let itemsChanged = 0
  // Pages a "don't visit" mark kept us from reading. Such a pass is never
  // complete, so nothing listed only there is ever marked missing.
  let skippedPages = 0
  let truncated = false
  let passComplete = false
  let notModifiedHead = false
  let nextCursor: PageCursor | null = null
  let errorClass: string | undefined
  let message: string | undefined
  const modes = new Set<'FETCH' | 'BROWSER'>()
  let firstPage: FetchedPage | null = null
  let promoteTo: 'BROWSER' | 'AUTO' | null = null
  let headNextUrl: string | null | undefined = cursor.headNextUrl

  if (source.kind === 'PAGE') {
    const preferBrowser = source.fetch_mode === 'BROWSER'
    const probePlainFetch = preferBrowser && generation % 7 === 0
    const visited = new Set<string>()
    let url: string | null = source.url
    let jumpedToCursor = false

    const keyOf = (value: string) => identifyUrl(value)?.dedupKey ?? value

    while (url && pagesVisited < CHECK_LIMITS.pagesPerCheck) {
      const key = keyOf(url)
      if (visited.has(key)) {
        // Pagination that links back on itself: every reachable page is seen.
        passComplete = !truncated
        url = null
        break
      }
      visited.add(key)
      if (skipRuleFor(skipRules, url, now)) {
        skippedPages += 1
        url = null
        break
      }

      const page = await fetchListingPage(source, site, url, deps, {
        // Only a single-page listing may be validated by a 304 on page one.
        conditional: pagesVisited === 0 && !preferBrowser && !cursor.headNextUrl,
        preferBrowser,
        probePlainFetch,
      })
      pagesVisited += 1
      modes.add(page.mode)
      if (pagesVisited === 1) {
        firstPage = page
        if (!page.notModified) headNextUrl = page.nextPageUrl ?? null
        if (source.fetch_mode === 'AUTO' && page.mode === 'BROWSER') promoteTo = 'BROWSER'
        if (source.fetch_mode === 'BROWSER' && probePlainFetch && page.mode === 'FETCH' && meaningfulItems(page.items) > 0) {
          promoteTo = 'AUTO'
        }
      }

      if (page.notModified) {
        notModifiedHead = true
      } else {
        if (!page.scopeMatched) {
          // The selector stopped matching. Never fall back to the whole page
          // (that produced huge, noisy diffs) and never mark anything missing.
          errorClass = 'SELECTOR_NOT_MATCHED'
          message = `The selector "${source.selector}" no longer matches ${page.finalUrl}`
          truncated = true
          url = null // nothing to continue from: the next check starts over
          break
        }
        if (page.truncated) truncated = true
        const written = await withFence(lease, (tx) => persistPage(tx, ctx, page))
        itemsObserved += written.itemsObserved
        newResources += written.newResources
        itemsChanged += written.itemsChanged

        // A listing that shows nothing is suspect, never a clean pass: a
        // script-built page read without a browser, a challenge page, or a
        // redesign. Treating it as complete would mark every real call missing.
        if (pagesVisited === 1 && meaningfulItems(page.items) === 0) {
          const needsBrowser = !deps.renderer && source.fetch_mode !== 'FETCH' && page.mode === 'FETCH'
          errorClass = needsBrowser ? 'NEEDS_BROWSER' : 'NO_ITEMS'
          message = needsBrowser
            ? `${page.finalUrl} builds its listing with JavaScript; it needs the browser tier (MONITOR_BROWSER_ENABLED=true on the worker).`
            : `${page.finalUrl} showed no listing items; nothing is marked missing until it does.`
          truncated = true
          url = null
          break
        }
        if (page.mode === 'BROWSER' && page.truncated && !errorClass) {
          // The render never settled: often the listing loads from a host this
          // site has not approved. Say which, so an admin can approve it.
          errorClass = 'RENDER_INCOMPLETE'
          const hosts = page.blockedHosts ?? []
          message = `The rendered page did not finish loading its listing${
            hosts.length > 0 ? `; it tried to reach ${hosts.join(', ')}, which are not approved hosts for this site` : ''
          }.`
        }
      }

      // Head pages first (new items appear at the top), then resume the deeper
      // part of the listing where the previous check stopped. A cursor the
      // head walk already passed is stale and simply ignored.
      let next = page.notModified ? null : page.nextPageUrl
      if (!jumpedToCursor && cursor.nextUrl && (pagesVisited >= CHECK_LIMITS.headPages || page.notModified)) {
        jumpedToCursor = true
        if (!visited.has(keyOf(cursor.nextUrl))) next = cursor.nextUrl
      }
      if (!next) {
        passComplete = !truncated
        url = null
        break
      }
      url = next
    }
    if (url && !passComplete) {
      nextCursor = { nextUrl: url, passStartedAt: passStartedAt.toISOString() }
    }
  } else if (source.kind === 'FEED') {
    const feedUrl = source.feed_url || source.url
    const result = await deps.fetch(feedUrl, {
      inScope: siteScope(site),
      minDelayMs: site.min_delay_ms,
      tlsInsecureHosts: tlsExceptionHosts(site),
      signal: deps.signal,
    })
    pagesVisited = 1
    modes.add('FETCH')
    const xml = decodeBody(result)
    const items = await extractFeedItems(xml, result.finalUrl, identityOptions(site))
    const page: FetchedPage = {
      url: feedUrl,
      finalUrl: result.finalUrl,
      notModified: false,
      rawHash: sha256(result.body),
      truncated: result.truncated,
      httpStatus: result.status,
      etag: result.headers.etag ?? null,
      lastModified: result.headers['last-modified'] ?? null,
      items,
      scopeText: items.map((item) => `${item.anchorText} — ${item.url}`).join('\n'),
      nextPageUrl: null,
      scopeMatched: true,
      mode: 'FETCH',
      tlsExceptionUsed: result.tlsExceptionUsed,
      mimeType: result.contentType,
    }
    firstPage = page
    truncated = result.truncated
    const written = await withFence(lease, (tx) => persistPage(tx, ctx, page))
    itemsObserved = written.itemsObserved
    newResources = written.newResources
    itemsChanged = written.itemsChanged
    if (items.length === 0) {
      errorClass = 'NO_ITEMS'
      message = `${feedUrl} returned a feed with no items; nothing is marked missing until it does.`
    }
    passComplete = !truncated && items.length > 0
  } else if (source.kind === 'SITEMAP') {
    modes.add('FETCH')
    // Depth-first walk over sitemap documents. An index's children go to the
    // front of the queue and its siblings stay behind them; every document
    // fetched counts against the per-check budget; a document already read in
    // this pass is never read again (cycle guard).
    const sitemapKey = (value: string) => identifyUrl(value)?.dedupKey ?? value
    const queue: string[] = cursor.sitemapQueue && cursor.sitemapQueue.length > 0 ? [...cursor.sitemapQueue] : [source.url]
    const visitedSitemaps = new Set<string>(cursor.sitemapVisited ?? [])
    let offset = cursor.entryOffset ?? 0
    let passEntries = cursor.passEntries ?? 0
    let overflow = Boolean((cursor as { overflow?: boolean }).overflow)
    let entriesThisCheck = 0
    let fetches = 0

    while (
      queue.length > 0 &&
      fetches < CHECK_LIMITS.sitemapChildrenPerCheck &&
      entriesThisCheck < CHECK_LIMITS.sitemapEntriesPerCheck
    ) {
      const sitemapUrl = queue[0]
      if (offset === 0 && visitedSitemaps.has(sitemapKey(sitemapUrl))) {
        queue.shift()
        continue
      }
      if (skipRuleFor(skipRules, sitemapUrl, now)) {
        queue.shift()
        visitedSitemaps.add(sitemapKey(sitemapUrl))
        offset = 0
        skippedPages += 1
        continue
      }
      const result = await deps.fetch(sitemapUrl, {
        inScope: siteScope(site),
        minDelayMs: site.min_delay_ms,
        tlsInsecureHosts: tlsExceptionHosts(site),
        maxBytes: CHECK_LIMITS.sitemapMaxBytes,
        signal: deps.signal,
      })
      fetches += 1
      pagesVisited += 1
      let body = result.body
      let bodyTruncated = result.truncated
      if (result.contentKind === 'gzip') {
        const unzipped = await gunzipCapped(body, CHECK_LIMITS.sitemapMaxBytes)
        body = unzipped.buffer
        bodyTruncated = bodyTruncated || unzipped.truncated
      }
      if (bodyTruncated) truncated = true
      const parsed = parseSitemap(body.toString('utf8'), result.finalUrl, identityOptions(site))

      if (parsed.kind === 'unknown') {
        // An HTML error page served with 200 is not "a sitemap with nothing in
        // it". Keep the queue so the next check retries this document.
        errorClass = 'INVALID_SITEMAP'
        message = `${result.finalUrl} did not return a sitemap (${result.contentType || 'unknown content'}); nothing is marked missing.`
        truncated = true
        break
      }
      if (parsed.kind === 'index') {
        queue.shift()
        visitedSitemaps.add(sitemapKey(sitemapUrl))
        const pending = new Set(queue.map(sitemapKey))
        const children = parsed.sitemaps.filter((child) => !visitedSitemaps.has(sitemapKey(child)) && !pending.has(sitemapKey(child)))
        queue.unshift(...children)
        offset = 0
        continue
      }
      if (parsed.kind === 'urlset') {
        const remaining = CHECK_LIMITS.sitemapEntriesPerCheck - entriesThisCheck
        const slice = parsed.entries.slice(offset, offset + remaining)
        const items: ListingItem[] = slice.map((entry, position) => ({
          url: entry.url,
          dedupKey: entry.dedupKey,
          host: entry.host,
          anchorText: titleFromUrl(entry.url),
          contextText: entry.lastmod ? `lastmod ${entry.lastmod}` : '',
          heading: null,
          dateHints: entry.lastmod ? [entry.lastmod] : [],
          position: offset + position,
          isDocument: /\.pdf(\?|#|$)/i.test(entry.url),
        }))
        const page: FetchedPage = {
          url: sitemapUrl,
          finalUrl: result.finalUrl,
          notModified: false,
          rawHash: sha256(body),
          truncated: bodyTruncated,
          httpStatus: result.status,
          etag: null,
          lastModified: null,
          items,
          scopeText: '',
          nextPageUrl: null,
          scopeMatched: true,
          mode: 'FETCH',
          tlsExceptionUsed: result.tlsExceptionUsed,
          mimeType: result.contentType,
        }
        if (!firstPage) firstPage = page
        const written = await withFence(lease, (tx) => persistPage(tx, ctx, page))
        itemsObserved += written.itemsObserved
        newResources += written.newResources
        itemsChanged += written.itemsChanged
        entriesThisCheck += slice.length
        passEntries += slice.length

        if (offset + slice.length < parsed.entries.length) {
          // This document is not finished: resume inside it next time.
          offset += slice.length
          break
        }
        queue.shift()
        visitedSitemaps.add(sitemapKey(sitemapUrl))
        offset = 0
      }
    }

    if (queue.length > CHECK_LIMITS.sitemapQueueMax) {
      // Too many documents to remember: keep walking, but this pass can never
      // license absence, because some documents will not be read.
      queue.length = CHECK_LIMITS.sitemapQueueMax
      overflow = true
    }

    if (errorClass) {
      nextCursor = {
        sitemapQueue: queue,
        sitemapVisited: [...visitedSitemaps].slice(-CHECK_LIMITS.sitemapVisitedMax),
        entryOffset: offset,
        passEntries,
        passStartedAt: passStartedAt.toISOString(),
        ...(overflow ? { overflow: true } : {}),
      } as PageCursor
    } else if (queue.length === 0) {
      // The pass is over. It may say something is gone only if it read
      // entries, read every document, and nothing was cut short.
      if (passEntries === 0) {
        errorClass = 'NO_ITEMS'
        message = `${source.url} listed no pages in this pass; nothing is marked missing.`
      } else if (overflow) {
        errorClass = 'SITEMAP_TOO_LARGE'
        message = `${source.url} lists more sitemap documents than one pass can remember; nothing is marked missing.`
      }
      passComplete = !truncated && !errorClass && skippedPages === 0
    } else {
      nextCursor = {
        sitemapQueue: queue,
        sitemapVisited: [...visitedSitemaps].slice(-CHECK_LIMITS.sitemapVisitedMax),
        entryOffset: offset,
        passEntries,
        passStartedAt: passStartedAt.toISOString(),
        ...(overflow ? { overflow: true } : {}),
      } as PageCursor
    }
  } else {
    errorClass = 'UNSUPPORTED_KIND'
    message = `Watch point kind ${source.kind} is not supported yet`
  }

  if (skippedPages > 0) passComplete = false
  const fetchModeUsed = modes.size === 0 ? null : modes.size > 1 ? 'MIXED' : [...modes][0]
  const status: CheckOutcome['status'] =
    notModifiedHead && itemsObserved === 0 && !cursor.nextUrl ? 'NOT_MODIFIED' : passComplete && !errorClass ? 'COMPLETE' : 'PARTIAL'
  const complete = status === 'COMPLETE' || (status === 'NOT_MODIFIED' && !nextCursor)

  // Pagination topology survives a finished pass: page one's "next" link is
  // what tells the next check this listing cannot be validated by one 304.
  const cursorOut: PageCursor = { ...(nextCursor ?? {}) }
  if (source.kind === 'PAGE' && headNextUrl) cursorOut.headNextUrl = headNextUrl
  const cursorValue = Object.keys(cursorOut).length > 0 ? (cursorOut as Prisma.InputJsonObject) : Prisma.DbNull

  // Validators are only worth keeping from a clean, complete read of page
  // one. Anything suspect — no items, a dead selector, a truncated or
  // unfinished render — clears them, so the next check re-reads the page in
  // full instead of accepting a 304 that would "validate" the failure.
  const validators =
    source.kind !== 'PAGE' || !firstPage || firstPage.notModified
      ? {}
      : errorClass || firstPage.truncated
        ? { etag: null, last_modified: null }
        : { etag: firstPage.etag, last_modified: firstPage.lastModified }

  await withFence(lease, async (tx) => {
    if (status === 'NOT_MODIFIED' && firstPage) {
      // Unchanged since the validators were issued: the listing was verified
      // just now, and everything this watch point saw is still there.
      const identity = identifyUrl(firstPage.finalUrl)
      if (identity) {
        await tx.monitorResource.updateMany({
          where: { site_id: site.id, dedup_key: identity.dedupKey },
          data: { last_validated_at: now, last_validation_status: 'NOT_MODIFIED' },
        })
      }
      await tx.monitorObservation.updateMany({
        where: { source_id: source.id, missing_since: null },
        data: { last_seen_at: now, last_check_generation: generation },
      })
    }
    if (status === 'COMPLETE') {
      // Only a complete pass may say something is gone.
      await tx.monitorObservation.updateMany({
        where: { source_id: source.id, missing_since: null, last_seen_at: { lt: passStartedAt } },
        data: { missing_since: now },
      })
    }

    await tx.monitoredSource.update({
      where: { id: source.id },
      data: {
        last_checked_at: now,
        fail_count: errorClass ? { increment: 1 } : 0,
        last_error: message ?? null,
        cursor: cursorValue,
        // Nothing new and nothing changed counts toward a quiet streak; any
        // change resets it. Errors leave it as it was.
        ...(errorClass ? {} : status === 'NOT_MODIFIED' || (newResources === 0 && itemsChanged === 0) ? { quiet_streak: { increment: 1 } } : { quiet_streak: 0 }),
        ...(complete ? { last_complete_check_at: now } : {}),
        ...validators,
        ...(promoteTo ? { fetch_mode: promoteTo } : {}),
      },
    })
    await tx.monitorSite.update({
      where: { id: site.id },
      data: { consecutive_fetch_failures: 0, last_fetch_error: null },
    })
    await tx.monitorCheckRun.update({
      where: { source_id_check_generation: { source_id: source.id, check_generation: generation } },
      data: {
        status,
        complete,
        truncated,
        pages_visited: pagesVisited,
        items_observed: itemsObserved,
        new_resources: newResources,
        fetch_mode_used: fetchModeUsed,
        http_status: firstPage?.httpStatus ?? null,
        error_class: errorClass ?? null,
        error_message: message ?? null,
        finished_at: new Date(),
      },
    })
    await completeTaskInTx(tx, lease, { status, pagesVisited, itemsObserved, newResources })
  })

  return { status, complete, pagesVisited, itemsObserved, newResources, fetchModeUsed, errorClass, message }
}

/**
 * Record a failed check under the task's fence: the check run, the source's
 * error, and — for genuine fetch failures, never deferrals — the site's
 * failure streak, pausing the site once it passes the threshold.
 */
export async function recordCheckFailure(
  tx: Prisma.TransactionClient,
  lease: Lease,
  error: unknown
): Promise<{ sitePaused: boolean; siteId: string | null }> {
  const sourceId = String(lease.payload.sourceId ?? lease.sourceId ?? '')
  const generation = Number(lease.payload.generation ?? 0)
  const fetchError = isMonitorFetchError(error) ? error : null
  const deferral = fetchError?.isDeferral ?? false
  const message = error instanceof Error ? error.message : String(error)

  await tx.monitorCheckRun.updateMany({
    where: { source_id: sourceId, check_generation: generation },
    data: {
      status: deferral ? 'DEFERRED' : 'FAILED',
      complete: false,
      error_class: fetchError?.code ?? 'ERROR',
      error_message: message.slice(0, 1000),
      http_status: fetchError?.httpStatus ?? null,
      finished_at: new Date(),
    },
  })
  if (deferral) return { sitePaused: false, siteId: null }

  const exists = await tx.monitoredSource.findUnique({ where: { id: sourceId }, select: { id: true } })
  if (!exists) return { sitePaused: false, siteId: null }
  const source = await tx.monitoredSource.update({
    where: { id: sourceId },
    data: { last_checked_at: new Date(), fail_count: { increment: 1 }, last_error: message.slice(0, 500) },
    select: { site_id: true },
  })
  if (!source.site_id) return { sitePaused: false, siteId: null }
  const site = await tx.monitorSite.update({
    where: { id: source.site_id },
    data: {
      consecutive_fetch_failures: { increment: 1 },
      last_fetch_error: message.slice(0, 500),
      last_fetch_error_at: new Date(),
    },
    select: { id: true, consecutive_fetch_failures: true, status: true },
  })
  if (site.status === 'ACTIVE' && site.consecutive_fetch_failures >= SITE_AUTO_PAUSE_FAILURES) {
    await tx.monitorSite.update({ where: { id: site.id }, data: { status: 'PAUSED' } })
    return { sitePaused: true, siteId: site.id }
  }
  return { sitePaused: false, siteId: site.id }
}
