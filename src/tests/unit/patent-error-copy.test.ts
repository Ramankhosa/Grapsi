import { describe, expect, it } from 'vitest'

import { describePatentError, formatCountdown } from '@/components/funding-intelligence/patents/patentErrorCopy'

describe('describePatentError', () => {
  it('disables search when the deployment has no key or the plan lacks the module', () => {
    const notConfigured = describePatentError({ code: 'PATENT_SEARCH_NOT_CONFIGURED', error: 'x' }, 503)
    expect(notConfigured.disablesSearch).toBe(true)
    expect(notConfigured.tone).toBe('info')
    expect(notConfigured.detail).toContain('PATENTNEST_API_KEY')

    const forbidden = describePatentError({ error: 'Upgrade to Pro' }, 403)
    expect(forbidden.disablesSearch).toBe(true)
    expect(forbidden.detail).toBe('Upgrade to Pro')
  })

  it('distinguishes a busy upstream from an exhausted daily allowance', () => {
    const busy = describePatentError({ code: 'UPSTREAM_RATE_LIMITED', error: 'x', retryAfterSeconds: 42 }, 429)
    expect(busy.title).toBe('PatentNest is busy.')
    expect(busy.retryAfterSeconds).toBe(42)

    const exhausted = describePatentError({ code: 'UPSTREAM_RATE_LIMITED', error: 'x', upstreamCode: 'DAILY_QUOTA_EXCEEDED' }, 429)
    expect(exhausted.title).toContain('allowance is used up')
    expect(exhausted.retryAfterSeconds).toBeUndefined()
  })

  it('derives the countdown from resetAt for our own limiter', () => {
    const now = Date.parse('2026-08-22T10:00:00Z')
    const limited = describePatentError({ code: 'RATE_LIMITED', error: 'x', resetAt: '2026-08-22T10:00:30Z' }, 429, now)
    expect(limited.retryAfterSeconds).toBe(30)
    expect(limited.tone).toBe('warn')
  })

  it('explains corpus rebuilds, timeouts, upstream auth, and not-found', () => {
    expect(describePatentError({ code: 'PATENTNEST_UNAVAILABLE', error: 'x', upstreamCode: 'CORPUS_NOT_READY' }, 503).detail).toContain('rebuilding')
    expect(describePatentError({ code: 'PATENTNEST_TIMEOUT', error: 'x' }, 504).title).toContain("didn't answer")
    expect(describePatentError({ code: 'PATENTNEST_UPSTREAM_AUTH', error: 'x', requestId: 'r1' }, 502)).toMatchObject({ tone: 'error', requestId: 'r1' })
    expect(describePatentError(null, 404).code).toBe('PATENT_NOT_FOUND')
    expect(describePatentError({ code: 'INVALID_REQUEST', error: 'Keep the query under 2,000 characters.' }, 400).detail).toBe('Keep the query under 2,000 characters.')
    expect(describePatentError(undefined, 500).title).toBe('Patent search failed.')
  })

  it('formats countdowns', () => {
    expect(formatCountdown(42)).toBe('0:42')
    expect(formatCountdown(125)).toBe('2:05')
    expect(formatCountdown(-3)).toBe('0:00')
  })
})
