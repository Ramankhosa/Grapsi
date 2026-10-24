import * as cheerio from 'cheerio'
import type { AnyNode, Element } from 'domhandler'

import { identifyUrl, sameSiteHost, type UrlIdentityOptions } from './urlIdentity'

/**
 * What a listing page says, as items: each link with its anchor text, the text
 * around it (table row, list item, card), the nearest heading, and any date
 * strings nearby — raw, uninterpreted. Deciding what an item MEANS is a later
 * stage; this one only records what is on the page.
 */

export interface ListingItem {
  url: string
  dedupKey: string
  host: string
  anchorText: string
  contextText: string
  heading: string | null
  dateHints: string[]
  position: number
  isDocument: boolean
}

export interface ListingExtraction {
  items: ListingItem[]
  /** Next page of this listing, when the page links one in scope. */
  nextPageUrl: string | null
  /** False when a selector was set but matched nothing (caller must not trust the scope). */
  scopeMatched: boolean
  linkCount: number
}

const MAX_CONTEXT_CHARS = 400
const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|odt|rtf|zip)(\?|#|$)/i

/**
 * Date-like strings. Kept raw — "05/06/2026" is ambiguous and interpreting it
 * is a deliberate later step, not something to guess here.
 */
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*[\s,.-]+\d{4}\b/gi,
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi,
]

export function extractDateHints(text: string): string[] {
  const found = new Set<string>()
  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[0].trim())
  }
  return [...found].slice(0, 6)
}

function clean(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function contextContainer($: cheerio.CheerioAPI, el: Element): cheerio.Cheerio<AnyNode> {
  const closest = $(el).closest('tr, li, dt, dd, article, .card, .views-row, .item, p')
  return closest.length > 0 ? closest.first() : $(el).parent()
}

function nearestHeading($: cheerio.CheerioAPI, el: Element): string | null {
  let node: cheerio.Cheerio<AnyNode> = $(el)
  for (let depth = 0; depth < 8 && node.length > 0; depth += 1) {
    const heading = node.prevAll('h1, h2, h3, h4, h5, h6').first()
    if (heading.length > 0) return clean(heading.text()).slice(0, 200) || null
    node = node.parent()
  }
  return null
}

export interface ExtractOptions extends UrlIdentityOptions {
  selector?: string | null
  /** Hosts a "next page" link may point to (default: the page's own host). */
  inScope?: (host: string) => boolean
  maxItems?: number
}

const PAGINATION_CONTAINERS = '.pagination, .pager, nav[aria-label*="agination" i], ul.page-numbers'
const NEXT_OR_PREV_TEXT =
  /^(next|next page|next »|next ›|›|»|>|>>|previous|prev|« previous|‹|«|<|<<|first|last|आगे|अगला|अगला पृष्ठ|पिछला)$/i

/** Pagination controls are navigation, not things a site published. */
function isPaginationAnchor($: cheerio.CheerioAPI, el: Element, label: string, href: string): boolean {
  if (/\b(next|prev|previous)\b/i.test($(el).attr('rel') ?? '')) return true
  if ($(el).closest(PAGINATION_CONTAINERS).length > 0) return true
  if (NEXT_OR_PREV_TEXT.test(label)) return true
  return /^\d{1,3}$/.test(label) && /[?&](page|p|pg|start|offset)=|\/page\/\d+/i.test(href)
}

/** Pagination links: rel=next, or a "Next" control, or the page number after the current one. */
function findNextPage($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>, baseUrl: string, inScope: (host: string) => boolean): string | null {
  const candidates: string[] = []
  const relNext = $('link[rel="next"]').attr('href') ?? $('a[rel~="next"]').first().attr('href')
  if (relNext) candidates.push(relNext)

  const NEXT_TEXT = /^(next|next page|next »|next ›|›|»|>|>>|आगे|अगला|अगला पृष्ठ)$/i
  scope
    .add($('.pagination, .pager, nav[aria-label*="agination" i], ul.page-numbers'))
    .find('a[href]')
    .each((_, el) => {
      const label = clean($(el).text() || $(el).attr('aria-label') || $(el).attr('title') || '')
      if (NEXT_TEXT.test(label)) candidates.push($(el).attr('href') ?? '')
    })

  for (const href of candidates) {
    const identity = identifyUrl(href, baseUrl)
    if (!identity) continue
    if (identity.canonical === identifyUrl(baseUrl)?.canonical) continue
    if (inScope(identity.host)) return identity.canonical
  }
  return null
}

function jsonLdItems($: cheerio.CheerioAPI, baseUrl: string, options: UrlIdentityOptions): Array<{ url: string; name: string; date: string | null }> {
  const out: Array<{ url: string; name: string; date: string | null }> = []
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 6 || out.length >= 200) return
    if (Array.isArray(node)) return node.forEach((child) => visit(child, depth + 1))
    if (typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url : null
    const name = typeof record.name === 'string' ? record.name : typeof record.headline === 'string' ? record.headline : null
    if (url && name && identifyUrl(url, baseUrl, options)) {
      const date = [record.datePublished, record.startDate, record.endDate, record.validThrough].find((v) => typeof v === 'string')
      out.push({ url, name, date: (date as string | undefined) ?? null })
    }
    for (const value of Object.values(record)) if (value && typeof value === 'object') visit(value, depth + 1)
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()), 0)
    } catch {
      // Malformed JSON-LD is common and never fatal.
    }
  })
  return out
}

export function extractListing(html: string, baseUrl: string, options: ExtractOptions = {}): ListingExtraction {
  const $ = cheerio.load(html)
  $('script:not([type="application/ld+json"]), style, noscript, template, svg').remove()

  const baseHost = identifyUrl(baseUrl)?.host ?? ''
  const inScope = options.inScope ?? ((host: string) => sameSiteHost(host, baseHost))
  const selector = options.selector?.trim()

  let scope: cheerio.Cheerio<AnyNode>
  let scopeMatched = true
  if (selector) {
    try {
      scope = $(selector)
    } catch {
      scope = $('__no_match__')
    }
    if (scope.length === 0) scopeMatched = false
  } else {
    scope = $('body')
  }

  const items: ListingItem[] = []
  const seen = new Set<string>()
  const maxItems = options.maxItems ?? 1000
  let linkCount = 0

  if (scopeMatched) {
    // Site chrome repeats on every page; only a selector that targets it on
    // purpose may read links from it.
    // Cookie-consent dialogs count as chrome too: they sit on every page.
    const chrome = selector
      ? null
      : 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="dialog"], [aria-modal="true"], [id*="cookie" i], [class*="cookie" i]'
    scope.find('a[href]').each((index, el) => {
      if (items.length >= maxItems) return false
      if (chrome && $(el).closest(chrome).length > 0) return
      const href = $(el).attr('href') ?? ''
      const identity = identifyUrl(href, baseUrl, options)
      if (!identity) return
      const anchorText = clean($(el).text() || $(el).attr('title') || $(el).attr('aria-label') || '')
      if (isPaginationAnchor($, el, anchorText, href)) return
      linkCount += 1
      if (seen.has(identity.dedupKey)) return
      seen.add(identity.dedupKey)

      const container = contextContainer($, el)
      const contextText = clean(container.text()).slice(0, MAX_CONTEXT_CHARS)
      items.push({
        url: identity.canonical,
        dedupKey: identity.dedupKey,
        host: identity.host,
        anchorText: anchorText.slice(0, 300),
        contextText,
        heading: nearestHeading($, el),
        dateHints: extractDateHints(`${anchorText} ${contextText}`),
        position: index,
        isDocument: DOCUMENT_EXTENSIONS.test(identity.canonical),
      })
      return undefined
    })

    for (const entry of jsonLdItems($, baseUrl, options)) {
      if (items.length >= maxItems) break
      const identity = identifyUrl(entry.url, baseUrl, options)
      if (!identity || seen.has(identity.dedupKey)) continue
      seen.add(identity.dedupKey)
      items.push({
        url: identity.canonical,
        dedupKey: identity.dedupKey,
        host: identity.host,
        anchorText: clean(entry.name).slice(0, 300),
        contextText: clean(entry.name).slice(0, MAX_CONTEXT_CHARS),
        heading: null,
        dateHints: entry.date ? [entry.date] : [],
        position: items.length,
        isDocument: DOCUMENT_EXTENSIONS.test(identity.canonical),
      })
    }
  }

  return {
    items,
    nextPageUrl: scopeMatched ? findNextPage($, scope, baseUrl, inScope) : null,
    scopeMatched,
    linkCount,
  }
}

/** A page's visible text within the scope (for the listing version record). */
export function extractScopeText(html: string, selector?: string | null): string {
  const withBreaks = html.replace(/<\/(p|div|li|h[1-6]|tr|th|td|section|article|dt|dd|blockquote)>/gi, '</$1>\n')
  const $ = cheerio.load(withBreaks)
  $('script, style, noscript, template, svg').remove()
  let scope = selector?.trim() ? $(selector.trim()) : $('body')
  if (scope.length === 0) scope = $('body')
  return scope
    .map((_, el) => $(el).text())
    .get()
    .join('\n')
    .split('\n')
    .map((line) => clean(line))
    .filter(Boolean)
    .join('\n')
}
