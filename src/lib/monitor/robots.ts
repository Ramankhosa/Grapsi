import robotsParser from 'robots-parser'

import { prisma } from '@/lib/prisma'

import { isMonitorFetchError, type MonitorFetchErrorCode } from './errors'

/**
 * robots.txt per RFC 9309, cached per origin (scheme + host + port) and user
 * agent:
 *
 * - 2xx → parse and obey the rules;
 * - 429 → overload: a shared host cooldown and DEFER, ahead of the 4xx rule;
 * - other 4xx → "unavailable": the RFC allows any access;
 * - 5xx or unreachable → DEFER. We take the conservative branch: the last good
 *   copy (≤ 30 days old) is used if we have one, otherwise nothing is fetched
 *   until the file can be read. A transient server error is never permission.
 *
 * The robots file itself is fetched without a robots check, by the caller's
 * safe fetcher, so address and redirect rules still apply to it.
 */

export const ROBOTS_USER_AGENT_TOKEN = 'GrapsiSourceWatch'

export type RobotsState = 'RULES' | 'ALLOW_ALL' | 'DEFER'

export interface RobotsDecision {
  allowed: boolean
  /** Set when the decision is "not yet": robots unreachable or overloaded. */
  deferUntil?: Date
  /**
   * Set when robots.txt cannot be read for a reason waiting will not fix (a
   * broken TLS chain, a blocked address): the fetch reports that cause itself.
   */
  failure?: { code: MonitorFetchErrorCode; message: string }
  crawlDelayMs?: number
  reason: string
}

export interface RobotsRecord {
  state: RobotsState
  httpStatus: number | null
  body: string | null
  crawlDelayMs: number | null
  expiresAt: Date
  lastGoodAt: Date | null
  lastGoodBody: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

/** Robots fetch failures that need a person, not a retry. */
const PERMANENT_ROBOTS_FAILURES = new Set<MonitorFetchErrorCode>([
  'TLS_ERROR',
  'BLOCKED_ADDRESS',
  'BLOCKED_URL',
  'REDIRECT_OUT_OF_SCOPE',
  'REDIRECT_LIMIT',
])

export interface RobotsStore {
  get(origin: string, userAgent: string): Promise<RobotsRecord | null>
  put(origin: string, userAgent: string, record: RobotsRecord): Promise<void>
}

export interface RobotsFetchResult {
  status: number
  body: string
  retryAfter?: Date | null
}

/** Fetch `${origin}/robots.txt`; network failure rejects. */
export type RobotsFetcher = (robotsUrl: string, signal?: AbortSignal) => Promise<RobotsFetchResult>

const FRESH_MS = 24 * 60 * 60 * 1000
const DEFER_MS = 60 * 60 * 1000
const LAST_GOOD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_CRAWL_DELAY_MS = 60_000
/** RFC 9309 requires parsing at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 512 * 1024

export const databaseRobotsStore: RobotsStore = {
  async get(origin, userAgent) {
    const row = await prisma.monitorRobots.findUnique({ where: { origin_user_agent: { origin, user_agent: userAgent } } })
    if (!row) return null
    return {
      state: row.state as RobotsState,
      httpStatus: row.http_status,
      body: row.body,
      crawlDelayMs: row.crawl_delay_ms,
      expiresAt: row.expires_at,
      lastGoodAt: row.last_good_at,
      lastGoodBody: row.last_good_body,
      errorCode: row.error_code,
      errorMessage: row.error_message,
    }
  },
  async put(origin, userAgent, record) {
    const data = {
      state: record.state,
      http_status: record.httpStatus,
      body: record.body,
      crawl_delay_ms: record.crawlDelayMs,
      fetched_at: new Date(),
      expires_at: record.expiresAt,
      last_good_at: record.lastGoodAt,
      last_good_body: record.lastGoodBody,
      error_code: record.errorCode ?? null,
      error_message: record.errorMessage ?? null,
    }
    await prisma.monitorRobots.upsert({
      where: { origin_user_agent: { origin, user_agent: userAgent } },
      create: { origin, user_agent: userAgent, ...data },
      update: data,
    })
  },
}

function rulesDecision(origin: string, body: string, url: string, userAgent: string, source: string): RobotsDecision {
  const parser = robotsParser(`${origin}/robots.txt`, body)
  const allowed = parser.isAllowed(url, userAgent) !== false
  const delaySeconds = parser.getCrawlDelay(userAgent)
  const crawlDelayMs =
    typeof delaySeconds === 'number' && delaySeconds > 0 ? Math.min(delaySeconds * 1000, MAX_CRAWL_DELAY_MS) : undefined
  return {
    allowed,
    crawlDelayMs,
    reason: allowed ? `allowed by ${source}` : `disallowed by ${source}`,
  }
}

export interface RobotsPolicy {
  check(url: URL, signal?: AbortSignal): Promise<RobotsDecision>
}

export function createRobotsPolicy(deps: {
  fetchRobots: RobotsFetcher
  store?: RobotsStore
  userAgent?: string
  now?: () => number
}): RobotsPolicy {
  const store = deps.store ?? databaseRobotsStore
  const userAgent = deps.userAgent ?? ROBOTS_USER_AGENT_TOKEN
  const now = deps.now ?? Date.now
  const memo = new Map<string, { record: RobotsRecord; at: number }>()
  const MEMO_MS = 10 * 60 * 1000

  function decide(origin: string, record: RobotsRecord, url: string): RobotsDecision {
    if (record.state === 'ALLOW_ALL') return { allowed: true, reason: `robots.txt unavailable (${record.httpStatus ?? 'n/a'})` }
    if (record.state === 'RULES' && record.body !== null) return rulesDecision(origin, record.body, url, userAgent, 'robots.txt')
    // DEFER: fall back to the last good copy if it is recent enough.
    if (record.lastGoodBody !== null && record.lastGoodAt && now() - record.lastGoodAt.getTime() <= LAST_GOOD_MAX_AGE_MS) {
      return rulesDecision(origin, record.lastGoodBody, url, userAgent, 'the last good robots.txt')
    }
    if (record.errorCode && PERMANENT_ROBOTS_FAILURES.has(record.errorCode as MonitorFetchErrorCode)) {
      return {
        allowed: false,
        failure: { code: record.errorCode as MonitorFetchErrorCode, message: record.errorMessage ?? record.errorCode },
        reason: `robots.txt cannot be read: ${record.errorMessage ?? record.errorCode}`,
      }
    }
    return { allowed: false, deferUntil: record.expiresAt, reason: 'robots.txt unreachable; deferring' }
  }

  async function refresh(origin: string, previous: RobotsRecord | null, signal?: AbortSignal): Promise<RobotsRecord> {
    const t = now()
    let result: RobotsFetchResult | null = null
    let errorCode: string | null = null
    let errorMessage: string | null = null
    try {
      result = await deps.fetchRobots(`${origin}/robots.txt`, signal)
    } catch (error) {
      result = null
      if (isMonitorFetchError(error)) {
        errorCode = error.code
        errorMessage = error.message.slice(0, 500)
      }
    }

    if (result && result.status >= 200 && result.status < 300) {
      const body = result.body.slice(0, ROBOTS_MAX_BYTES)
      const parser = robotsParser(`${origin}/robots.txt`, body)
      const delay = parser.getCrawlDelay(userAgent)
      return {
        state: 'RULES',
        httpStatus: result.status,
        body,
        crawlDelayMs: typeof delay === 'number' && delay > 0 ? Math.min(delay * 1000, MAX_CRAWL_DELAY_MS) : null,
        expiresAt: new Date(t + FRESH_MS),
        lastGoodAt: new Date(t),
        lastGoodBody: body,
      }
    }
    // 429 is overload, not "unavailable": it must win over the 4xx branch.
    if (result && result.status === 429) {
      const until = result.retryAfter && result.retryAfter.getTime() > t ? result.retryAfter : new Date(t + DEFER_MS)
      return {
        state: 'DEFER',
        httpStatus: 429,
        body: null,
        crawlDelayMs: null,
        expiresAt: until,
        lastGoodAt: previous?.lastGoodAt ?? null,
        lastGoodBody: previous?.lastGoodBody ?? null,
      }
    }
    if (result && result.status >= 400 && result.status < 500) {
      return {
        state: 'ALLOW_ALL',
        httpStatus: result.status,
        body: null,
        crawlDelayMs: null,
        expiresAt: new Date(t + FRESH_MS),
        lastGoodAt: previous?.lastGoodAt ?? null,
        lastGoodBody: previous?.lastGoodBody ?? null,
      }
    }
    // 5xx, 3xx left over after redirects, or no response at all.
    return {
      state: 'DEFER',
      httpStatus: result?.status ?? null,
      body: null,
      crawlDelayMs: null,
      expiresAt: new Date(t + DEFER_MS),
      lastGoodAt: previous?.lastGoodAt ?? null,
      lastGoodBody: previous?.lastGoodBody ?? null,
      errorCode,
      errorMessage,
    }
  }

  return {
    async check(url, signal) {
      const origin = `${url.protocol}//${url.host}`
      const memoKey = `${origin}|${userAgent}`
      const t = now()

      let record: RobotsRecord | null = null
      const memoised = memo.get(memoKey)
      if (memoised && t - memoised.at < MEMO_MS && memoised.record.expiresAt.getTime() > t) {
        record = memoised.record
      } else {
        const stored = await store.get(origin, userAgent)
        if (stored && stored.expiresAt.getTime() > t) {
          record = stored
        } else {
          record = await refresh(origin, stored, signal)
          await store.put(origin, userAgent, record)
        }
        memo.set(memoKey, { record, at: t })
      }
      return decide(origin, record, url.href)
    },
  }
}
