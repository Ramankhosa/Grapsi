import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __rateLimitWindowCountForTests,
  __resetRateLimitWindowsForTests,
  buildFinderRateLimitKey,
  checkRateLimit,
} from '@/lib/recommendations/rateLimit'

describe('finder rate limiter', () => {
  beforeEach(() => {
    __resetRateLimitWindowsForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keys buckets by user only — no IP, no conversation id', () => {
    expect(buildFinderRateLimitKey('chat', 'user-1')).toBe('finder:chat:user-1')
    expect(buildFinderRateLimitKey('chat', 'user-1')).not.toContain('10.0.0.1')
  })

  it('enforces a fixed window and resets after it', () => {
    const key = buildFinderRateLimitKey('chat', 'user-1')
    expect(checkRateLimit(key, 2, 60_000).allowed).toBe(true)
    expect(checkRateLimit(key, 2, 60_000).allowed).toBe(true)
    expect(checkRateLimit(key, 2, 60_000).allowed).toBe(false)
    vi.advanceTimersByTime(60_001)
    expect(checkRateLimit(key, 2, 60_000).allowed).toBe(true)
  })

  it('evicts expired windows so the map does not grow without bound', () => {
    for (let i = 0; i < 100; i += 1) {
      checkRateLimit(`finder:chat:user-${i}`, 5, 60_000)
    }
    expect(__rateLimitWindowCountForTests()).toBe(100)
    // Past both the window and the sweep interval: the next call sweeps everything stale.
    vi.advanceTimersByTime(120_001)
    checkRateLimit('finder:chat:user-new', 5, 60_000)
    expect(__rateLimitWindowCountForTests()).toBe(1)
  })
})
