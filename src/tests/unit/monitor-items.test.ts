import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractFeedItems, parseSitemap, titleFromUrl } from '@/lib/monitor/feeds'
import { extractDateHints, extractListing, extractScopeText } from '@/lib/monitor/items'

const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'monitor', 'gov-listing.html'), 'utf8')
const BASE = 'https://dst.example.in/callforproposals'

describe('extractListing on a government listing page', () => {
  const extraction = extractListing(FIXTURE, BASE)
  const byUrl = (fragment: string) => extraction.items.find((item) => item.url.includes(fragment))

  it('reads the call links and skips site chrome (header, nav, footer)', () => {
    const urls = extraction.items.map((item) => item.url)
    expect(urls.some((url) => url.endsWith('/about-us'))).toBe(false)
    expect(urls.some((url) => url.endsWith('/rti'))).toBe(false)
    expect(urls.some((url) => url.endsWith('/contact'))).toBe(false)
    expect(byUrl('nest-energy-storage')).toBeDefined()
  })

  it('strips tracking parameters from item URLs', () => {
    expect(byUrl('nest-energy-storage')?.url).toBe('https://dst.example.in/callforproposals/nest-energy-storage')
  })

  it('keeps an opaque anchor usable through its row context', () => {
    const pdf = byUrl('India-EU-Call-2026.pdf')
    expect(pdf?.anchorText).toBe('View details')
    expect(pdf?.contextText).toContain('India–EU joint call on climate resilience')
    expect(pdf?.isDocument).toBe(true)
  })

  it('keeps raw date strings near each link, uninterpreted', () => {
    expect(byUrl('nest-energy-storage')?.dateHints).toContain('31/12/2026')
    expect(byUrl('India-EU-Call-2026.pdf')?.dateHints).toContain('15 November, 2026')
    expect(byUrl('Women-Scientists-Scheme')?.dateHints).toContain('2026-11-30')
    expect(byUrl('advertisement/04-2026')?.dateHints).toContain('Dec 1, 2026')
  })

  it('treats paths that differ only in case as different resources', () => {
    const upper = byUrl('Women-Scientists-Scheme')
    const lower = byUrl('women-scientists-scheme')
    expect(upper && lower && upper.dedupKey !== lower.dedupKey).toBe(true)
  })

  it('keeps Devanagari anchor text intact (NFC, combining marks preserved)', () => {
    const hindi = byUrl('anusandhan-anudan')
    expect(hindi?.anchorText).toBe('अनुसंधान अनुदान हेतु प्रस्ताव आमंत्रित'.normalize('NFC'))
  })

  it('records the nearest heading', () => {
    expect(byUrl('nest-energy-storage')?.heading).toBe('Call for Proposals')
  })

  it('includes JSON-LD items the page lists', () => {
    expect(byUrl('inspire-faculty-2026')?.anchorText).toBe('INSPIRE Faculty Fellowship 2026')
  })

  it('finds the next page of the listing', () => {
    expect(extraction.nextPageUrl).toBe('https://dst.example.in/callforproposals?page=2')
  })
})

describe('extractListing with a selector', () => {
  it('reads only the selected region', () => {
    const extraction = extractListing(FIXTURE, BASE, { selector: '#calls' })
    expect(extraction.scopeMatched).toBe(true)
    expect(extraction.items.every((item) => !item.url.includes('page='))).toBe(true)
  })

  it('reports a selector that stopped matching instead of falling back to the page', () => {
    const extraction = extractListing(FIXTURE, BASE, { selector: '#calls-renamed' })
    expect(extraction.scopeMatched).toBe(false)
    expect(extraction.items).toHaveLength(0)
  })

  it('treats cookie-consent dialogs as site chrome', () => {
    const html = `<body>
      <div id="cookie-consent"><a href="/cookies">Customize cookies</a></div>
      <div role="dialog"><a href="/cookie-settings">Cookie Settings</a></div>
      <main><a href="/calls/x">Call for proposals X</a></main>
    </body>`
    expect(extractListing(html, 'https://funder.example/list').items.map((item) => item.url)).toEqual(['https://funder.example/calls/x'])
  })

  it('finds a Hindi "next" control', () => {
    const html = '<body><ul class="pagination"><li><a href="?page=3">अगला</a></li></ul><a href="/x">x item</a></body>'
    expect(extractListing(html, 'https://funder.example/list?page=2').nextPageUrl).toBe('https://funder.example/list?page=3')
  })

  it('ignores a next link to another host', () => {
    const html = '<head><link rel="next" href="https://elsewhere.example/p2"></head><body><a href="/a">a call</a></body>'
    expect(extractListing(html, 'https://funder.example/list').nextPageUrl).toBeNull()
  })
})

describe('scope text and date hints', () => {
  it('extracts scoped visible text line by line', () => {
    const text = extractScopeText(FIXTURE, '#calls')
    expect(text).toContain('Women Scientists Scheme (WOS-A) 2026-27')
    expect(text).not.toContain('Visitors')
  })

  it('finds common Indian date spellings', () => {
    expect(extractDateHints('Last date: 05.12.2026 (extended to 15th December 2026)')).toEqual(
      expect.arrayContaining(['05.12.2026', '15th December 2026'])
    )
  })
})

describe('feeds and sitemaps', () => {
  it('reads RSS items as listing items', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Calls</title>
      <item><title>Call A</title><link>https://funder.example/calls/a?utm_source=rss</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><title>Call B</title><link>https://funder.example/calls/b</link></item>
    </channel></rss>`
    const items = await extractFeedItems(xml, 'https://funder.example/feed')
    expect(items.map((item) => item.url)).toEqual(['https://funder.example/calls/a', 'https://funder.example/calls/b'])
    expect(items[0].dateHints[0]).toContain('2026-10-20')
  })

  it('parses a sitemap index and a urlset', () => {
    const index = parseSitemap(
      '<sitemapindex><sitemap><loc>https://funder.example/sitemap-1.xml</loc></sitemap><sitemap><loc>https://funder.example/sitemap-2.xml.gz</loc></sitemap></sitemapindex>',
      'https://funder.example/sitemap.xml'
    )
    expect(index).toEqual({ kind: 'index', sitemaps: ['https://funder.example/sitemap-1.xml', 'https://funder.example/sitemap-2.xml.gz'] })

    const urlset = parseSitemap(
      '<urlset><url><loc>https://funder.example/scheme/a</loc><lastmod>2026-10-01</lastmod></url><url><loc>https://funder.example/scheme/b</loc></url></urlset>',
      'https://funder.example/sitemap-1.xml'
    )
    expect(urlset.kind).toBe('urlset')
    if (urlset.kind === 'urlset') {
      expect(urlset.entries).toHaveLength(2)
      expect(urlset.entries[0].lastmod).toBe('2026-10-01')
    }
  })

  it('never expands DTD entities in a sitemap (no entity bombs)', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>
      <urlset><url><loc>https://funder.example/&lol2;</loc></url></urlset>`
    const parsed = parseSitemap(bomb, 'https://funder.example/sitemap.xml')
    if (parsed.kind === 'urlset') {
      expect(parsed.entries.every((entry) => !entry.url.includes('lollollol'))).toBe(true)
    }
  })

  it('makes a readable title from a URL slug', () => {
    expect(titleFromUrl('https://funder.example/schemes/inspire-faculty_fellowship-2026.pdf')).toBe('inspire faculty fellowship 2026')
  })
})
