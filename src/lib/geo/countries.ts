/**
 * The single country normaliser: free-text country names → ISO-3166 alpha-2.
 *
 * The older normaliser in src/lib/recommendations/utils.ts returns display
 * names and fails on common inputs ("United States", "Turkey", "Korea",
 * "Czechia", "Hong Kong, China"), and one unknown value rejects a whole list.
 * This one canonicalises to codes, knows the aliases the funding sources
 * actually use, and REPORTS what it cannot resolve instead of failing — an
 * unrecognised value must never silently become an exclusion.
 *
 * Pure module: no database, safe to import from tests and client code.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const isoCountries = require('i18n-iso-countries')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const isoCountriesEnglish = require('i18n-iso-countries/langs/en.json')

isoCountries.registerLocale(isoCountriesEnglish)

/** Tokens that are not countries but carry geographic meaning. */
export type GeoSpecialToken = 'ANY' | 'ONLINE' | 'EU'

/** Lower-case, accent-free, punctuation-free key used for every lookup. */
export function countryKey(input: string): string {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const NAME_TO_CODES = new Map<string, string[]>()
/** ISO alpha-2/alpha-3 codes, kept apart from names: "in", "at", "to", "and"
 * are codes too, so a code only counts when it is written as one ("US", "GBR"). */
const CODE_LOOKUP = new Map<string, string>()
const SPECIAL_TOKENS = new Map<string, GeoSpecialToken>()

function register(name: string, codes: string | string[]) {
  const key = countryKey(name)
  if (!key) return
  NAME_TO_CODES.set(key, Array.isArray(codes) ? codes : [codes])
}

const allNames: Record<string, string[] | string> = isoCountries.getNames('en', { select: 'all' })
for (const [code, names] of Object.entries(allNames)) {
  for (const name of Array.isArray(names) ? names : [names]) {
    if (!name) continue
    // "Congo" is listed for both CG and CD; the bare name means the Republic.
    if (countryKey(name) === 'congo' && code === 'CD') continue
    register(name, code)
  }
  CODE_LOOKUP.set(code.toUpperCase(), code)
  const alpha3 = isoCountries.alpha2ToAlpha3(code)
  if (alpha3) CODE_LOOKUP.set(String(alpha3).toUpperCase(), code)
}
CODE_LOOKUP.set('XK', 'XK')

// Names the sources use that i18n-iso-countries does not list (or lists
// differently). Kept explicit so a reviewer can see every judgement call.
const EXTRA_ALIASES: Array<[string, string | string[]]> = [
  ['United States', 'US'],
  ['U.S.A', 'US'],
  ['England', 'GB'],
  ['Scotland', 'GB'],
  ['Wales', 'GB'],
  ['Northern Ireland', 'GB'],
  ['Britain', 'GB'],
  ['Korea', 'KR'],
  ['Republic of Korea', 'KR'],
  ['Turkey', 'TR'],
  ['Turkiye', 'TR'],
  ['Czech Republic', 'CZ'],
  ['Slovak Republic', 'SK'],
  ['Hong Kong, China', 'HK'],
  ['Hong Kong SAR', 'HK'],
  ['Macao, China', 'MO'],
  ['Macau', 'MO'],
  ['Vatican', 'VA'],
  ['Vatican State', 'VA'],
  ['Vatican City', 'VA'],
  ['Holy See', 'VA'],
  ['Virgin Islands', 'VI'],
  ['US Virgin Islands', 'VI'],
  ['British Virgin Islands', 'VG'],
  ['Saint Martin', 'MF'],
  ['Sint Maarten', 'SX'],
  ['Micronesia', 'FM'],
  ['Laos', 'LA'],
  ['Brunei', 'BN'],
  ['Cabo Verde', 'CV'],
  ['Syria', 'SY'],
  ['Moldova', 'MD'],
  ['Swaziland', 'SZ'],
  ['Burma', 'MM'],
  ['Holland', 'NL'],
  ['Republic of Ireland', 'IE'],
  ['East Timor', 'TL'],
  ['Palestinian Territories', 'PS'],
  ['Bosnia', 'BA'],
  ['Kyrgyz Republic', 'KG'],
  ['The Gambia', 'GM'],
  ['Gambia, The', 'GM'],
  ['The Bahamas', 'BS'],
  ['Bahamas, The', 'BS'],
  ['DR Congo', 'CD'],
  ['DRC', 'CD'],
  ['Congo-Kinshasa', 'CD'],
  ['Congo-Brazzaville', 'CG'],
  ['Ivory Coast', 'CI'],
  ['Cote d Ivoire', 'CI'],
  ['Curacao', 'CW'],
  ['Saint Helena', 'SH'],
  ['Channel Islands', ['GG', 'JE']],
  ['UAE', 'AE'],
  ['Russia', 'RU'],
  ['Iran', 'IR'],
  ['Taiwan', 'TW'],
  ['Tanzania', 'TZ'],
  ['Vietnam', 'VN'],
  ['Viet Nam', 'VN'],
  ['Bolivia', 'BO'],
  ['Venezuela', 'VE'],
  ['North Macedonia', 'MK'],
  ['Macedonia', 'MK'],
  ['Kosovo', 'XK'],
]
for (const [name, codes] of EXTRA_ALIASES) register(name, codes)

for (const [name, token] of [
  ['Global', 'ANY'],
  ['Worldwide', 'ANY'],
  ['International', 'ANY'],
  ['All countries', 'ANY'],
  ['Any country', 'ANY'],
  ['Online', 'ONLINE'],
  ['Virtual', 'ONLINE'],
  ['European Union', 'EU'],
  ['EU', 'EU'],
] as Array<[string, GeoSpecialToken]>) {
  SPECIAL_TOKENS.set(countryKey(name), token)
}

export function isValidCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && (code === 'XK' || Boolean(isoCountries.isValid(code)))
}

function codeFor(value: string): string | null {
  const trimmed = String(value || '').trim()
  return /^[A-Z]{2,3}$/.test(trimmed) ? CODE_LOOKUP.get(trimmed) || null : null
}

/**
 * Codes for one country NAME; [] when it is not one. Bare ISO codes are only
 * accepted with `allowCodes` and only in capitals, so prose words that happen
 * to be codes ("in", "at", "to", "and") never turn into countries.
 */
export function countryCodesFor(name: string, options: { allowCodes?: boolean } = {}): string[] {
  const byName = NAME_TO_CODES.get(countryKey(name))
  if (byName && byName.length > 0) return byName
  if (options.allowCodes) {
    const code = codeFor(name)
    if (code) return [code]
  }
  return []
}

/** Display name for a code (the short English name). */
export function countryNameFor(code: string): string {
  if (code === 'XK') return 'Kosovo'
  return isoCountries.getName(code, 'en', { select: 'alias' }) || isoCountries.getName(code, 'en') || code
}

export type ResolvedCountryList = {
  codes: string[]
  /** Non-country tokens found in the list (Global, Online, European Union). */
  tokens: GeoSpecialToken[]
  /** Values that are neither a country nor a known token. Reported, never guessed. */
  unknown: string[]
}

export function resolveCountryList(values: unknown): ResolvedCountryList {
  const codes = new Set<string>()
  const tokens = new Set<GeoSpecialToken>()
  const unknown: string[] = []
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    const key = countryKey(value)
    const token = SPECIAL_TOKENS.get(key)
    if (token) {
      tokens.add(token)
      continue
    }
    const found = countryCodesFor(value, { allowCodes: true })
    if (found.length > 0) {
      found.forEach((code) => codes.add(code))
      continue
    }
    unknown.push(value)
  }
  return { codes: Array.from(codes).sort(), tokens: Array.from(tokens), unknown }
}

/** Every ISO-3166 alpha-2 code the library knows (plus XK). */
export function allCountryCodes(): string[] {
  return Array.from(new Set([...Object.keys(allNames), 'XK'])).sort()
}
