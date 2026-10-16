/**
 * A tenant's currency, time zone and locale.
 *
 * Stored on tenants (default_currency, timezone, locale; country_code from
 * Release 1). NULL or an invalid stored value means today's behaviour: INR,
 * Asia/Kolkata, en-IN, India. Cached for a minute per tenant; settings writes
 * clear the entry.
 */
import prisma from '@/lib/prisma'
import { allCountryCodes } from '@/lib/geo/countries'
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  isValidLocale,
  isValidTimeZone,
  normalizeCurrencyCode,
} from '@/lib/i18n/format'

export interface TenantLocale {
  currency: string
  timezone: string
  locale: string
  countryCode: string
}

export const DEFAULT_TENANT_LOCALE: TenantLocale = {
  currency: DEFAULT_CURRENCY,
  timezone: DEFAULT_TIMEZONE,
  locale: DEFAULT_LOCALE,
  countryCode: 'IN',
}

export function resolveTenantLocale(
  row: { default_currency?: string | null; timezone?: string | null; locale?: string | null; country_code?: string | null } | null
): TenantLocale {
  if (!row) return DEFAULT_TENANT_LOCALE
  return {
    currency: normalizeCurrencyCode(row.default_currency) || DEFAULT_TENANT_LOCALE.currency,
    timezone: isValidTimeZone(row.timezone) ? row.timezone : DEFAULT_TENANT_LOCALE.timezone,
    locale: isValidLocale(row.locale) ? row.locale : DEFAULT_TENANT_LOCALE.locale,
    countryCode: row.country_code && /^[A-Z]{2}$/.test(row.country_code) ? row.country_code : DEFAULT_TENANT_LOCALE.countryCode,
  }
}

const TTL_MS = 60_000
const cache = new Map<string, { value: TenantLocale; at: number }>()

export async function getTenantLocale(tenantId: string | null | undefined): Promise<TenantLocale> {
  if (!tenantId) return DEFAULT_TENANT_LOCALE
  const hit = cache.get(tenantId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  // Settings must never take a read path down: any failure (including a
  // client without the tenant model, as in unit tests) means the default.
  let row: Parameters<typeof resolveTenantLocale>[0] = null
  try {
    row = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { default_currency: true, timezone: true, locale: true, country_code: true },
    })
  } catch {
    row = null
  }
  const value = resolveTenantLocale(row)
  cache.set(tenantId, { value, at: Date.now() })
  return value
}

/** The tenant's time zone; Asia/Kolkata when unset. */
export async function getTenantTimeZone(tenantId: string | null | undefined): Promise<string> {
  return (await getTenantLocale(tenantId)).timezone
}

export function clearTenantLocaleCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

export type TenantLocalePatch = {
  default_currency?: string | null
  timezone?: string | null
  locale?: string | null
  country_code?: string | null
}

/**
 * Validates a settings change ({ currency, timezone, locale, countryCode },
 * null clears one to its default) into tenant columns, or an error message.
 */
export function parseTenantLocalePatch(body: Record<string, unknown>): { data: TenantLocalePatch } | { error: string } {
  const data: TenantLocalePatch = {}
  if ('currency' in body) {
    // Strictly a code here: the symbol/word aliases are for reading stored
    // amounts, and "dollars" or "$" does not say which dollar.
    const typed = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : null
    const currency = body.currency === null ? null : typed && /^[A-Z]{3}$/.test(typed) ? normalizeCurrencyCode(typed) : null
    if (body.currency !== null && !currency) return { error: 'Currency must be an ISO 4217 code, such as INR, USD or EUR.' }
    data.default_currency = currency
  }
  if ('timezone' in body) {
    if (body.timezone !== null && !isValidTimeZone(body.timezone)) {
      return { error: 'Time zone must be an IANA name, such as Asia/Kolkata or America/New_York.' }
    }
    data.timezone = body.timezone as string | null
  }
  if ('locale' in body) {
    if (body.locale !== null && !isValidLocale(body.locale)) return { error: 'Locale must be a language tag, such as en-IN or en-US.' }
    data.locale = body.locale as string | null
  }
  if ('countryCode' in body) {
    const code = typeof body.countryCode === 'string' ? body.countryCode.trim().toUpperCase() : null
    if (body.countryCode !== null && (!code || !allCountryCodes().includes(code))) {
      return { error: 'Country must be an ISO 3166 code, such as IN or US.' }
    }
    data.country_code = code
  }
  if (Object.keys(data).length === 0) return { error: 'Nothing to change.' }
  return { data }
}
