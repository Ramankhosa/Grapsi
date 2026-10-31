import * as cheerio from 'cheerio'
import Parser from 'rss-parser'

import { extractDateHints, type ListingItem } from './items'
import { identifyUrl, type UrlIdentityOptions } from './urlIdentity'

/**
 * Feeds and sitemaps, read as items. Sitemaps are parsed with cheerio's XML
 * mode, which never expands DTD entities, so a hostile sitemap cannot inflate
 * itself. `lastmod` is kept as a scheduling hint only — the protocol makes it
 * optional and it is not proof that content changed.
 */

const parser = new Parser({ timeout: 30_000 })

export async function extractFeedItems(xml: string, baseUrl: string, options: UrlIdentityOptions = {}): Promise<ListingItem[]> {
  const feed = await parser.parseString(xml)
  const items: ListingItem[] = []
  const seen = new Set<string>()
  for (const [index, entry] of (feed.items ?? []).slice(0, 500).entries()) {
    const identity = entry.link ? identifyUrl(entry.link, baseUrl, options) : null
    if (!identity || seen.has(identity.dedupKey)) continue
    seen.add(identity.dedupKey)
    const title = (entry.title ?? '').replace(/\s+/g, ' ').trim()
    const snippet = (entry.contentSnippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
    const date = entry.isoDate ?? entry.pubDate ?? null
    items.push({
      url: identity.canonical,
      dedupKey: identity.dedupKey,
      host: identity.host,
      anchorText: title.slice(0, 300),
      contextText: [title, snippet].filter(Boolean).join(' — ').slice(0, 400),
      heading: null,
      dateHints: [...(date ? [date] : []), ...extractDateHints(snippet)].slice(0, 6),
      position: index,
      isDocument: /\.pdf(\?|#|$)/i.test(identity.canonical),
    })
  }
  return items
}

export interface SitemapEntry {
  url: string
  dedupKey: string
  host: string
  lastmod: string | null
}

export type SitemapParse =
  | { kind: 'index'; sitemaps: string[] }
  | { kind: 'urlset'; entries: SitemapEntry[] }
  | { kind: 'unknown' }

export function parseSitemap(xml: string, baseUrl: string, options: UrlIdentityOptions = {}): SitemapParse {
  const $ = cheerio.load(xml, { xml: { xmlMode: true, decodeEntities: true } })
  const index = $('sitemapindex > sitemap > loc')
  if (index.length > 0) {
    const sitemaps = index
      .map((_, el) => $(el).text().trim())
      .get()
      .map((loc) => identifyUrl(loc, baseUrl)?.canonical)
      .filter((loc): loc is string => Boolean(loc))
    return { kind: 'index', sitemaps }
  }
  const urls = $('urlset > url')
  if (urls.length > 0) {
    const entries: SitemapEntry[] = []
    urls.each((_, el) => {
      const loc = $(el).children('loc').first().text().trim()
      const identity = identifyUrl(loc, baseUrl, options)
      if (!identity) return
      entries.push({
        url: identity.canonical,
        dedupKey: identity.dedupKey,
        host: identity.host,
        lastmod: $(el).children('lastmod').first().text().trim() || null,
      })
    })
    return { kind: 'urlset', entries }
  }
  return { kind: 'unknown' }
}

/** A readable title from a URL slug, for sitemap entries that carry no anchor text. */
export function titleFromUrl(url: string): string {
  try {
    const segment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    return segment
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}
