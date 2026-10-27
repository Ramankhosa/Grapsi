import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'

import { bulkWebsite, EMPTY_SEARCH, parseCatalogSearch, type CatalogWebsite } from '@/lib/monitor/catalogImport'
import { laneWhere } from '@/lib/monitor/discoveryExport'
import { classifyOpportunity } from '@/lib/monitor/outcomes'
import { botChallenge, frameLinks, jsonToText, looksLikeAppShell, officeKindOf, officeText, structuredText } from '@/lib/monitor/pageText'
import { decodeBody } from '@/lib/monitor/safeFetch'
import { bulkSpreadMinutes, staggeredStart } from '@/lib/monitor/schedule'

describe('reading script-built pages', () => {
  it('takes facts and prose from JSON-LD and Next.js state, not ids or asset paths', () => {
    const html = `<html><head><title>Call</title><meta name="description" content="Grants for climate research">
      <script type="application/ld+json">{"@type":"Grant","name":"Climate Fellowship 2027","description":"Two-year fellowships for early career researchers working on climate adaptation.","validThrough":"2027-03-31","amount":{"value":80000}}</script>
      <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"call":{"id":"x91","summary":"Applications are invited from universities in India and the United Kingdom.","image":"/hero.png"}}},"buildId":"abc123"}</script>
      </head><body><div id="__next"></div></body></html>`
    const text = structuredText(html)
    expect(text).toContain('name: Climate Fellowship 2027')
    expect(text).toContain('validThrough: 2027-03-31')
    expect(text).toContain('Applications are invited from universities')
    expect(text).toContain('description: Grants for climate research')
    expect(text).not.toContain('abc123')
    expect(text).not.toContain('hero.png')
    expect(jsonToText({ items: [{ title: 'A' }, { title: 'A' }] })).toBe('title: A')
  })

  it('recognises an app shell only when the page has little text', () => {
    expect(looksLikeAppShell('<div id="root"></div>', '')).toBe(true)
    expect(looksLikeAppShell('<noscript>You need to enable JavaScript to run this app.</noscript>', 'Loading')).toBe(true)
    expect(looksLikeAppShell('<div id="root"></div>', 'x'.repeat(500))).toBe(false)
    expect(looksLikeAppShell('<p>Plain page</p>', 'Plain page')).toBe(false)
  })

  it('finds same-site frames and iframes, and ignores other hosts', () => {
    const html = '<frameset><frame src="/calls/list.html"></frameset><iframe src="https://video.other.invalid/embed"></iframe>'
    expect(frameLinks(html, 'https://funder.invalid/', (h) => h === 'funder.invalid')).toEqual(['https://funder.invalid/calls/list.html'])
  })
})

describe('bot checks', () => {
  it('names the vendor on a blocked answer and never on a normal page that loads a CAPTCHA for its form', () => {
    expect(botChallenge(403, {}, '<html><head><title>Just a moment...</title></head><body></body></html>')).toBe('Cloudflare')
    expect(botChallenge(200, { 'cf-mitigated': 'challenge' }, '')).toBe('Cloudflare')
    expect(botChallenge(200, {}, '<html><body>Checking your browser before accessing funder.invalid</body></html>')).toBe('a bot check')
    const realPage = `<html><body><main>${'Research grants are open. '.repeat(100)}</main><div class="g-recaptcha"></div></body></html>`
    expect(botChallenge(200, {}, realPage)).toBeNull()
    expect(botChallenge(404, {}, '<html><body>Not found</body></html>')).toBeNull()
  })

  it('shows a bot-checked page as unreadable, with a reason a reviewer can act on', () => {
    const shown = classifyOpportunity({ review_state: 'PENDING', processing_state: 'NEEDS_EVIDENCE', triage_verdict: null, relevance_outcome: null, triage_reason: 'Detail evidence could not be read: x answered with Cloudflare instead of the page. Source Watch does not get around bot checks: ask the funder…' }, { last_validation_status: 'BOT_PROTECTED' })
    expect(shown.outcome).toBe('UNREADABLE')
    expect(shown.detail).toMatch(/bot check/)
  })
})

describe('character encodings', () => {
  const decode = (body: Buffer, contentType: string, contentKind: 'html' | 'xml' | 'text' = 'html') => decodeBody({ body, contentType, contentKind })

  it('trusts a byte-order mark first', () => {
    expect(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Förderung', 'utf16le')]), 'text/html; charset=iso-8859-1')).toBe('Förderung')
    expect(decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Ünïcode')]), 'text/html')).toBe('Ünïcode')
  })

  it('reads UTF-8 that a server mislabelled as Latin-1, and real Latin-1 as Latin-1', () => {
    expect(decode(Buffer.from('Fördermittel für Forschung'), 'text/html; charset=ISO-8859-1')).toBe('Fördermittel für Forschung')
    expect(decode(Buffer.from('Fördermittel', 'latin1'), 'text/html; charset=ISO-8859-1')).toBe('Fördermittel')
  })

  it('reads the encoding an XML document declares', () => {
    expect(decode(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><rss>Fördermittel</rss>', 'latin1'), 'application/xml', 'xml')).toContain('Fördermittel')
  })
})

describe('office files beyond .docx', () => {
  const zip = (files: Record<string, string>) => { const z = new AdmZip(); for (const [n, v] of Object.entries(files)) z.addFile(n, Buffer.from(v)); return z.toBuffer() }

  it('reads spreadsheet cells, shared strings included, one page per sheet', () => {
    const body = zip({
      'xl/workbook.xml': '<workbook/>',
      'xl/sharedStrings.xml': '<sst><si><t>Call title</t></si><si><t>Deadline</t></si><si><t>Seed grant &amp; pilot</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>46100</v></c></row></sheetData></worksheet>',
    })
    expect(officeKindOf('application/octet-stream', 'https://f.invalid/calls', body)).toBe('xlsx')
    expect(officeText(body, 'xlsx')).toEqual([{ page: 1, text: 'Call title | Deadline\nSeed grant & pilot | 46100' }])
  })

  it('reads slides in order, an OpenDocument text, and RTF', () => {
    const deck = zip({
      'ppt/presentation.xml': '<p/>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Call for</a:t></a:r><a:r><a:t> proposals</a:t></a:r></a:p><a:p><a:r><a:t>Deadline 5 May</a:t></a:r></a:p></p:sld>',
    })
    expect(officeText(deck, 'pptx')).toEqual([{ page: 1, text: 'Call for proposals\nDeadline 5 May' }, { page: 2, text: 'Second slide' }])
    const odt = zip({ 'content.xml': '<office:text><text:h>Fellowship</text:h><text:p>Applications close 1 June.</text:p></office:text>' })
    expect(officeText(odt, 'odt')[0].text).toBe('Fellowship\nApplications close 1 June.')
    const rtf = Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Research grant\\par Deadline: 30 June\\par}')
    expect(officeKindOf('application/rtf', 'https://f.invalid/a.rtf', rtf)).toBe('rtf')
    expect(officeText(rtf, 'rtf')[0].text).toContain('Research grant\nDeadline: 30 June')
  })
})

describe('bulk selection', () => {
  it('reads every filter from the query string and ignores junk', () => {
    const s = parseCatalogSearch(new URLSearchParams('q=nih&title=early%20career&dateField=OPENS&from=2026-01-01&to=nonsense&kinds=Fellowship|Seed%20Grant&areas=Medical%20%26%20Health%20Sciences&minAward=50000&sort=DEADLINE&status=BOGUS'))
    expect(s).toMatchObject({ q: 'nih', title: 'early career', dateField: 'OPENS', dateFrom: '2026-01-01', dateTo: null, kinds: ['Fellowship', 'Seed Grant'], areas: ['Medical & Health Sciences'], minAwardUsd: 50000, sort: 'DEADLINE', status: 'LIVE' })
    expect(parseCatalogSearch(new URLSearchParams(''))).toEqual(EMPTY_SEARCH)
  })

  const site = (patch: Partial<CatalogWebsite>): CatalogWebsite => ({
    host: 'f.invalid', calls: 10, liveCalls: 3, matchedCalls: 10, nextDeadline: null, latestAdded: null, documents: 0,
    funders: [{ id: 'a', name: 'A', country: 'GB', type: null, calls: 6 }, { id: 'b', name: 'B', country: 'US', type: null, calls: 4 }],
    sampleUrls: [], watched: null, suggestions: [{ url: 'https://f.invalid/calls/', covers: 8, reason: '' }], warnings: [],
    suggested: { frequencyMinutes: 4320, priority: 'NORMAL', documentHosts: ['cdn.f.invalid'] }, ...patch,
  })

  it('links every funder, keeps suggested settings unless overridden, and skips file stores and watched sites', () => {
    const setup = bulkWebsite(site({}), { frequencyMinutes: null, priority: 'HIGH', excludeKeywords: 'tender' })
    expect(setup).toMatchObject({ watchUrl: 'https://f.invalid/calls/', funderIds: ['a', 'b'], officialWebsite: false, frequencyMinutes: 4320, priority: 'HIGH', documentHosts: ['cdn.f.invalid'], excludeKeywords: 'tender' })
    expect(bulkWebsite(site({ warnings: [{ code: 'FILE_HOST', message: '' }] }), { frequencyMinutes: null, priority: null, excludeKeywords: '' })).toMatchObject({ status: 'SKIPPED' })
    expect(bulkWebsite(site({ watched: { siteId: 's', status: 'ACTIVE', watchPoints: 1 } }), { frequencyMinutes: null, priority: null, excludeKeywords: '' })).toMatchObject({ status: 'ALREADY_WATCHED' })
    expect(bulkWebsite(site({ warnings: [{ code: 'NEEDS_BROWSER', message: '' }] }), { frequencyMinutes: null, priority: null, excludeKeywords: '' })).toMatchObject({ fetchMode: 'BROWSER' })
  })

  it('starts small batches at once and spreads big ones, capped at a day', () => {
    const now = new Date('2026-10-27T00:00:00Z')
    expect(bulkSpreadMinutes(10)).toBe(0)
    expect(staggeredStart(now, 5, 10)).toBeNull()
    expect(bulkSpreadMinutes(100)).toBe(300)
    expect(staggeredStart(now, 50, 100)!.toISOString()).toBe('2026-10-27T02:30:00.000Z')
    expect(bulkSpreadMinutes(5000)).toBe(24 * 60)
  })

  it('exports exactly the lane the screen shows', () => {
    expect(laneWhere('PENDING')).toEqual({ review_state: 'PENDING' })
    expect(laneWhere('AUDIT')).toEqual({ triage_verdict: 'NOT_FUNDING' })
    expect(laneWhere('ALL')).toEqual({})
  })
})
