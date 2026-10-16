/** Small, dependency-free text helpers shared by the importer's normalisers. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
}

/** Decodes the HTML entities WordPress leaves in titles and term names. */
export function decodeEntities(input: string): string {
  return String(input ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

export function cleanText(input: unknown): string {
  return decodeEntities(String(input ?? ''))
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export function cleanInline(input: unknown): string {
  return cleanText(input).replace(/\s+/g, ' ').trim()
}

/** Accent-free lower-case key: letters and digits separated by single spaces. */
export function matchKey(input: unknown): string {
  return decodeEntities(String(input ?? ''))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const v = cleanInline(value)
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out
}

export function normalizeUrl(input: unknown): string | null {
  const raw = cleanInline(input)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol)) return null
    url.hash = ''
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const search = url.search && url.search !== '?' ? url.search : ''
    return `${host}${pathname}${search}`.toLowerCase()
  } catch {
    return null
  }
}

/** ISO date (YYYY-MM-DD) for a Date or parsable string; null when invalid. */
export function isoDate(input: unknown): string | null {
  if (!input) return null
  const value = String(input).trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/** A date-only value as a UTC-midnight Date, matching how intake stores close_date. */
export function dateOnly(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null
}
