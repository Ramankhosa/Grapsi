/**
 * Patent Search server service: wraps the PatentNest client with a short
 * per-process result cache, per-user + global rate limiting, and a single
 * error→HTTP mapping used by every /api/patent-intelligence route.
 *
 * Caches and limiters are in-process only (no Redis), so with PM2 workers each
 * worker keeps its own window — treat the limits as per-worker approximations,
 * the same caveat as src/lib/recommendations/rateLimit.ts. They exist to keep
 * Grapsi from burning the shared PatentNest key's 30 req/min budget, not as a
 * billing quota: searches are deliberately NOT written to the usage ledger.
 */

import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

import {
  PatentNestApiError,
  PatentNestClient,
  isPatentNestConfigured,
  isPatentNestJurisdictionFilterEnabled,
  type PatentNestSearchOptions,
} from '@/lib/patentnest/client'
import type { IndianPatentRecord, PatentNestResponse, PatentNestSearchCoverage, PatentNestSearchData, PatentNestSearchRequest, PatentNestField } from '@/lib/patentnest/types'
import { patentNestFieldsSchema } from '@/lib/patentnest/searchContract'
import { checkRateLimit } from '@/lib/recommendations/rateLimit'

import {
  derivePatentFacets,
  normalizePublicationNumberKey,
  normalizeQuery,
  toPatentSearchItem,
} from './searchCore'
import type {
  PatentDetailResponse,
  PatentSearchCoverage,
  PatentSearchItem,
  PatentSearchResponse,
  PatentUpstreamRemaining,
} from './types'
import { searchRequestSchema } from './schemas'
import { PATENT_PRIVATE_HEADERS } from './http'

export type PatentNestClientLike = {
  searchPatents(query: string, options?: PatentNestSearchOptions): Promise<PatentNestResponse<PatentNestSearchData>>
  getPatent(publicationNumber: string, options?: { fields?: PatentNestField[] }): Promise<PatentNestResponse<IndianPatentRecord>>
}

export type PatentIntelligenceServiceDeps = {
  /** Factory so a missing key surfaces as PATENTNEST_NOT_CONFIGURED at call time, not at import time. */
  client?: () => PatentNestClientLike
  now?: () => number
}

export type PatentSearchInput = PatentNestSearchRequest

// Interactive budget: one retry, never pausing more than 2s even if PatentNest
// sends Retry-After: 20. A busy upstream then surfaces as a countdown banner
// within ~2s instead of holding the request for the full retry ladder.
const INTERACTIVE_CLIENT_OPTIONS = { maxRetries: 1, maxRetryDelayMs: 2_000 } as const

const SEARCH_CACHE_TTL_MS = Math.max(0, Number(process.env.PATENT_SEARCH_CACHE_MS || 5 * 60 * 1000))
const SEARCH_CACHE_MAX_KEYS = 200
const DETAIL_CACHE_TTL_MS = 15 * 60 * 1000
const DETAIL_CACHE_MAX_KEYS = 500

const RATE_WINDOW_MS = 60_000
export const PATENT_RATE_LIMITS = {
  search: Math.max(1, Number(process.env.PATENT_SEARCH_RATE_LIMIT_PER_MIN || 20)),
  /** One shared PatentNest key: keep the whole app under its 30 req/min budget. */
  searchGlobal: Math.max(1, Number(process.env.PATENT_SEARCH_GLOBAL_RATE_LIMIT_PER_MIN || 25)),
  detail: 60,
  shortlist: 60,
} as const

export type PatentRateBucket = 'search' | 'detail' | 'shortlist'

type CacheEntry<T> = { value: T; expiresAt: number }

function createCache<T>(maxKeys: number) {
  const map = new Map<string, CacheEntry<T>>()
  return {
    get(key: string, now: number): T | undefined {
      const entry = map.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= now) {
        map.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key: string, value: T, expiresAt: number) {
      for (const [existingKey, entry] of map) {
        if (entry.expiresAt <= Date.now()) map.delete(existingKey)
      }
      while (map.size >= maxKeys) {
        const oldestKey = map.keys().next().value
        if (oldestKey === undefined) break
        map.delete(oldestKey)
      }
      map.delete(key)
      map.set(key, { value, expiresAt })
    },
    clear() {
      map.clear()
    },
  }
}

export function isPatentSearchEnabled(): boolean {
  return isPatentNestConfigured()
}

function toCoverage(raw: PatentNestSearchCoverage | null | undefined): PatentSearchCoverage | null {
  if (!raw || typeof raw !== 'object') return null
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    corpus: text(raw.corpus),
    description: text(raw.description),
    jurisdiction: text(raw.jurisdiction)?.toUpperCase() ?? null,
    documents: num(raw.documents),
    semanticCoveragePercent: num(raw.semanticCoveragePercent),
    searchMode: text(raw.searchMode),
    embeddingModel: text(raw.embeddingModel),
    ...(raw.jurisdictions ? { jurisdictions: raw.jurisdictions } : {}),
    ...(raw.sources ? { sources: raw.sources } : {}),
    ...(raw.limitations ? { limitations: raw.limitations } : {}),
  }
}

function toUpstreamRemaining(meta: PatentNestResponse<unknown>['meta']): PatentUpstreamRemaining | null {
  const snapshot = meta.rateLimit
  if (!snapshot) return null
  return { minute: snapshot.remaining, daily: snapshot.dailyRemaining, monthly: snapshot.monthlyRemaining }
}

export function createPatentIntelligenceService(deps: PatentIntelligenceServiceDeps = {}) {
  const now = deps.now ?? (() => Date.now())
  const makeClient = deps.client ?? (() => new PatentNestClient(INTERACTIVE_CLIENT_OPTIONS))
  const searchCache = createCache<PatentSearchResponse>(SEARCH_CACHE_MAX_KEYS)
  const searchInflight = new Map<string, Promise<PatentSearchResponse>>()
  const detailCache = createCache<PatentSearchItem>(DETAIL_CACHE_MAX_KEYS)
  const detailInflight = new Map<string, Promise<PatentSearchItem>>()

  async function fetchSearch(query: string, options: PatentNestSearchOptions & { limit: number }): Promise<PatentSearchResponse> {
    const client = makeClient()
    const response = await client.searchPatents(query, options)
    const mode = options.mode || (query ? 'hybrid' : 'structured')
    const pagination = response.data?.pagination
    if (!Array.isArray(response.data?.results) || (mode === 'structured' && (
      !pagination || pagination.offset !== (options.offset || 0) || pagination.limit !== options.limit
      || typeof pagination.hasMore !== 'boolean'
      || (pagination.nextOffset !== null && (!Number.isInteger(pagination.nextOffset) || pagination.nextOffset <= pagination.offset || pagination.nextOffset > 10000))
    ))) {
      throw new PatentNestApiError({ code: 'PATENTNEST_INVALID_RESPONSE', message: 'PatentNest returned invalid search results.', status: 502, requestId: response.meta?.requestId })
    }
    const results = response.data.results
      .map(toPatentSearchItem)
      .filter((item): item is PatentSearchItem => Boolean(item))
    return {
      query,
      limit: options.limit,
      results,
      facets: derivePatentFacets(results),
      coverage: toCoverage(response.data?.coverage),
      mode,
      ...(mode === 'structured' ? { pagination } : {}),
      capped: mode === 'hybrid' && results.length >= options.limit,
      diagnostics: {
        requestId: response.meta?.requestId ?? null,
        durationMs: typeof response.meta?.durationMs === 'number' ? response.meta.durationMs : null,
        cached: false,
        jurisdictionFilterApplied: Boolean(options.jurisdictions?.length),
        upstreamRemaining: toUpstreamRemaining(response.meta),
      },
    }
  }

  async function searchPatents(input: PatentSearchInput): Promise<PatentSearchResponse> {
    const parsed = searchRequestSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new PatentNestApiError({
        code: issue.path[0] === 'query' ? 'INVALID_QUERY' : 'INVALID_REQUEST',
        message: issue.message,
        status: 400,
      })
    }
    const { query: rawQuery, ...options } = parsed.data
    const query = options.mode === 'structured' ? (rawQuery || '').trim() : normalizeQuery(rawQuery)
    if (options.jurisdictions) {
      if (!isPatentNestJurisdictionFilterEnabled()) {
        throw new PatentNestApiError({ code: 'INVALID_REQUEST', message: 'Jurisdiction filtering is disabled for this PatentNest origin.', status: 400 })
      }
      options.jurisdictions = Array.from(new Set(options.jurisdictions)).sort()
    }
    // Every parameter affecting the returned page belongs in the cache key.
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
    const key = JSON.stringify(canonical({ ...options, query: query.toLowerCase() }))

    const cached = SEARCH_CACHE_TTL_MS > 0 ? searchCache.get(key, now()) : undefined
    if (cached) return { ...cached, diagnostics: { ...cached.diagnostics, cached: true } }

    const inflight = searchInflight.get(key)
    if (inflight) return inflight

    const promise = fetchSearch(query, options)
      .then((result) => {
        if (SEARCH_CACHE_TTL_MS > 0) searchCache.set(key, result, now() + SEARCH_CACHE_TTL_MS)
        return result
      })
      .finally(() => {
        searchInflight.delete(key)
      })
    searchInflight.set(key, promise)
    return promise
  }

  async function fetchDetail(publicationNumber: string, fields?: PatentNestField[]): Promise<PatentSearchItem> {
    const client = makeClient()
    const response = fields ? await client.getPatent(publicationNumber, { fields }) : await client.getPatent(publicationNumber)
    const item = toPatentSearchItem(response.data)
      ?? toPatentSearchItem({ ...(response.data || {}), publicationNumber })
    if (!item) {
      throw new PatentNestApiError({
        code: 'PATENTNEST_INVALID_RESPONSE',
        message: 'PatentNest returned an invalid patent record.',
        status: 502,
        requestId: response.meta?.requestId,
      })
    }
    return item
  }

  async function getPatent(publicationNumber: string, options: { fields?: PatentNestField[] } = {}): Promise<PatentDetailResponse> {
    const trimmed = String(publicationNumber ?? '').trim()
    const publicationKey = normalizePublicationNumberKey(trimmed)
    if (!publicationKey || trimmed.length > 200) {
      throw new PatentNestApiError({
        code: 'INVALID_PUBLICATION_NUMBER',
        message: 'A valid publication number is required.',
        status: 400,
      })
    }

    const fields = options.fields === undefined ? undefined : Array.from(new Set(patentNestFieldsSchema.parse(options.fields))).sort()
    const key = fields ? `${publicationKey}|${fields.join(',')}` : publicationKey

    const cached = detailCache.get(key, now())
    if (cached) return { patent: cached, diagnostics: { requestId: null, cached: true } }

    let promise = detailInflight.get(key)
    if (!promise) {
      promise = fetchDetail(trimmed, fields)
        .then((item) => {
          detailCache.set(key, item, now() + DETAIL_CACHE_TTL_MS)
          return item
        })
        .finally(() => {
          detailInflight.delete(key)
        })
      detailInflight.set(key, promise)
    }
    const patent = await promise
    return { patent, diagnostics: { requestId: null, cached: false } }
  }

  return {
    searchPatents,
    getPatent,
    __resetCachesForTests() {
      searchCache.clear()
      detailCache.clear()
      searchInflight.clear()
      detailInflight.clear()
    },
  }
}

export type PatentIntelligenceService = ReturnType<typeof createPatentIntelligenceService>

export const patentIntelligenceService: PatentIntelligenceService = createPatentIntelligenceService()

function rateLimitResponse(message: string, resetAt: number): NextResponse {
  return NextResponse.json(
    { error: message, code: 'RATE_LIMITED', resetAt: new Date(resetAt).toISOString() },
    {
      status: 429,
      headers: { ...PATENT_PRIVATE_HEADERS, 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) },
    },
  )
}

/**
 * Per-user fixed window, plus (for searches) one global bucket so the whole
 * deployment stays inside PatentNest's per-client minute budget. Keys never
 * include the client IP or a per-request id — both let a caller mint buckets.
 */
export function enforcePatentRateLimit(userId: string, bucket: PatentRateBucket): NextResponse | null {
  const perUser = checkRateLimit(`patent-${bucket}:${userId}`, PATENT_RATE_LIMITS[bucket], RATE_WINDOW_MS)
  if (!perUser.allowed) {
    const message = bucket === 'search'
      ? "You're searching faster than we can keep up. Wait a few seconds and try again."
      : 'Too many patent requests. Please wait and try again.'
    return rateLimitResponse(message, perUser.resetAt)
  }
  if (bucket === 'search' || bucket === 'detail') {
    const global = checkRateLimit('patent-upstream:global', PATENT_RATE_LIMITS.searchGlobal, RATE_WINDOW_MS)
    if (!global.allowed) {
      return rateLimitResponse('Patent search is busy right now. Please try again in a moment.', global.resetAt)
    }
  }
  return null
}

type MappedError = { status: number; code: string; message: string }

function mapUpstreamError(error: PatentNestApiError): MappedError {
  if (error.code === 'PATENTNEST_NOT_CONFIGURED' || error.code === 'PATENTNEST_INVALID_CONFIGURATION') {
    return { status: 503, code: 'PATENT_SEARCH_NOT_CONFIGURED', message: 'Patent search is not enabled for this deployment.' }
  }
  if (error.code === 'PATENTNEST_TIMEOUT') {
    return { status: 504, code: 'PATENTNEST_TIMEOUT', message: 'PatentNest did not answer in time. Please try again.' }
  }
  if (error.code === 'PATENTNEST_INVALID_RESPONSE') {
    return { status: 502, code: 'PATENTNEST_UPSTREAM_ERROR', message: 'PatentNest returned an unexpected response.' }
  }
  if (error.status === 400) return { status: 400, code: 'INVALID_REQUEST', message: error.message }
  if (error.status === 413) return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: error.message }
  if (error.status === 403 && error.upstreamCode === 'JURISDICTION_NOT_AVAILABLE') {
    return { status: 400, code: 'JURISDICTION_NOT_AVAILABLE', message: 'The selected patent offices are not available. Choose India or another enabled office.' }
  }
  if (error.status === 401 || error.status === 403) {
    // Never let an upstream key problem look like an expired Grapsi session.
    return { status: 502, code: 'PATENTNEST_UPSTREAM_AUTH', message: 'Patent search is temporarily unavailable (upstream authentication failed).' }
  }
  if (error.status === 404) return { status: 404, code: 'PATENT_NOT_FOUND', message: 'We could not find that publication number in PatentNest.' }
  if (error.status === 429) return { status: 429, code: 'UPSTREAM_RATE_LIMITED', message: 'PatentNest is busy. Please try again shortly.' }
  if (error.status === 503) return { status: 503, code: 'PATENTNEST_UNAVAILABLE', message: 'The patent corpus is temporarily unavailable. Please retry in a minute.' }
  if (error.status >= 500) return { status: 502, code: 'PATENTNEST_UPSTREAM_ERROR', message: 'PatentNest could not complete the request.' }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Unable to complete the patent request.' }
}

/** Flat `{ error, code, … }` envelope shared by the module's routes; forwards X-Request-ID / Retry-After. */
export function patentErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.errors[0]?.message || 'Invalid patent request.', code: 'INVALID_REQUEST' },
      { status: 400, headers: PATENT_PRIVATE_HEADERS },
    )
  }
  if (error instanceof PatentNestApiError) {
    const mapped = mapUpstreamError(error)
    const headers = new Headers(PATENT_PRIVATE_HEADERS)
    if (error.requestId) headers.set('X-Request-ID', error.requestId)
    if (error.retryAfterSeconds !== undefined) headers.set('Retry-After', String(Math.max(1, error.retryAfterSeconds)))
    if (mapped.status >= 500) {
      console.error('[PatentIntelligence] Upstream failure', {
        code: error.code, upstreamCode: error.upstreamCode, status: error.status, requestId: error.requestId,
      })
    }
    return NextResponse.json(
      {
        error: mapped.message,
        code: mapped.code,
        ...(error.requestId ? { requestId: error.requestId } : {}),
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
      },
      { status: mapped.status, headers },
    )
  }
  console.error('[PatentIntelligence] Unexpected error', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
  })
  return NextResponse.json(
    { error: 'Unable to complete the patent request.', code: 'INTERNAL_ERROR' },
    { status: 500, headers: PATENT_PRIVATE_HEADERS },
  )
}

// Phase-2 hook (not wired): "Compare with my idea" will call PatentNest's
// /api/v1/analysis endpoints, which consume scarce analysis credits, so unlike
// searches it must be metered — add 'patent_search_compare' to
// IdeaIntelligenceOperationType in src/lib/ideaIntelligence/quota.ts and wrap the
// call with reserveIdeaIntelligenceUsage / completeIdeaIntelligenceUsage.
