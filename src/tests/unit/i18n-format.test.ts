import { describe, expect, it } from 'vitest'

import {
  dayKey,
  formatDate,
  formatMoney,
  normalizeCurrencyCode,
  timeZoneLabel,
  timeZoneOffsetMinutes,
  zonedDayStart,
} from '@/lib/i18n/format'
import { resolveTenantLocale } from '@/lib/tenant/locale'

describe('formatMoney', () => {
  it('never throws on stored currency strings Intl cannot parse', () => {
    expect(normalizeCurrencyCode('Rs')).toBe('INR')
    expect(normalizeCurrencyCode('₹')).toBe('INR')
    expect(normalizeCurrencyCode('US$')).toBe('USD')
    expect(normalizeCurrencyCode('rupees per annum')).toBeNull()
    expect(() => formatMoney(5000, 'rupees per annum')).not.toThrow()
    expect(formatMoney(5000, 'rupees per annum')).toBe('5,000 rupees per annum')
    expect(formatMoney(null, 'INR')).toBeNull()
    expect(formatMoney('abc', 'INR')).toBeNull()
  })

  it('groups in lakh only for rupees in an Indian locale', () => {
    expect(formatMoney(1234567, 'INR')).toBe('₹12,34,567')
    expect(formatMoney(1234567, 'USD')).toBe('$1,234,567')
    expect(formatMoney(1234567, 'USD', { locale: 'en-US' })).toBe('$1,234,567')
    expect(formatMoney(25_000_000, 'INR', { compact: true })).toBe('₹2.5 Cr')
    expect(formatMoney(450_000, 'Rs', { compact: true })).toBe('₹4.5 L')
  })
})

describe('time zones', () => {
  it('keeps India exactly as before (+05:30, no DST)', () => {
    const at = new Date('2026-10-16T20:00:00Z')
    expect(timeZoneOffsetMinutes('Asia/Kolkata', at)).toBe(330)
    expect(dayKey(at, 'Asia/Kolkata')).toBe('2026-10-17')
    expect(zonedDayStart('2026-10-17', 'Asia/Kolkata').toISOString()).toBe('2026-10-16T18:30:00.000Z')
    expect(timeZoneLabel('Asia/Kolkata')).toBe('India time')
  })

  it('follows a zone with daylight saving', () => {
    expect(zonedDayStart('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z')
    expect(zonedDayStart('2026-12-01', 'America/New_York').toISOString()).toBe('2026-12-01T05:00:00.000Z')
    expect(dayKey(new Date('2026-10-17T02:00:00Z'), 'America/New_York')).toBe('2026-10-16')
    expect(timeZoneLabel('America/New_York')).toBe('New York time')
  })

  it('formats dates in the tenant zone and falls back on bad settings', () => {
    expect(formatDate('2026-10-16T20:00:00Z', { timeZone: 'Asia/Kolkata' })).toBe('17 Oct 2026')
    expect(formatDate('2026-10-16T20:00:00Z', { timeZone: 'Not/AZone' })).toBe('17 Oct 2026')
  })
})

describe('tenant locale', () => {
  it('defaults every unset or invalid setting to India', () => {
    expect(resolveTenantLocale(null)).toEqual({ currency: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN', countryCode: 'IN' })
    expect(resolveTenantLocale({ default_currency: 'usd', timezone: 'America/New_York', locale: 'en-US', country_code: 'US' })).toEqual({
      currency: 'USD',
      timezone: 'America/New_York',
      locale: 'en-US',
      countryCode: 'US',
    })
    expect(resolveTenantLocale({ default_currency: 'dollars?', timezone: "x'; drop", locale: '!!', country_code: 'usa' })).toEqual({
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      countryCode: 'IN',
    })
  })
})

describe('tenant locale settings patch', () => {
  it('accepts codes and clears, refuses words and bad zones', async () => {
    const { parseTenantLocalePatch } = await import('@/lib/tenant/locale')
    expect(parseTenantLocalePatch({ currency: 'usd', timezone: 'America/New_York', locale: 'en-US', countryCode: 'us' })).toEqual({
      data: { default_currency: 'USD', timezone: 'America/New_York', locale: 'en-US', country_code: 'US' },
    })
    expect(parseTenantLocalePatch({ currency: null, timezone: null })).toEqual({ data: { default_currency: null, timezone: null } })
    expect(parseTenantLocalePatch({ currency: 'dollars' })).toHaveProperty('error')
    expect(parseTenantLocalePatch({ currency: '$' })).toHaveProperty('error')
    expect(parseTenantLocalePatch({ timezone: "x'; drop table tenants;--" })).toHaveProperty('error')
    expect(parseTenantLocalePatch({ countryCode: 'XX' })).toHaveProperty('error')
    expect(parseTenantLocalePatch({})).toEqual({ error: 'Nothing to change.' })
  })
})

describe('per-currency totals', () => {
  it('never adds amounts in different currencies, and reads a missing currency as the tenant’s', async () => {
    const { sumByCurrency, mergeMoneyTotals, amountIn, formatMoneyTotals } = await import('@/lib/i18n/format')
    const totals = sumByCurrency(['INR:500000', '?:700000', 'USD:50000', 'rs:100', null], 'INR')
    expect(totals).toEqual([
      { currency: 'INR', amount: 1200100 },
      { currency: 'USD', amount: 50000 },
    ])
    expect(amountIn(totals, 'INR')).toBe(1200100)
    expect(formatMoneyTotals(totals)).toBe('₹12,00,100 + $50,000')
    expect(mergeMoneyTotals([totals, [{ currency: 'USD', amount: 1 }]])).toContainEqual({ currency: 'USD', amount: 50001 })
    expect(formatMoneyTotals([])).toBeNull()
  })
})
