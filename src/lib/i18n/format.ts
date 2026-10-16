/**
 * Money and date formatting for any tenant: its currency, locale and time
 * zone, with today's behaviour (INR, en-IN, Asia/Kolkata) as the default.
 *
 * Never throws. Intl.NumberFormat throws a RangeError on a currency it cannot
 * parse ("Rs", "₹", "US$" are all stored somewhere), which used to take whole
 * pages down; unknown currencies fall back to plain text instead.
 *
 * Pure: safe in server code and in the browser.
 */
export const DEFAULT_CURRENCY = 'INR'
export const DEFAULT_LOCALE = 'en-IN'
export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

const CURRENCY_ALIASES: Record<string, string> = {
  RS: 'INR', 'RS.': 'INR', '₹': 'INR', RUPEE: 'INR', RUPEES: 'INR', INR: 'INR',
  $: 'USD', US$: 'USD', USD: 'USD', DOLLAR: 'USD', DOLLARS: 'USD',
  '€': 'EUR', EURO: 'EUR', EUROS: 'EUR',
  '£': 'GBP', POUND: 'GBP', POUNDS: 'GBP',
  '¥': 'JPY',
}

const validCurrencies = new Map<string, boolean>()

/** A well-formed ISO 4217 code Intl can format, from a code or a common symbol/word. */
export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().toUpperCase()
  if (!raw) return null
  const code = CURRENCY_ALIASES[raw] || raw
  if (!/^[A-Z]{3}$/.test(code)) return null
  if (!validCurrencies.has(code)) {
    try {
      new Intl.NumberFormat('en', { style: 'currency', currency: code })
      validCurrencies.set(code, true)
    } catch {
      validCurrencies.set(code, false)
    }
  }
  return validCurrencies.get(code) ? code : null
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_+\-/]{2,64}$/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function isValidLocale(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) return false
  try {
    return Intl.NumberFormat.supportedLocalesOf([value]).length > 0
  } catch {
    return false
  }
}

export interface MoneyFormatOptions {
  locale?: string | null
  /** "₹1.2 Cr" / "$4.1M" style. */
  compact?: boolean
}

/**
 * "₹12,34,567" for rupees in en-IN, "$1,234,567" for dollars. Lakh/crore
 * grouping is used only for INR shown in en-IN; another currency in an en-IN
 * tenant groups in thousands, as its funder writes it.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  options: MoneyFormatOptions = {}
): string | null {
  if (amount === null || amount === undefined || amount === '') return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return null
  const locale = isValidLocale(options.locale) ? options.locale : DEFAULT_LOCALE
  const code = normalizeCurrencyCode(currency)
  const indian = code === 'INR' && locale === 'en-IN'
  const numberLocale = code && !indian && locale === 'en-IN' ? 'en-US' : locale
  try {
    if (options.compact && indian && Math.abs(value) >= 100_000) {
      const crore = Math.abs(value) >= 10_000_000
      const scaled = value / (crore ? 10_000_000 : 100_000)
      return `₹${scaled.toFixed(Math.abs(scaled) >= 10 ? 0 : 1)} ${crore ? 'Cr' : 'L'}`
    }
    const style: Intl.NumberFormatOptions = code
      ? { style: 'currency', currency: code, maximumFractionDigits: 0 }
      : { maximumFractionDigits: 0 }
    if (options.compact && !indian) Object.assign(style, { notation: 'compact', maximumFractionDigits: 1 })
    const formatted = new Intl.NumberFormat(numberLocale, style).format(value)
    // An unparseable currency string is shown as written, never dropped.
    return code || !currency ? formatted : `${formatted} ${String(currency).trim()}`
  } catch {
    return `${code || currency || ''} ${Math.round(value)}`.trim()
  }
}

export interface DateFormatOptions {
  timeZone?: string | null
  locale?: string | null
}

function zoneOf(options: DateFormatOptions) {
  return isValidTimeZone(options.timeZone) ? options.timeZone : DEFAULT_TIMEZONE
}

function localeOf(options: DateFormatOptions) {
  return isValidLocale(options.locale) ? options.locale : DEFAULT_LOCALE
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "16 Oct 2026" in the given zone. */
export function formatDate(value: Date | string | number | null | undefined, options: DateFormatOptions = {}): string | null {
  const date = toDate(value)
  if (!date) return null
  return date.toLocaleDateString(localeOf(options), { timeZone: zoneOf(options), day: 'numeric', month: 'short', year: 'numeric' })
}

/** "16 Oct 2026, 3:05 pm" in the given zone. */
export function formatDateTime(value: Date | string | number | null | undefined, options: DateFormatOptions = {}): string | null {
  const date = toDate(value)
  if (!date) return null
  return date.toLocaleString(localeOf(options), {
    timeZone: zoneOf(options),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The calendar day (YYYY-MM-DD) an instant falls on in a zone. */
export function dayKey(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = toDate(value) || new Date(NaN)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Minutes the zone is ahead of UTC at an instant (330 for India). */
export function timeZoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** The instant a calendar day (YYYY-MM-DD) starts in a zone; DST-safe. */
export function zonedDayStart(day: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const midnightUtc = new Date(`${day}T00:00:00Z`)
  const first = timeZoneOffsetMinutes(timeZone, midnightUtc)
  let instant = midnightUtc.getTime() - first * 60000
  const second = timeZoneOffsetMinutes(timeZone, new Date(instant))
  if (second !== first) instant = midnightUtc.getTime() - second * 60000
  return new Date(instant)
}

/** "India time" for Asia/Kolkata, else "New York time". */
export function timeZoneLabel(timeZone: string = DEFAULT_TIMEZONE): string {
  if (timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta') return 'India time'
  const city = timeZone.split('/').pop() || timeZone
  return `${city.replace(/_/g, ' ')} time`
}
