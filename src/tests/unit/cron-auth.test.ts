import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isCronRequest } from '@/lib/funding/cronAuth'

// Five scheduled endpoints share this one check. The load-bearing rule is that
// an unset secret can never open a route — otherwise a box with no scheduler
// configured would expose the sweeps to anonymous callers.

const SECRET = 'test-cron-secret-value'

function requestWith(header: string | null) {
  return {
    headers: {
      get: (name: string) =>
        name === 'x-funding-alert-secret' ? header : null,
    },
  } as unknown as Parameters<typeof isCronRequest>[0]
}

describe('isCronRequest', () => {
  const original = process.env.FUNDING_ALERT_CRON_SECRET

  beforeEach(() => {
    process.env.FUNDING_ALERT_CRON_SECRET = SECRET
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FUNDING_ALERT_CRON_SECRET
    } else {
      process.env.FUNDING_ALERT_CRON_SECRET = original
    }
  })

  it('accepts a request carrying the configured secret', () => {
    expect(isCronRequest(requestWith(SECRET))).toBe(true)
  })

  it('rejects a wrong secret', () => {
    expect(isCronRequest(requestWith('not-the-secret'))).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isCronRequest(requestWith(null))).toBe(false)
  })

  it('rejects an empty header even though the secret is set', () => {
    expect(isCronRequest(requestWith(''))).toBe(false)
  })

  it('fails closed when no secret is configured, even for an empty header', () => {
    delete process.env.FUNDING_ALERT_CRON_SECRET
    expect(isCronRequest(requestWith(''))).toBe(false)
    expect(isCronRequest(requestWith(SECRET))).toBe(false)
    expect(isCronRequest(requestWith(null))).toBe(false)
  })
})
