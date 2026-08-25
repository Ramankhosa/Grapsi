import type { PatentApiErrorBody } from '@/lib/patentIntelligence/types'

export type PatentErrorTone = 'info' | 'warn' | 'error'

export type PatentErrorCopy = {
  code: string
  title: string
  detail: string
  tone: PatentErrorTone
  /** Seconds until a retry is worth it (drives the countdown). */
  retryAfterSeconds?: number
  requestId?: string
  /** True when the whole feature is off for this deployment (not a transient failure). */
  disablesSearch?: boolean
}

function secondsUntil(resetAt: string | undefined, now = Date.now()): number | undefined {
  if (!resetAt) return undefined
  const target = Date.parse(resetAt)
  if (Number.isNaN(target)) return undefined
  return Math.max(1, Math.ceil((target - now) / 1000))
}

/**
 * Turns a /api/patent-intelligence error envelope into UI copy. Pure so it can
 * be unit-tested; the page decides how to render the tone.
 */
export function describePatentError(body: Partial<PatentApiErrorBody> | null | undefined, status: number, now = Date.now()): PatentErrorCopy {
  const code = body?.code || ''
  const requestId = body?.requestId
  const retryAfterSeconds = body?.retryAfterSeconds ?? secondsUntil(body?.resetAt, now)

  if (code === 'PATENT_SEARCH_NOT_CONFIGURED') {
    return {
      code, tone: 'info', disablesSearch: true, requestId,
      title: "Patent search isn't enabled for this deployment.",
      detail: 'Ask your administrator to set PATENTNEST_API_KEY on the server. Everything else in Funding Intelligence keeps working.',
    }
  }
  if (code === 'UPSTREAM_RATE_LIMITED') {
    const exhausted = body?.upstreamCode === 'DAILY_QUOTA_EXCEEDED' || body?.upstreamCode === 'MONTHLY_QUOTA_EXCEEDED'
    return exhausted
      ? {
        code, tone: 'warn', requestId,
        title: "Today's shared patent-search allowance is used up.",
        detail: 'Try again tomorrow, or ask your administrator to raise the PatentNest plan.',
      }
      : {
        code, tone: 'warn', requestId, retryAfterSeconds,
        title: 'PatentNest is busy.',
        detail: 'Too many searches reached PatentNest at once. Try again in a moment.',
      }
  }
  if (code === 'RATE_LIMITED') {
    return {
      code, tone: 'warn', requestId, retryAfterSeconds,
      title: "You're searching faster than we can keep up.",
      detail: 'Wait a few seconds and try again.',
    }
  }
  if (code === 'PATENTNEST_UNAVAILABLE') {
    return {
      code, tone: 'warn', requestId, retryAfterSeconds,
      title: 'The patent corpus is temporarily unavailable.',
      detail: body?.upstreamCode === 'CORPUS_NOT_READY'
        ? 'PatentNest is rebuilding its search index. Please retry in a minute.'
        : 'Please retry in a minute.',
    }
  }
  if (code === 'PATENTNEST_TIMEOUT') {
    return {
      code, tone: 'warn', requestId,
      title: "PatentNest didn't answer in time.",
      detail: 'Shorter queries usually return faster. Try again.',
    }
  }
  if (code === 'PATENTNEST_UPSTREAM_AUTH') {
    return {
      code, tone: 'error', requestId,
      title: 'Patent search is temporarily unavailable.',
      detail: "The server's PatentNest credential was rejected. Ask your administrator to check PATENTNEST_API_KEY.",
    }
  }
  if (code === 'PATENT_NOT_FOUND' || status === 404) {
    return {
      code: code || 'PATENT_NOT_FOUND', tone: 'info', requestId,
      title: "We couldn't find that publication number in PatentNest.",
      detail: 'Check the number, or search by topic instead.',
    }
  }
  if (code === 'INVALID_REQUEST' || status === 400) {
    return {
      code: code || 'INVALID_REQUEST', tone: 'warn', requestId,
      title: "That query can't be searched.",
      detail: body?.error || 'Use between 2 and 2,000 characters.',
    }
  }
  if (status === 401) {
    return { code: code || 'UNAUTHORIZED', tone: 'warn', title: 'Your session has expired.', detail: 'Sign in again to keep searching.' }
  }
  if (status === 403) {
    return {
      code: code || 'FORBIDDEN', tone: 'info', disablesSearch: true,
      title: "Patent search isn't included in your plan.",
      detail: body?.error || 'Ask your administrator about Funding Intelligence access.',
    }
  }
  return {
    code: code || 'INTERNAL_ERROR', tone: 'error', requestId,
    title: 'Patent search failed.',
    detail: body?.error || 'Please try again.',
  }
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
