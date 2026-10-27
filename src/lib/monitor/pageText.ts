import AdmZip from 'adm-zip'
import * as cheerio from 'cheerio'

import { MonitorFetchError } from './errors'
import { identifyUrl } from './urlIdentity'

/**
 * Reading pages that do not give up their text easily. Everything here is
 * local parsing of bytes already fetched; none of it fetches, and none of it
 * gets around a site's access controls.
 *
 * - Script-built pages ("app shells") often carry their content as data:
 *   schema.org JSON-LD, Next.js/Nuxt state, or <script type="application/json">.
 * - Old sites put their listing in a frame or an iframe.
 * - Bot checks (Cloudflare, Akamai, Imperva, DataDome, PerimeterX, CAPTCHAs)
 *   are recognised and reported as such, never solved or evaded.
 * - Office files other than .docx (spreadsheets, slides, OpenDocument, RTF)
 *   are read from their XML or control words.
 */

const MAX_STRUCTURED_CHARS = 60_000
const MAX_JSON_NODES = 20_000

/** Keys whose values are worth keeping even when short (a deadline, an amount). */
const FACT_KEYS = /^(title|name|headline|alternativeheadline|description|summary|abstract|text|body|content|deadline|closedate|closingdate|close_date|opendate|openingdate|open_date|startdate|enddate|validfrom|validthrough|datePosted|dateposted|amount|award|funding|budget|currency|eligibility|eligible|applicant|programme|program|scheme|funder|sponsor|organization|organisation|provider|category|keywords|status|url|applicationurl|location)$/i
const NOISE_KEYS = /^(id|_id|key|hash|token|nonce|buildid|assetprefix|runtimeconfig|locale|locales|defaultlocale|gssp|scriptloader|isfallback|query|page|__typename|class|classname|style|icon|image|images|thumbnail|logo|src|srcset|width|height|color|colour|theme)$/i

const stripTags = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/** Human-readable strings from a JSON value: facts as "key: value", long prose as is. */
export function jsonToText(value: unknown, maxChars = MAX_STRUCTURED_CHARS): string {
  const lines: string[] = []
  const seen = new Set<string>()
  let nodes = 0
  let size = 0
  const push = (line: string) => {
    if (size >= maxChars || seen.has(line)) return
    seen.add(line)
    lines.push(line)
    size += line.length + 1
  }
  const walk = (node: unknown, key: string, depth: number) => {
    if (nodes++ > MAX_JSON_NODES || depth > 14 || size >= maxChars) return
    if (typeof node === 'string') {
      const text = stripTags(node)
      if (!text || NOISE_KEYS.test(key)) return
      if (/^https?:\/\//.test(text) && !/url$/i.test(key)) return
      const prose = text.length >= 30 && /\s/.test(text) && !/^[\w.-]+\.(js|css|png|jpe?g|svg|webp)$/i.test(text) && !/[{};]\s*$/.test(text)
      if (FACT_KEYS.test(key) && text.length <= 2000) push(`${key}: ${text}`)
      else if (prose) push(text)
      return
    }
    if (typeof node === 'number' && FACT_KEYS.test(key)) { push(`${key}: ${node}`); return }
    if (Array.isArray(node)) { for (const item of node) walk(item, key, depth + 1); return }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k.replace(/^@/, ''), depth + 1)
    }
  }
  walk(value, '', 0)
  return lines.join('\n')
}

/**
 * Content a page carries as data rather than as visible text: page metadata,
 * JSON-LD, framework state and JSON data islands.
 */
export function structuredText(html: string): string {
  const $ = cheerio.load(html)
  const parts: string[] = []
  const meta = (name: string) => $(`meta[property="${name}"], meta[name="${name}"]`).attr('content')?.trim()
  for (const [label, value] of [['title', meta('og:title') ?? $('title').first().text().trim()], ['description', meta('og:description') ?? meta('description')]] as const) {
    if (value) parts.push(`${label}: ${stripTags(value)}`)
  }
  $('script[type="application/ld+json"], script#__NEXT_DATA__, script[type="application/json"], script#__NUXT_DATA__').each((_, el) => {
    const raw = $(el).text().trim()
    if (!raw || raw.length > 3_000_000) return
    try {
      const text = jsonToText(JSON.parse(raw))
      if (text) parts.push(text)
    } catch {
      // not JSON; ignore
    }
  })
  return [...new Set(parts)].join('\n').slice(0, MAX_STRUCTURED_CHARS)
}

/**
 * True when a page's HTML is a script-built shell: little visible text plus a
 * framework root, a "please enable JavaScript" notice, or a pile of scripts.
 */
export function looksLikeAppShell(html: string, visibleText: string): boolean {
  if (visibleText.replace(/\s+/g, ' ').trim().length >= 400) return false
  if (/<div[^>]+id=["'](root|app|__next|__nuxt|main-app|application|svelte)["']/i.test(html)) return true
  if (/<noscript[^>]*>[\s\S]{0,400}?(enable|turn on|requires?|need)\s+(the\s+)?javascript/i.test(html)) return true
  if (/<(app-root|ng-app)\b|ng-version=|data-reactroot|__NEXT_DATA__|window\.__NUXT__|data-server-rendered/i.test(html)) return true
  return (html.match(/<script\b/gi)?.length ?? 0) >= 8
}

const CHALLENGES: Array<[RegExp, string]> = [
  [/<title>\s*(just a moment|attention required! \| cloudflare)|cf-browser-verification|\/cdn-cgi\/challenge-platform|cf_chl_opt/i, 'Cloudflare'],
  [/_Incapsula_Resource|Incapsula incident ID|Request unsuccessful\. Incapsula/i, 'Imperva'],
  [/<title>\s*Access Denied\s*<\/title>[\s\S]{0,2000}Reference #[\d.a-f]+/i, 'Akamai'],
  [/captcha-delivery\.com|datadome/i, 'DataDome'],
  [/px-captcha|perimeterx|_pxCaptcha/i, 'PerimeterX'],
  [/(checking your browser before accessing|ddos protection by|enable cookies and reload the page)/i, 'a bot check'],
  [/class=["'][^"']*(g-recaptcha|h-captcha|cf-turnstile)["']|hcaptcha\.com\/1\/api\.js|google\.com\/recaptcha\/api\.js/i, 'a CAPTCHA'],
]

/**
 * Which bot check, if any, answered instead of the page. A real page may load
 * a CAPTCHA script for its contact form, so on a 2xx answer only a short page
 * counts; on 401/403/429/503 any marker does.
 */
export function botChallenge(status: number, headers: Record<string, string | undefined>, html: string): string | null {
  if (headers['cf-mitigated'] === 'challenge') return 'Cloudflare'
  const blocking = [401, 403, 429, 503].includes(status)
  if (!blocking && cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim().length > 1500) return null
  for (const [pattern, vendor] of CHALLENGES) if (pattern.test(html)) return vendor
  return null
}

export function botChallengeError(url: string, vendor: string, status?: number): MonitorFetchError {
  let host = url
  try { host = new URL(url).hostname } catch { /* keep the url */ }
  return new MonitorFetchError('BOT_PROTECTED', `${host} answered with ${vendor} instead of the page. Source Watch does not get around bot checks: ask the funder for a feed, sitemap or API, or check this page by hand.`, { retryable: false, httpStatus: status, url })
}

/** Same-site documents a page shows inside a frame or an iframe. */
export function frameLinks(html: string, baseUrl: string, inScope: (host: string) => boolean): string[] {
  const $ = cheerio.load(html)
  const out = new Set<string>()
  $('frame[src], iframe[src]').each((_, el) => {
    const id = identifyUrl($(el).attr('src') ?? '', baseUrl)
    if (!id) return
    try {
      if (inScope(new URL(id.canonical).hostname)) out.add(id.canonical)
    } catch {
      // unparsable; skip
    }
  })
  return [...out].slice(0, 5)
}

export type OfficeKind = 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'rtf'

/** Office formats read here (.docx and PDF have their own parser). */
export function officeKindOf(contentType: string, url: string, body: Buffer): OfficeKind | null {
  const ct = contentType.toLowerCase()
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (body.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf'
  if (body.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') return null
  if (ct.includes('spreadsheetml') || path.endsWith('.xlsx')) return 'xlsx'
  if (ct.includes('presentationml') || path.endsWith('.pptx')) return 'pptx'
  if (ct.includes('opendocument.text') || path.endsWith('.odt')) return 'odt'
  if (ct.includes('opendocument.spreadsheet') || path.endsWith('.ods')) return 'ods'
  if (ct.includes('opendocument.presentation') || path.endsWith('.odp')) return 'odp'
  try {
    const names = new AdmZip(body).getEntries().map((e) => e.entryName)
    if (names.includes('xl/workbook.xml')) return 'xlsx'
    if (names.includes('ppt/presentation.xml')) return 'pptx'
  } catch {
    // not a readable zip
  }
  return null
}

const xmlText = (xml: string, tag: RegExp) => [...xml.matchAll(tag)].map((m) => m[1]).join(' ')
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')

/** Plain text of a spreadsheet, slide deck, OpenDocument or RTF file, one page per sheet or slide. */
export function officeText(body: Buffer, kind: OfficeKind, maxChars = 120_000): Array<{ page: number | null; text: string }> {
  if (kind === 'rtf') {
    const text = body.toString('latin1')
      .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
      .replace(/\{\\\*[^{}]*\}/g, '')
      .replace(/\\(par|line|row|cell)\b ?/g, '\n')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
    return [{ page: null, text: text.slice(0, maxChars) }]
  }
  const zip = new AdmZip(body)
  const read = (name: string) => zip.getEntry(name)?.getData().toString('utf8') ?? ''
  const numbered = (prefix: string) => zip.getEntries().map((e) => e.entryName).filter((n) => n.startsWith(prefix) && /\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  let pages: Array<{ page: number | null; text: string }> = []
  if (kind === 'xlsx') {
    const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml(xmlText(m[1], /<t[^>]*>([\s\S]*?)<\/t>/g)))
    pages = numbered('xl/worksheets/sheet').map((name, i) => {
      const rows = [...read(name).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
        [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map(([, attrs, inner]) => {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? xmlText(inner, /<t[^>]*>([\s\S]*?)<\/t>/g)
          return /t="s"/.test(attrs) ? shared[Number(v)] ?? '' : decodeXml(v)
        }).filter(Boolean).join(' | '))
      return { page: i + 1, text: rows.filter(Boolean).join('\n') }
    })
  } else if (kind === 'pptx') {
    pages = numbered('ppt/slides/slide').map((name, i) => ({
      page: i + 1,
      text: [...read(name).matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => decodeXml(xmlText(p[1], /<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'),
    }))
  } else {
    const xml = read('content.xml').replace(/<\/text:(p|h)>|<\/table:table-row>/g, '\n').replace(/<\/table:table-cell>/g, ' | ')
    pages = [{ page: null, text: decodeXml(xml.replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() }]
  }
  let size = 0
  return pages.filter((p) => p.text).map((p) => {
    const text = p.text.slice(0, Math.max(0, maxChars - size))
    size += text.length
    return { ...p, text }
  }).filter((p) => p.text)
}
