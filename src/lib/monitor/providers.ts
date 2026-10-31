import { prisma } from '@/lib/prisma'

import { emitEvent } from './events'

/**
 * Circuit breaker per provider account.
 *
 * A billing or authentication failure is an ACCOUNT problem, not a site
 * problem: the breaker opens at once, paid work waits (PAUSED_PROVIDER), one
 * deduplicated alert goes out, and no funder site is ever paused for it.
 * After `next_probe_at` the breaker is HALF_OPEN and lets one attempt through;
 * success closes it. Rate limits and transient errors only open it after a
 * run of failures, briefly.
 */

export type ProviderErrorClass = 'BILLING' | 'AUTH' | 'RATE' | 'TRANSIENT' | 'TIMEOUT' | 'CONFIG' | 'INVALID_OUTPUT'

const BILLING_PATTERN = /credit balance|insufficient[_ ]quota|billing|payment required|exceeded your current quota|account (is )?(suspended|disabled)|balance is too low|余额/i
const AUTH_PATTERN = /invalid[_ ]api[_ ]key|incorrect api key|unauthorized|authentication|permission denied|api key not valid|forbidden/i

export function classifyProviderFailure(details: Record<string, unknown> | undefined, message = ''): ProviderErrorClass {
  const status = typeof details?.providerStatus === 'number' ? details.providerStatus : undefined
  const text = `${details?.providerMessage ?? ''} ${details?.providerCode ?? ''} ${message}`
  if (status === 402 || BILLING_PATTERN.test(text)) return 'BILLING'
  if (status === 401 || status === 403 || AUTH_PATTERN.test(text)) return 'AUTH'
  if (status === 429 || /rate limit|too many requests/i.test(text)) return 'RATE'
  if (/timed? ?out|ETIMEDOUT|ECONNRESET|socket hang up|aborted/i.test(text)) return 'TIMEOUT'
  if (status !== undefined && status >= 400 && status < 500) return 'CONFIG'
  if (/INPUT_TOO_LARGE|INVALID_MODEL|Unknown model|No provider available/i.test(text)) return 'CONFIG'
  return 'TRANSIENT'
}

export type BreakerState = 'CLOSED' | 'HALF_OPEN' | 'OPEN'

const ACCOUNT_PROBE_MS = 30 * 60 * 1000
const TRANSIENT_OPEN_AFTER = 5
const TRANSIENT_OPEN_MS = 5 * 60 * 1000

export class ProviderPausedError extends Error {
  readonly retryAt: Date
  readonly providerAccount: string
  readonly reason: string
  constructor(providerAccount: string, reason: string, retryAt: Date) {
    super(`Paid work on ${providerAccount} is paused (${reason}) until ${retryAt.toISOString()}`)
    this.name = 'ProviderPausedError'
    this.providerAccount = providerAccount
    this.reason = reason
    this.retryAt = retryAt
  }
}

export async function breakerState(account: string, now = new Date()): Promise<{ state: BreakerState; retryAt?: Date; reason?: string }> {
  const row = await prisma.monitorProviderHealth.findUnique({ where: { provider_account: account } })
  if (!row || row.state === 'CLOSED') return { state: 'CLOSED' }
  if (row.next_probe_at && row.next_probe_at <= now) return { state: 'HALF_OPEN', reason: row.reason ?? undefined }
  return { state: 'OPEN', retryAt: row.next_probe_at ?? new Date(now.getTime() + ACCOUNT_PROBE_MS), reason: row.reason ?? undefined }
}

export async function recordProviderSuccess(account: string): Promise<void> {
  await prisma.monitorProviderHealth.upsert({
    where: { provider_account: account },
    create: { provider_account: account, state: 'CLOSED' },
    update: { state: 'CLOSED', reason: null, opened_at: null, next_probe_at: null, consecutive_failures: 0 },
  })
}

/** Only one request may probe an account after its cooldown. */
export async function acquireProviderProbe(account: string, now = new Date()): Promise<boolean> {
  const row = await prisma.monitorProviderHealth.findUnique({ where: { provider_account: account } })
  if (!row || row.state === 'CLOSED') return true
  if (!row.next_probe_at || row.next_probe_at > now) return false
  const changed = await prisma.monitorProviderHealth.updateMany({ where: { id: row.id, next_probe_at: row.next_probe_at }, data: { state: 'HALF_OPEN', next_probe_at: new Date(now.getTime() + 60_000) } })
  return changed.count === 1
}

export async function recordProviderFailure(
  account: string,
  errorClass: ProviderErrorClass,
  details: Record<string, unknown> | undefined,
  now = new Date()
): Promise<void> {
  const accountFailure = errorClass === 'BILLING' || errorClass === 'AUTH'
  const current = await prisma.monitorProviderHealth.findUnique({ where: { provider_account: account } })
  const failures = (current?.consecutive_failures ?? 0) + 1
  const open = accountFailure || ((errorClass === 'RATE' || errorClass === 'TRANSIENT' || errorClass === 'TIMEOUT') && failures >= TRANSIENT_OPEN_AFTER)
  const nextProbe = new Date(now.getTime() + (accountFailure ? ACCOUNT_PROBE_MS : TRANSIENT_OPEN_MS))
  const lastError = { class: errorClass, ...(details ?? {}) } as object

  await prisma.monitorProviderHealth.upsert({
    where: { provider_account: account },
    create: {
      provider_account: account,
      state: open ? 'OPEN' : 'CLOSED',
      reason: open ? errorClass : null,
      opened_at: open ? now : null,
      next_probe_at: open ? nextProbe : null,
      consecutive_failures: failures,
      last_error: lastError,
    },
    update: {
      state: open ? 'OPEN' : current?.state ?? 'CLOSED',
      reason: open ? errorClass : current?.reason ?? null,
      opened_at: open ? (current?.state === 'OPEN' ? current.opened_at : now) : current?.opened_at ?? null,
      next_probe_at: open ? nextProbe : current?.next_probe_at ?? null,
      consecutive_failures: failures,
      last_error: lastError,
    },
  })
  if (open && accountFailure) {
    await emitEvent(prisma, {
      kind: 'PROVIDER_OPEN',
      eventKey: `provider-open:${account}:${errorClass}:${now.toISOString().slice(0, 13)}`,
      payload: { provider: account, reason: errorClass === 'BILLING' ? 'a billing / credit problem' : 'an authentication problem' },
    })
  }
}
