import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { convert } from 'html-to-text'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'
import { PublicProjectSourceBlockedError } from '@/lib/publicProjects/types'

const BIRAC_BASE_URL = 'https://birac.nic.in'
const SUPPORTED_PROJECTS_PATH = '/birac_supported_projects.php'
const DEFAULT_USER_AGENT =
  'GrapsiPublicProjectCrawler/1.0 (+https://grapsi.ai; public awarded-project indexing; contact: support@grapsi.ai)'
const DEFAULT_REQUEST_SPACING_MS = 1000

type BiracSchemeLink = {
  schemeId: string
  schemeName: string
  url: string
  isPdf?: boolean
}

type BiracListingPayload = JsonRecord & {
  sourceRowNumber: number
  schemeId: string
  schemeName: string
  schemeUrl: string
  serialNumber?: string | null
  applicantName?: string | null
  proposalTitle?: string | null
  city?: string | null
  state?: string | null
  rawCells: Array<string | null>
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text || text === '-' || /^null$/i.test(text)) return null
  return text
}

function stripTags(html: string) {
  return cleanText(
    convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    })
  )
}

function absoluteUrl(url: string) {
  return new URL(url.replace(/^\.\//, '/'), BIRAC_BASE_URL).toString()
}

function responseBodyText(response: AxiosResponse<unknown>) {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {})
}

function buildSourceRecordKey(row: BiracListingPayload) {
  const stable = [
    row.schemeId,
    row.serialNumber,
    row.applicantName,
    row.proposalTitle,
    row.city,
    row.state,
  ]
    .map((part) => cleanText(part)?.toLowerCase() || '')
    .join('|')
  return `BIRAC:${row.schemeId}:${Buffer.from(stable).toString('base64url').slice(0, 36)}`
}

function parseSchemeLinks(html: string): BiracSchemeLink[] {
  const links: BiracSchemeLink[] = []
  const seen = new Set<string>()
  const regex = /<a[^>]+href=['"]([^'"]+)['"][^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html))) {
    const href = match[1]
    const text = stripTags(match[2]) || ''
    if (!/Projects supported under/i.test(text)) continue

    const schemeName =
      cleanText(text.match(/under\s+(.+)$/i)?.[1]?.replace(/^[-\s]*/, '')) ||
      cleanText(text.replace(/Click here to view Projects supported under/i, '')) ||
      href
    const schemeId = cleanText(href.match(/scheme=(\d+)/i)?.[1]) || schemeName.replace(/[^A-Za-z0-9]+/g, '_')
    const key = `${schemeId}:${href}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({
      schemeId,
      schemeName,
      url: absoluteUrl(href),
      isPdf: /\.pdf(?:$|\?)/i.test(href),
    })
  }
  return links
}

function parseProjectRows(html: string, scheme: BiracSchemeLink): BiracListingPayload[] {
  const rows: BiracListingPayload[] = []
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(html))) {
    const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) => stripTags(cell[1]))
    if (cells.length < 5) continue
    const [serialNumber, applicantName, proposalTitle, city, state] = cells
    if (!cleanText(serialNumber) || /^s\.?\s*no/i.test(serialNumber || '')) continue
    if (!cleanText(proposalTitle)) continue
    rows.push({
      sourceRowNumber: rows.length + 1,
      schemeId: scheme.schemeId,
      schemeName: scheme.schemeName,
      schemeUrl: scheme.url,
      serialNumber,
      applicantName,
      proposalTitle,
      city,
      state,
      rawCells: cells,
    })
  }
  return rows
}

export class BiracPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'BIRAC' as const
  baseUrl = BIRAC_BASE_URL

  private readonly client: AxiosInstance
  private readonly cookies = new Map<string, string>()
  private lastRequestAt = 0
  private schemeLinksCache: BiracSchemeLink[] | null = null

  constructor(
    private readonly options: {
      userAgent?: string
      requestSpacingMs?: number
      timeoutMs?: number
    } = {}
  ) {
    this.client = axios.create({
      baseURL: BIRAC_BASE_URL,
      timeout: options.timeoutMs || 30000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
  }

  async listStates(): Promise<string[]> {
    return []
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    let emitted = 0
    const schemes = await this.discoverSchemes()

    for (const scheme of schemes) {
      if (emitted >= maxRecords) return
      if (scheme.isPdf) {
        continue
      }

      const html = await this.fetchHtml(scheme.url)
      const rows = parseProjectRows(html, scheme)
      for (const row of rows) {
        if (emitted >= maxRecords) return
        const sourceRecordKey = buildSourceRecordKey(row)
        emitted += 1
        yield {
          sourceKey: 'BIRAC',
          externalId: `${row.schemeId}:${row.serialNumber || row.sourceRowNumber}`,
          sourceVariant: 'birac_supported_project',
          sourceRecordKey,
          state: row.state || null,
          detailUrl: row.schemeUrl,
          listingPayload: row,
        }
      }
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const row = record.listingPayload as BiracListingPayload
    const title = cleanText(row.proposalTitle) || record.externalId
    const applicantName = cleanText(row.applicantName)

    return {
      sourceKey: 'BIRAC',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: `${BIRAC_BASE_URL}${SUPPORTED_PROJECTS_PATH}`,
      detailUrl: row.schemeUrl,
      projectType: 'birac_supported_project',
      programName: 'BIRAC Supported Projects',
      schemeName: row.schemeName,
      schemeHierarchy: {
        source: 'BIRAC',
        schemeId: row.schemeId,
        scheme: row.schemeName,
      },
      category: row.schemeName,
      title,
      abstractText: 'NA',
      primaryInvestigatorName: applicantName,
      primaryInstitutionName: applicantName,
      city: cleanText(row.city),
      state: cleanText(row.state),
      country: 'India',
      rawPayload: {
        row,
      },
      extendedFields: {
        schemeId: row.schemeId,
        schemeName: row.schemeName,
        serialNumber: row.serialNumber,
        applicantName,
        proposalTitle: title,
        city: row.city,
        state: row.state,
        note: 'BIRAC source exposes table rows only; abstract is set to NA and embeddings use title only.',
      },
      participants: applicantName
        ? [
            {
              role: 'PI',
              name: applicantName,
              institutionName: applicantName,
              city: cleanText(row.city),
              state: cleanText(row.state),
              country: 'India',
              sourcePayload: row,
            },
          ]
        : [],
      contacts: [],
    }
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    const row = record.listingPayload as BiracListingPayload

    return {
      sourceKey: 'BIRAC',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: `${BIRAC_BASE_URL}${SUPPORTED_PROJECTS_PATH}`,
      detailUrl: row.schemeUrl,
      fetchedAt: new Date().toISOString(),
      listingPayload: row,
      detailPayload: null,
      rawPayload: {
        row,
      },
    }
  }

  private async discoverSchemes() {
    if (this.schemeLinksCache) return this.schemeLinksCache
    const html = await this.fetchHtml(`${BIRAC_BASE_URL}${SUPPORTED_PROJECTS_PATH}`)
    this.schemeLinksCache = parseSchemeLinks(html)
    if (this.schemeLinksCache.length === 0) {
      throw new Error('BIRAC supported projects page returned no scheme links')
    }
    return this.schemeLinksCache
  }

  private mergeCookies(response: AxiosResponse<unknown>) {
    const setCookie = response.headers['set-cookie']
    const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    values.forEach((cookie) => {
      const [pair] = cookie.split(';')
      const index = pair.indexOf('=')
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    })
  }

  private cookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
  }

  private async waitForRequestSlot() {
    const spacing = this.options.requestSpacingMs ?? DEFAULT_REQUEST_SPACING_MS
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < spacing) await sleep(spacing - elapsed)
    this.lastRequestAt = Date.now()
  }

  private async fetchHtml(url: string) {
    const response = await this.request('GET', url)
    return responseBodyText(response)
  }

  private async request(method: 'GET', url: string): Promise<AxiosResponse<unknown>> {
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.waitForRequestSlot()
      try {
        const response = await this.client.request({
          method,
          url,
          headers: {
            ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
          },
        })
        this.mergeCookies(response)
        this.assertNotBlocked(response)
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
          const retryAfterSeconds = Number(response.headers['retry-after'] || 0)
          await sleep(retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000 * 2 ** attempt)
          continue
        }
        if (response.status >= 400) {
          throw new Error(`BIRAC HTTP ${response.status} for ${url}`)
        }
        return response
      } catch (error) {
        if (error instanceof PublicProjectSourceBlockedError) throw error
        lastError = error
        if (attempt < 3) {
          await sleep(1000 * 2 ** attempt)
          continue
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private assertNotBlocked(response: AxiosResponse<unknown>) {
    const text = responseBodyText(response)
    if (
      response.status === 403 ||
      response.status === 429 ||
      (/captcha|access\s+challenge|unusual\s+traffic/i.test(text) && !/BIRAC|Supported Projects/i.test(text))
    ) {
      throw new PublicProjectSourceBlockedError(`BIRAC presented an access challenge or rate limit (${response.status})`)
    }
  }
}

export function createBiracPublicProjectConnector() {
  return new BiracPublicProjectConnector()
}

export const __biracTestables = {
  buildSourceRecordKey,
  parseProjectRows,
  parseSchemeLinks,
}
