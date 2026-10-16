/**
 * Parses free-text award amounts ("Up to 150,000 USD per year + 12% indirect
 * costs", "12.5 million DKK", "Project dependent") into numbers, an ISO-4217
 * currency, and separate time and recipient bases.
 *
 * Conservative by design: when the text has no recognisable currency, or the
 * numbers cannot be tied to one, the amounts stay null and the raw text is
 * kept for display. A wrong number is worse than no number.
 */
import { cleanInline } from './text'

export type AmountTimeBasis = 'TOTAL' | 'PER_YEAR' | 'PER_MONTH' | 'ONE_OFF' | 'UNSPECIFIED'
export type AmountRecipientBasis = 'PER_AWARD' | 'PER_PERSON' | 'PER_TEAM_MEMBER' | 'PER_INSTITUTION' | 'UNSPECIFIED'

export interface ParsedAmount {
  text: string | null
  min: number | null
  max: number | null
  currency: string | null
  timeBasis: AmountTimeBasis
  recipientBasis: AmountRecipientBasis
  approximate: boolean
  indirectCostNote: string | null
  /** Digits were present but no amount could be tied to a currency. */
  unparsed: boolean
}

/** Typos and local names seen in the sources → ISO-4217. */
const CURRENCY_TYPOS: Record<string, string> = {
  JPN: 'JPY',
  CAN: 'CAD',
  NIS: 'ILS',
  RMB: 'CNY',
  NTD: 'TWD',
  USA: 'USD',
  US$: 'USD',
}

const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/US\$/i, 'USD'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/₹/, 'INR'],
  [/\bRs\.?(?=\s*\d)/i, 'INR'],
  [/¥/, 'JPY'],
]

let isoCurrencies: Set<string> | null = null
function isIsoCurrency(code: string): boolean {
  if (!isoCurrencies) {
    try {
      const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency')
      isoCurrencies = new Set(supported && supported.length > 0 ? supported : [])
    } catch {
      isoCurrencies = new Set()
    }
    if (isoCurrencies.size === 0) {
      ;['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'ZAR', 'BRL', 'TRY', 'ILS', 'PLN', 'CZK', 'HUF', 'RON', 'AED', 'SAR', 'QAR', 'KWD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'KRW', 'TWD', 'MXN', 'ARS', 'CLP', 'COP', 'EGP', 'NGN', 'KES', 'PKR', 'BDT', 'LKR', 'ISK'].forEach((c) => isoCurrencies!.add(c))
    }
  }
  return isoCurrencies.has(code)
}

/** First ISO currency mentioned in the text, with typo correction. */
export function detectCurrency(text: string): { code: string; index: number } | null {
  const tokenPattern = /\b([A-Z]{3})\b|US\$/g
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text))) {
    const token = match[1] || match[0]
    const code = CURRENCY_TYPOS[token] || token
    if (isIsoCurrency(code)) return { code, index: match.index }
  }
  for (const [pattern, code] of CURRENCY_SYMBOLS) {
    const found = pattern.exec(text)
    if (found) return { code, index: found.index }
  }
  return null
}

const MULTIPLIERS: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  millions: 1e6,
  mio: 1e6,
  mn: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
}

interface NumberToken {
  value: number
  /** The number as written, before its unit word. */
  raw: number
  multiplier: number
  start: number
  end: number
}

function readNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = []
  const pattern = /(\d{1,3}(?:[,   ]\d{3})+|\d+)(?:\.(\d+))?(?:\s*(thousand|millions?|mio|mn|bn|billion|k|m)\b)?(\s*%)?/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match[4]) continue // a percentage is a rate, not an amount
    const integer = match[1].replace(/[,   ]/g, '')
    const value = Number(`${integer}${match[2] ? `.${match[2]}` : ''}`)
    if (!Number.isFinite(value)) continue
    const multiplier = match[3] ? MULTIPLIERS[match[3].toLowerCase()] || 1 : 1
    out.push({ value: value * multiplier, raw: value, multiplier, start: match.index, end: match.index + match[0].length })
  }
  return out
}

function timeBasisOf(lower: string): AmountTimeBasis {
  if (/\b(per|a|each)\s+(year|annum)\b|\/\s*(year|yr|annum)\b|\bannual(ly)?\b|\byearly\b|\bp\.?\s?a\.?\b/.test(lower)) return 'PER_YEAR'
  if (/\b(per|a|each)\s+month\b|\/\s*month\b|\bmonthly\b/.test(lower)) return 'PER_MONTH'
  if (/\bone[- ]?(off|time)\b|\blump[- ]?sum\b/.test(lower)) return 'ONE_OFF'
  if (/\bin total\b|\btotal\b/.test(lower)) return 'TOTAL'
  return 'UNSPECIFIED'
}

function recipientBasisOf(lower: string): AmountRecipientBasis {
  if (/\bper team member\b/.test(lower)) return 'PER_TEAM_MEMBER'
  if (/\bper (person|researcher|fellow|student|participant|individual|scholar|recipient|awardee|applicant|investigator|pi)\b|\beach (recipient|fellow|awardee)\b/.test(lower)) return 'PER_PERSON'
  if (/\bper (institution|organi[sz]ation|university|centre|center|department)\b/.test(lower)) return 'PER_INSTITUTION'
  if (/\bper (project|award|grant|proposal|consortium|team)\b/.test(lower)) return 'PER_AWARD'
  return 'UNSPECIFIED'
}

/** A bare "$" is only read as a currency when the funder's own country says which dollar. */
const DOLLAR_BY_COUNTRY: Record<string, string> = { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', TW: 'TWD' }

export function parseAmount(raw: unknown, options: { funderCountryCode?: string | null } = {}): ParsedAmount {
  const dollar = options.funderCountryCode ? DOLLAR_BY_COUNTRY[options.funderCountryCode] : undefined
  if (dollar && typeof raw === 'string' && /\$\s?\d/.test(raw) && !/\b[A-Z]{3}\b/.test(raw)) {
    return parseAmount(raw.replace(/\$\s?(\d[\d,.]*(?:\s*(?:million|billion|thousand|k|m|bn))?)/i, `$1 ${dollar}`))
  }
  const text = cleanInline(raw) || null
  const empty: ParsedAmount = {
    text,
    min: null,
    max: null,
    currency: null,
    timeBasis: 'UNSPECIFIED',
    recipientBasis: 'UNSPECIFIED',
    approximate: false,
    indirectCostNote: null,
    unparsed: false,
  }
  if (!text) return empty
  const lower = text.toLowerCase()
  const indirect = /\(([^)]*indirect[^)]*)\)|(\+\s*\d+(?:\.\d+)?\s*%\s*indirect[^,;]*)|(direct costs only|no indirect costs|including indirect costs|indirect costs included)/i.exec(text)
  const base: ParsedAmount = {
    ...empty,
    timeBasis: timeBasisOf(lower),
    recipientBasis: recipientBasisOf(lower),
    indirectCostNote: indirect ? cleanInline(indirect[1] || indirect[2] || indirect[3]) : null,
  }

  const currency = detectCurrency(text)
  const numbers = readNumbers(text)
  if (!currency) {
    return { ...base, unparsed: numbers.length > 0 }
  }

  // The amount is the number group that sits against the currency: just
  // before it ("50,000 USD", "1 - 2 million EUR") or just after ("USD 50,000").
  // Anything past a "+" or "(" belongs to a different clause (benefits,
  // indirect-cost rates) and is ignored.
  const clauseStart = Math.max(text.lastIndexOf('+', currency.index), text.lastIndexOf('(', currency.index), text.lastIndexOf(';', currency.index)) + 1
  let group = numbers.filter((n) => n.end <= currency.index && n.start >= clauseStart)
  if (group.length === 0) {
    const after = numbers.filter((n) => n.start > currency.index)
    group = after.length > 0 ? [after[0]] : []
  }
  if (group.length === 0) return { ...base, currency: currency.code, unparsed: numbers.length > 0 }
  // Keep at most the last two numbers before the currency (a range).
  group = group.slice(-2)
  const prefix = lower.slice(clauseStart, group[0].start)

  let min: number | null = null
  let max: number | null = null
  let approximate = false
  if (group.length === 2 && /[-–—]|\bto\b|\band\b/.test(lower.slice(group[0].end, group[1].start))) {
    // "1 - 2 million EUR": a small bare first number shares the second's unit.
    let low = group[0].value
    const high = group[1].value
    if (group[0].multiplier === 1 && group[1].multiplier > 1 && group[0].raw < 1000) {
      low = group[0].raw * group[1].multiplier
    }
    min = Math.min(low, high)
    max = Math.max(low, high)
  } else {
    const value = group[group.length - 1].value
    if (/\b(up to|upto|max(imum)?|not exceeding|no more than|ceiling of|capped at)\b/.test(prefix)) max = value
    else if (/\b(at least|minimum|min\.?|from|starting at|over|more than)\b/.test(prefix)) min = value
    else {
      if (/\b(around|approximately|approx\.?|about|circa|ca\.?|~)\b|~/.test(prefix)) approximate = true
      min = value
      max = value
    }
  }
  return { ...base, currency: currency.code, min, max, approximate }
}

/** Converts a parsed amount to USD estimates with the given rate (USD per unit). */
export function usdEstimates(amount: Pick<ParsedAmount, 'min' | 'max'>, usdPerUnit: number | null) {
  if (!usdPerUnit || !Number.isFinite(usdPerUnit)) return { min: null, max: null }
  const round = (v: number | null) => (v === null ? null : Math.round(v * usdPerUnit))
  return { min: round(amount.min), max: round(amount.max) }
}

/** "Up to 36 months", "2-3 years", "1 year" → months. */
export function parseDurationMonths(raw: unknown): { min: number | null; max: number | null; text: string | null } {
  const text = cleanInline(raw) || null
  if (!text || /^(n\/?a|not specified|not applicable|none)$/i.test(text)) return { min: null, max: null, text }
  const lower = text.toLowerCase()
  const unitMatch = /(month|year|week|day)/.exec(lower)
  if (!unitMatch) return { min: null, max: null, text }
  const factor = unitMatch[1] === 'year' ? 12 : unitMatch[1] === 'month' ? 1 : unitMatch[1] === 'week' ? 12 / 52 : 12 / 365
  const nums = Array.from(lower.matchAll(/(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]))
  if (nums.length === 0) return { min: null, max: null, text }
  const months = (v: number) => Math.max(1, Math.round(v * factor))
  if (nums.length >= 2 && /[-–]|\bto\b/.test(lower)) return { min: months(Math.min(nums[0], nums[1])), max: months(Math.max(nums[0], nums[1])), text }
  if (/\bup to\b|\bmax/.test(lower)) return { min: null, max: months(nums[0]), text }
  return { min: months(nums[0]), max: months(nums[0]), text }
}
