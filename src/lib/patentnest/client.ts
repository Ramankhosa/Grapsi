import 'server-only'

import type {
  IndianPatentRecord,
  PatentNestResponse,
  SearchIndianPatentsData,
} from './types'

const PATENTNEST_API_BASE_URL = 'https://patentnest.ai'
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_RETRIES = 2
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503])

type FetchImplementation = typeof fetch
type SleepImplementation = (milliseconds: number) => Promise<void>

export interface PatentNestClientOptions {
  apiKey?: string
  timeoutMs?: number
  fetchImplementation?: FetchImplementation
  sleep?: SleepImplementation
}

export class PatentNestApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  readonly retryAfterSeconds?: number

  constructor(input: {
    code: string
    message: string
    status: number
    requestId?: string
    retryAfterSeconds?: number
  }) {
    super(input.message)
    this.name = 'PatentNestApiError'
    this.code = input.code
    this.status = input.status
    this.requestId = input.requestId
    this.retryAfterSeconds = input.retryAfterSeconds
  }
}

export function isPatentNestConfigured(): boolean {
  return /^pn_live_\S+$/.test(process.env.PATENTNEST_API_KEY?.trim() || '')
}

export class PatentNestClient {
  private readonly apiKey: string
  private readonly timeoutMs: number
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
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  async searchIndianPatents(
    query: string,
    limit = 20,
  ): Promise<PatentNestResponse<SearchIndianPatentsData>> {
    const normalizedQuery = typeof query === 'string' ? query.trim() : ''
    if (Array.from(normalizedQuery).length < 2 || Array.from(normalizedQuery).length > 2_000) {
      throw new PatentNestApiError({
        code: 'INVALID_QUERY',
        message: 'Search query must contain between 2 and 2,000 characters.',
        status: 400,
      })
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new PatentNestApiError({
        code: 'INVALID_LIMIT',
        message: 'Search limit must be an integer between 1 and 50.',
        status: 400,
      })
    }

    return this.request<SearchIndianPatentsData>('/api/v1/patents/search', {
      method: 'POST',
      body: JSON.stringify({ query: normalizedQuery, limit }),
    })
  }

  async getIndianPatent(publicationNumber: string): Promise<PatentNestResponse<IndianPatentRecord>> {
    const normalizedPublicationNumber = typeof publicationNumber === 'string'
      ? publicationNumber.trim()
      : ''
    if (!normalizedPublicationNumber || normalizedPublicationNumber.length > 200) {
      throw new PatentNestApiError({
        code: 'INVALID_PUBLICATION_NUMBER',
        message: 'A valid publication number is required.',
        status: 400,
      })
    }

    return this.request<IndianPatentRecord>(
      `/api/v1/patents/${encodeURIComponent(normalizedPublicationNumber)}`,
      { method: 'GET' },
    )
  }

  private async request<T>(path: string, init: RequestInit): Promise<PatentNestResponse<T>> {
    let lastError: PatentNestApiError | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const startedAt = Date.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const response = await this.fetchImplementation(`${PATENTNEST_API_BASE_URL}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          cache: 'no-store',
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
          return body
        }

        const retryAfterMilliseconds = parseRetryAfter(response.headers.get('retry-after'))
        lastError = createHttpError(response.status, requestId, retryAfterMilliseconds)
        if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt >= MAX_RETRIES) {
          throw lastError
        }

        // Drain the body without retaining or exposing it.
        await response.arrayBuffer().catch(() => undefined)
        await this.sleep(retryAfterMilliseconds ?? exponentialBackoff(attempt))
      } catch (error) {
        if (error instanceof PatentNestApiError) {
          if (!RETRYABLE_STATUS_CODES.has(error.status) || attempt >= MAX_RETRIES) throw error
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

        if (attempt >= MAX_RETRIES) throw lastError
        await this.sleep(exponentialBackoff(attempt))
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

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
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
    404: 'The requested Indian patent was not found.',
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
  })
}

export function searchIndianPatents(query: string, limit = 20) {
  return new PatentNestClient().searchIndianPatents(query, limit)
}

export function getIndianPatent(publicationNumber: string) {
  return new PatentNestClient().getIndianPatent(publicationNumber)
}
