// NOTE: no `import 'server-only'` here — that marker throws when the module is
// reached from a pages-router API route (the reviewer's report pipeline), and
// this client is only ever imported from server-side code anyway.

import type {
  IndianPatentRecord,
  PatentNestRateLimitSnapshot,
  PatentNestResponse,
  SearchIndianPatentsData,
  PatentNestField,
  PatentNestSearchRequest,
} from './types'
import { patentNestFieldsSchema, patentNestSearchSchema } from './searchContract'

const DEFAULT_PATENTNEST_API_BASE_URL = 'https://patentnest.ai'
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_RETRIES = 2
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503])
const UPSTREAM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,39}$/

type FetchImplementation = typeof fetch
type SleepImplementation = (milliseconds: number) => Promise<void>

export interface PatentNestClientOptions {
  apiKey?: string
  /** Overrides PATENTNEST_API_BASE_URL / the production origin (staging, tests). */
  baseUrl?: string
  timeoutMs?: number
  /** Retries after a 429/500/503 (default 2 — background pipelines can afford to wait). */
  maxRetries?: number
  /**
   * Upper bound on one retry pause, even when Retry-After asks for longer.
   * Interactive callers (the Patent Search UI) set this low so a busy upstream
   * surfaces as a countdown instead of a hung request; by default unbounded.
   */
  maxRetryDelayMs?: number
  fetchImplementation?: FetchImplementation
  sleep?: SleepImplementation
}

export type PatentNestSearchOptions = Omit<PatentNestSearchRequest, 'query'>

export class PatentNestApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  readonly retryAfterSeconds?: number
  /** PatentNest's own machine code (e.g. CORPUS_NOT_READY, DAILY_QUOTA_EXCEEDED) when it sent one. */
  readonly upstreamCode?: string

  constructor(input: {
    code: string
    message: string
    status: number
    requestId?: string
    retryAfterSeconds?: number
    upstreamCode?: string
  }) {
    super(input.message)
    this.name = 'PatentNestApiError'
    this.code = input.code
    this.status = input.status
    this.requestId = input.requestId
    this.retryAfterSeconds = input.retryAfterSeconds
    this.upstreamCode = input.upstreamCode
  }
}

export function isPatentNestConfigured(): boolean {
  return /^pn_live_\S+$/.test(process.env.PATENTNEST_API_KEY?.trim() || '')
}

/**
 * v1.3 supports jurisdictions by default. Explicit false supports older staging
 * origins; configured restrictions must not be silently discarded.
 */
export function isPatentNestJurisdictionFilterEnabled(): boolean {
  return process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER !== 'false'
}

export function resolvePatentNestBaseUrl(override?: string): string {
  const candidate = (override ?? process.env.PATENTNEST_API_BASE_URL ?? '').trim()
  const base = candidate || DEFAULT_PATENTNEST_API_BASE_URL
  let url: URL
  try { url = new URL(base) } catch {
    throw new PatentNestApiError({ code: 'PATENTNEST_INVALID_CONFIGURATION', message: 'PatentNest API origin is invalid.', status: 503 })
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new PatentNestApiError({ code: 'PATENTNEST_INVALID_CONFIGURATION', message: 'PatentNest requires an HTTPS origin (HTTP is allowed only on loopback).', status: 503 })
  }
  return url.origin
}

export class PatentNestClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly maxRetryDelayMs: number
  private readonly fetchImplementation: FetchImplementation
  private readonly sleep: SleepImplementation

  constructor(options: PatentNestClientOptions = {}) {
    const apiKey = (options.apiKey ?? process.env.PATENTNEST_API_KEY ?? '').trim()
    if (!apiKey) {
      throw new PatentNestApiError({
        code: 'PATENTNEST_NOT_CONFIGURED',
        message: 'PatentNest API is not configured on the server.',
        status: 503,
      })
    }
    if (!/^pn_live_\S+$/.test(apiKey)) {
      throw new PatentNestApiError({
        code: 'PATENTNEST_INVALID_CONFIGURATION',
        message: 'PatentNest API configuration is invalid.',
        status: 503,
      })
    }

    this.apiKey = apiKey
    this.baseUrl = resolvePatentNestBaseUrl(options.baseUrl)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? MAX_RETRIES))
    this.maxRetryDelayMs = Math.max(0, options.maxRetryDelayMs ?? Number.POSITIVE_INFINITY)
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  /** Hybrid semantic + text search. Jurisdiction-agnostic: returns whatever corpus PatentNest exposes. */
  async searchPatents(
    query: string | PatentNestSearchRequest,
    options: PatentNestSearchOptions = {},
  ): Promise<PatentNestResponse<SearchIndianPatentsData>> {
    const input = typeof query === 'string'
      ? { ...options, ...(query.trim() ? { query: query.trim() } : {}) }
      : query
    const parsed = patentNestSearchSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new PatentNestApiError({
        code: issue.path[0] === 'query' ? 'INVALID_QUERY' : issue.path[0] === 'limit' ? 'INVALID_LIMIT' : 'INVALID_REQUEST',
        message: issue.message,
        status: 400,
      })
    }
    const body = parsed.data
    if (body.jurisdictions) {
      if (!isPatentNestJurisdictionFilterEnabled()) {
        throw new PatentNestApiError({ code: 'INVALID_REQUEST', message: 'Jurisdiction filtering is disabled for this PatentNest origin.', status: 400 })
      }
      body.jurisdictions = Array.from(new Set(body.jurisdictions))
    }

    return this.request<SearchIndianPatentsData>('/api/v1/patents/search', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** Back-compat alias kept for evidenceSources.ts and the original tests. */
  searchIndianPatents(query: string, limit = 20): Promise<PatentNestResponse<SearchIndianPatentsData>> {
    return this.searchPatents(query, { limit, ...(isPatentNestJurisdictionFilterEnabled() ? { jurisdictions: ['IN'] } : {}) })
  }

  async getPatent(publicationNumber: string, options: { fields?: PatentNestField[] } = {}): Promise<PatentNestResponse<IndianPatentRecord>> {
    const normalizedPublicationNumber = typeof publicationNumber === 'string'
      ? publicationNumber.trim()
      : ''
    if (!/[A-Za-z0-9]/.test(normalizedPublicationNumber) || normalizedPublicationNumber.length > 200) {
      throw new PatentNestApiError({
        code: 'INVALID_PUBLICATION_NUMBER',
        message: 'A valid publication number is required.',
        status: 400,
      })
    }

    const fields = options.fields === undefined ? undefined : patentNestFieldsSchema.safeParse(options.fields)
    if (fields && !fields.success) {
      throw new PatentNestApiError({ code: 'INVALID_REQUEST', message: 'Select valid patent response fields.', status: 400 })
    }
    const suffix = fields?.success ? `?${new URLSearchParams({ fields: Array.from(new Set(fields.data)).join(',') })}` : ''
    return this.request<IndianPatentRecord>(
      `/api/v1/patents/${encodeURIComponent(normalizedPublicationNumber)}${suffix}`,
      { method: 'GET' },
    )
  }

  /** Back-compat alias. */
  getIndianPatent(publicationNumber: string): Promise<PatentNestResponse<IndianPatentRecord>> {
    return this.getPatent(publicationNumber)
  }

  private async request<T>(path: string, init: RequestInit): Promise<PatentNestResponse<T>> {
    let lastError: PatentNestApiError | undefined

    const maxRetries = this.maxRetries
    const pause = (milliseconds: number) => this.sleep(Math.min(milliseconds, this.maxRetryDelayMs))

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const startedAt = Date.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        })
        const requestId = response.headers.get('x-request-id') || undefined

        console.info('[PatentNest] API response', {
          method: init.method,
          path,
          status: response.status,
          requestId: requestId || 'unavailable',
          durationMs: Date.now() - startedAt,
          attempt: attempt + 1,
        })

        if (response.ok) {
          const body = await parseJson(response)
          if (!isResponseEnvelope<T>(body)) {
            throw new PatentNestApiError({
              code: 'PATENTNEST_INVALID_RESPONSE',
              message: 'PatentNest returned an invalid response.',
              status: 502,
              requestId,
            })
          }
          const rateLimit = parseRateLimitHeaders(response.headers)
          return rateLimit ? { ...body, meta: { ...body.meta, rateLimit } } : body
        }

        const retryAfterMilliseconds = parseRetryAfter(response.headers.get('retry-after'))
        // Only the machine code is lifted from the error body; the message is
        // never retained so an upstream failure can't echo secrets or prose.
        const upstreamCode = readUpstreamCode(await parseJson(response))
        lastError = createHttpError(response.status, requestId, retryAfterMilliseconds, upstreamCode)
        if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt >= maxRetries) {
          throw lastError
        }

        await pause(retryAfterMilliseconds ?? exponentialBackoff(attempt))
      } catch (error) {
        if (error instanceof PatentNestApiError) {
          if (!RETRYABLE_STATUS_CODES.has(error.status) || attempt >= maxRetries) throw error
          lastError = error
          continue
        }

        lastError = new PatentNestApiError({
          code: controller.signal.aborted ? 'PATENTNEST_TIMEOUT' : 'PATENTNEST_NETWORK_ERROR',
          message: controller.signal.aborted
            ? `PatentNest request timed out after ${this.timeoutMs} ms.`
            : 'PatentNest could not be reached.',
          status: 503,
        })

        if (attempt >= maxRetries) throw lastError
        await pause(exponentialBackoff(attempt))
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError ?? new PatentNestApiError({
      code: 'PATENTNEST_REQUEST_FAILED',
      message: 'PatentNest request failed.',
      status: 503,
    })
  }
}

function exponentialBackoff(attempt: number) {
  return 500 * 2 ** attempt
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)

  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - Date.now())
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function parseRateLimitHeaders(headers: Headers): PatentNestRateLimitSnapshot | undefined {
  const snapshot: PatentNestRateLimitSnapshot = {
    limit: headerNumber(headers, 'ratelimit-limit'),
    remaining: headerNumber(headers, 'ratelimit-remaining'),
    resetSeconds: headerNumber(headers, 'ratelimit-reset'),
    dailyRemaining: headerNumber(headers, 'x-ratelimit-daily-remaining'),
    monthlyRemaining: headerNumber(headers, 'x-ratelimit-monthly-remaining'),
  }
  const hasAny = Object.values(snapshot).some((value) => value !== null)
  return hasAny ? snapshot : undefined
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function readUpstreamCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const code = (body as { error?: { code?: unknown } }).error?.code
  return typeof code === 'string' && UPSTREAM_CODE_PATTERN.test(code) ? code : undefined
}

function isResponseEnvelope<T>(body: unknown): body is PatentNestResponse<T> {
  if (!body || typeof body !== 'object') return false
  const candidate = body as Partial<PatentNestResponse<T>>
  return Boolean(
    candidate.data !== undefined &&
    candidate.meta &&
    typeof candidate.meta.requestId === 'string' &&
    typeof candidate.meta.durationMs === 'number',
  )
}

function createHttpError(
  status: number,
  requestId: string | undefined,
  retryAfterMilliseconds: number | undefined,
  upstreamCode?: string,
) {
  const codes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    429: 'RATE_LIMITED',
    500: 'PATENTNEST_INTERNAL_ERROR',
    503: 'PATENTNEST_UNAVAILABLE',
  }
  const messages: Record<number, string> = {
    400: 'PatentNest rejected the request.',
    401: 'PatentNest authentication failed.',
    403: 'PatentNest denied access to this resource.',
    404: 'The requested patent was not found.',
    429: 'PatentNest rate limit exceeded.',
    500: 'PatentNest encountered an internal error.',
    503: 'PatentNest is temporarily unavailable.',
  }

  return new PatentNestApiError({
    code: codes[status] || 'PATENTNEST_UPSTREAM_ERROR',
    message: messages[status] || `PatentNest request failed with HTTP ${status}.`,
    status,
    requestId,
    retryAfterSeconds: retryAfterMilliseconds === undefined
      ? undefined
      : Math.ceil(retryAfterMilliseconds / 1_000),
    upstreamCode,
  })
}

export function searchPatents(query: string | PatentNestSearchRequest, options: PatentNestSearchOptions = {}) {
  return new PatentNestClient().searchPatents(query, options)
}

export function getPatent(publicationNumber: string, options: { fields?: PatentNestField[] } = {}) {
  return new PatentNestClient().getPatent(publicationNumber, options)
}

export function searchIndianPatents(query: string, limit = 20) {
  return new PatentNestClient().searchIndianPatents(query, limit)
}

export function getIndianPatent(publicationNumber: string) {
  return new PatentNestClient().getIndianPatent(publicationNumber)
}
