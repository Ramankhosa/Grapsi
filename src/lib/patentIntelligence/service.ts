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
import type { IndianPatentRecord, PatentNestResponse, PatentNestSearchCoverage, PatentNestSearchData } from '@/lib/patentnest/types'
import { checkRateLimit } from '@/lib/recommendations/rateLimit'

import {
  buildSearchCacheKey,
  clampLimit,
  derivePatentFacets,
  isValidQuery,
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

export type PatentNestClientLike = {
  searchPatents(query: string, options?: PatentNestSearchOptions): Promise<PatentNestResponse<PatentNestSearchData>>
  getPatent(publicationNumber: string): Promise<PatentNestResponse<IndianPatentRecord>>
}

export type PatentIntelligenceServiceDeps = {
  /** Factory so a missing key surfaces as PATENTNEST_NOT_CONFIGURED at call time, not at import time. */
  client?: () => PatentNestClientLike
  now?: () => number
}

export type PatentSearchInput = { query: string; limit?: number; jurisdictions?: string[] }

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

  async function fetchSearch(query: string, limit: number, jurisdictions: string[]): Promise<PatentSearchResponse> {
    const client = makeClient()
    const response = await client.searchPatents(query, { limit, jurisdictions })
    const results = (Array.isArray(response.data?.results) ? response.data.results : [])
      .map(toPatentSearchItem)
      .filter((item): item is PatentSearchItem => Boolean(item))
    return {
      query,
      limit,
      results,
      facets: derivePatentFacets(results),
      coverage: toCoverage(response.data?.coverage),
      capped: results.length >= limit,
      diagnostics: {
        requestId: response.meta?.requestId ?? null,
        durationMs: typeof response.meta?.durationMs === 'number' ? response.meta.durationMs : null,
        cached: false,
        jurisdictionFilterApplied: jurisdictions.length > 0 && isPatentNestJurisdictionFilterEnabled(),
        upstreamRemaining: toUpstreamRemaining(response.meta),
      },
    }
  }

  async function searchPatents(input: PatentSearchInput): Promise<PatentSearchResponse> {
    const query = normalizeQuery(input.query)
    if (!isValidQuery(query)) {
      throw new PatentNestApiError({
        code: 'INVALID_QUERY',
        message: 'Search query must contain between 2 and 2,000 characters.',
        status: 400,
      })
    }
    const limit = clampLimit(input.limit)
    const jurisdictions = isPatentNestJurisdictionFilterEnabled()
      ? Array.from(new Set((input.jurisdictions || []).map((value) => value.trim().toUpperCase()).filter((value) => /^[A-Z]{2}$/.test(value))))
      : []
    const key = buildSearchCacheKey(query, limit, jurisdictions)

    const cached = SEARCH_CACHE_TTL_MS > 0 ? searchCache.get(key, now()) : undefined
    if (cached) return { ...cached, diagnostics: { ...cached.diagnostics, cached: true } }

    const inflight = searchInflight.get(key)
    if (inflight) return inflight

    const promise = fetchSearch(query, limit, jurisdictions)
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

  async function fetchDetail(publicationNumber: string): Promise<PatentSearchItem> {
    const client = makeClient()
    const response = await client.getPatent(publicationNumber)
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

  async function getPatent(publicationNumber: string): Promise<PatentDetailResponse> {
    const trimmed = String(publicationNumber ?? '').trim()
    const key = normalizePublicationNumberKey(trimmed)
    if (!key || trimmed.length > 200) {
      throw new PatentNestApiError({
        code: 'INVALID_PUBLICATION_NUMBER',
        message: 'A valid publication number is required.',
        status: 400,
      })
    }

    const cached = detailCache.get(key, now())
    if (cached) return { patent: cached, diagnostics: { requestId: null, cached: true } }

    let promise = detailInflight.get(key)
    if (!promise) {
      promise = fetchDetail(trimmed)
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
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) },
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
  if (bucket === 'search') {
    const global = checkRateLimit('patent-search:global', PATENT_RATE_LIMITS.searchGlobal, RATE_WINDOW_MS)
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
      { status: 400 },
    )
  }
  if (error instanceof PatentNestApiError) {
    const mapped = mapUpstreamError(error)
    const headers = new Headers()
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
    { status: 500 },
  )
}

// Phase-2 hook (not wired): "Compare with my idea" will call PatentNest's
// /api/v1/analysis endpoints, which consume scarce analysis credits, so unlike
// searches it must be metered — add 'patent_search_compare' to
// IdeaIntelligenceOperationType in src/lib/ideaIntelligence/quota.ts and wrap the
// call with reserveIdeaIntelligenceUsage / completeIdeaIntelligenceUsage.
