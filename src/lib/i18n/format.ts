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

/**
 * The calendar day a stored deadline falls on, in a zone.
 *
 * Intake stores a date-only deadline ("31 December") at exactly 00:00 UTC: it
 * means that date in every zone, and reading it as an instant would move it to
 * the previous day anywhere west of UTC. Any other stored value is a real
 * instant, read in the zone. For India the two readings agree on every date
 * stored at UTC midnight (+05:30 never crosses midnight), so its deadlines are
 * unchanged by this rule.
 */
export function deadlineDayKey(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = toDate(value)
  if (!date) return dayKey(new Date(NaN), timeZone)
  const midnightUtc = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
  return midnightUtc ? date.toISOString().slice(0, 10) : dayKey(date, timeZone)
}

/** A datetime-local input value ("YYYY-MM-DDTHH:mm") for an instant, in a zone. */
export function toZonedDateTimeInput(value: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = toDate(value)
  if (!date) return ''
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE
  return new Date(date.getTime() + timeZoneOffsetMinutes(zone, date) * 60000).toISOString().slice(0, 16)
}

/** The instant a zone's local "YYYY-MM-DDTHH:mm" names (DST-safe), or null. */
export function fromZonedDateTimeInput(local: string, timeZone: string = DEFAULT_TIMEZONE): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE
  const asUtc = new Date(`${local}:00Z`)
  const first = timeZoneOffsetMinutes(zone, asUtc)
  let instant = asUtc.getTime() - first * 60000
  const second = timeZoneOffsetMinutes(zone, new Date(instant))
  if (second !== first) instant = asUtc.getTime() - second * 60000
  return new Date(instant)
}

export type MoneyTotal = { currency: string; amount: number }

/**
 * Per-currency totals from "CUR:amount" entries (SQL: array_agg of
 * COALESCE(currency, <tenant currency>) || ':' || amount). Amounts in
 * different currencies are never added together.
 */
export function sumByCurrency(entries: Array<string | null> | null | undefined, fallbackCurrency: string = DEFAULT_CURRENCY): MoneyTotal[] {
  const totals = new Map<string, number>()
  for (const entry of entries || []) {
    if (!entry) continue
    const at = entry.lastIndexOf(':')
    const amount = Number(entry.slice(at + 1))
    if (at < 0 || !Number.isFinite(amount)) continue
    const currency = normalizeCurrencyCode(entry.slice(0, at)) || normalizeCurrencyCode(fallbackCurrency) || DEFAULT_CURRENCY
    totals.set(currency, (totals.get(currency) || 0) + amount)
  }
  return Array.from(totals, ([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency))
}

export function mergeMoneyTotals(lists: Array<MoneyTotal[] | null | undefined>): MoneyTotal[] {
  return sumByCurrency(lists.flatMap((list) => (list || []).map((total) => `${total.currency}:${total.amount}`)))
}

/** The amount in one currency (0 when none). */
export function amountIn(totals: MoneyTotal[] | null | undefined, currency: string): number {
  return (totals || []).find((total) => total.currency === currency)?.amount ?? 0
}

/** "₹12,00,000 + $50,000"; null when there is nothing to show. */
export function formatMoneyTotals(totals: MoneyTotal[] | null | undefined, options: MoneyFormatOptions = {}): string | null {
  const parts = (totals || []).filter((total) => total.amount).map((total) => formatMoney(total.amount, total.currency, options)).filter(Boolean)
  return parts.length > 0 ? parts.join(' + ') : null
}

/**
 * A deadline as a calendar date for emails and notifications: a date-only
 * deadline (00:00 UTC) shows its own date, an instant the date it falls on
 * in the zone; in the given locale. Never shifts a date-only deadline to the
 * day before, whatever zone the server runs in.
 */
export function formatDeadlineDate(
  value: Date | string | number | null | undefined,
  options: DateFormatOptions & { month?: 'short' | 'long'; year?: boolean } = {}
): string | null {
  const date = toDate(value)
  if (!date) return null
  const day = deadlineDayKey(date, zoneOf(options))
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(localeOf(options), {
    timeZone: 'UTC',
    day: 'numeric',
    month: options.month || 'short',
    ...(options.year === false ? {} : { year: 'numeric' }),
  })
}
