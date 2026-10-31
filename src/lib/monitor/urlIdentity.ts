/**
 * URL identity for Source Watch.
 *
 * Four forms, kept apart on purpose:
 * - raw: exactly what the page linked to;
 * - final: where the fetch actually landed (set by the fetcher, not here);
 * - canonical: a fetchable URL with only provably-meaningless parts removed;
 * - dedup key: the comparison key that says "same resource".
 *
 * Only the scheme and host are case-insensitive, so only they are lowercased:
 * `/Call/A.pdf` and `/call/a.pdf` can be different files, and query values can
 * name different opportunities. Tracking parameters are removed by an explicit
 * list, never by guessing. http↔https and www↔apex are NOT merged here — that
 * needs redirect evidence, recorded as an alias.
 */

/** Parameters that only ever carry campaign/click attribution. */
const TRACKING_PARAMS = new Set([
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'srsltid',
])
const TRACKING_PREFIXES = ['utm_']

/** Session identifiers that change per visitor, stripped on every site. */
export const DEFAULT_SESSION_PARAMS = ['jsessionid', 'phpsessid', 'aspsessionid', 'cfid', 'cftoken']

export interface UrlIdentityOptions {
  /** Regex sources; a fragment matching one is part of the identity (SPA routes). */
  fragmentRules?: string[]
  /** Extra per-site session parameters to strip. */
  sessionParams?: string[]
}

export interface UrlIdentity {
  raw: string
  canonical: string
  dedupKey: string
  host: string
}

function isDroppedParam(name: string, sessionParams: Set<string>): boolean {
  const lower = name.toLowerCase()
  if (TRACKING_PARAMS.has(lower) || sessionParams.has(lower)) return true
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

function decodeParamName(piece: string): string {
  const name = piece.split('=')[0]
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '))
  } catch {
    return name
  }
}

function keptFragment(hash: string, rules: string[]): string {
  if (!hash || hash === '#') return ''
  const fragment = hash.slice(1)
  for (const source of rules) {
    try {
      if (new RegExp(source).test(fragment)) return hash
    } catch {
      // An invalid stored rule keeps nothing rather than everything.
    }
  }
  return ''
}

function upperPercentEscapes(value: string): string {
  return value.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase())
}

/**
 * Identify a URL (resolved against `base` when relative). Returns null for
 * anything that is not an http(s) URL — mailto:, javascript:, tel:, data:.
 */
export function identifyUrl(raw: string, base?: string, options: UrlIdentityOptions = {}): UrlIdentity | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const sessionParams = new Set(
    [...DEFAULT_SESSION_PARAMS, ...(options.sessionParams ?? [])].map((name) => name.toLowerCase())
  )

  // Path-style session ids (";jsessionid=…") never identify a resource.
  const pathname = url.pathname.replace(/;(jsessionid|phpsessid)=[^/?#]*/gi, '')

  // Work on raw query pieces so kept values are byte-for-byte what the page
  // linked to; URLSearchParams would re-encode them.
  const pieces = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter((piece) => piece.length > 0)
    .filter((piece) => !isDroppedParam(decodeParamName(piece), sessionParams))
  const search = pieces.length > 0 ? `?${pieces.join('&')}` : ''
  const hash = keptFragment(url.hash, options.fragmentRules ?? [])

  // URL already lowercases the scheme and hostname and drops a default port.
  const origin = `${url.protocol}//${url.host}`
  const canonical = `${origin}${pathname}${search}${hash}`

  const keyPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname || '/'
  const keySearch = pieces.length > 0 ? `?${[...pieces].sort().join('&')}` : ''
  const dedupKey = upperPercentEscapes(`${origin}${keyPath}${keySearch}${hash}`)

  return { raw: trimmed, canonical, dedupKey, host: url.hostname }
}

/** Identity for a text block that has no link of its own. Never a URL fragment. */
export function textBlockKey(sourceId: string, anchorHash: string): string {
  return `text:${sourceId}:${anchorHash}`
}

/** Host of a URL, lowercased, or null when unparsable. */
export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** `www.example.org` and `example.org` count as one host for crawl scope. */
export function sameSiteHost(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, '')
  return strip(a) === strip(b)
}
