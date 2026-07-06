import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { convert } from 'html-to-text'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectContactInput,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectParticipantInput,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'
import { PublicProjectSourceBlockedError } from '@/lib/publicProjects/types'

const CSIR_BASE_URL = 'https://csirprojects.anusandhan.net'
const SEARCH_PATH = '/control?_srch='
const DEFAULT_USER_AGENT =
  'GrapsiPublicProjectCrawler/1.0 (+https://grapsi.ai; public awarded-project indexing; contact: support@grapsi.ai)'
const DEFAULT_REQUEST_SPACING_MS = 1000

type CsirListingPayload = JsonRecord & {
  ipn: string
  page: number
  projectNumber?: string | null
  title?: string | null
  projectType?: string | null
  category?: string | null
  theme?: string | null
  investigator?: string | null
  status?: string | null
  startDate?: string | null
  endDate?: string | null
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

function decodeHtml(value: string | null | undefined) {
  return stripTags(value || '')
}

function parseDate(value: unknown): Date | null {
  const text = cleanText(value)
  if (!text) return null
  const match = text.match(/\b(\d{1,2})-([A-Za-z]{3})-((?:19|20)\d{2})\b/)
  if (match) {
    const [, dd, mon, yyyy] = match
    const date = new Date(`${dd} ${mon} ${yyyy}`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const fallback = new Date(text)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function parseYear(value: unknown): number | null {
  const date = parseDate(value)
  if (date) return date.getFullYear()
  const match = cleanText(value)?.match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

function splitKeywords(value: unknown): string[] {
  const text = cleanText(value)
  if (!text) return []
  return Array.from(
    new Set(
      text
        .split(/[,;|]/)
        .map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item))
    )
  )
}

function tableFieldMap(html: string): JsonRecord {
  const map: JsonRecord = {}
  const rowRegex = /<tr[^>]*>\s*<th[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html))) {
    const key = cleanText(stripTags(match[1])?.replace(/:$/, ''))
    const value = stripTags(match[2])
    if (key) {
      map[key] = value
    }
  }
  return map
}

function parseHeader(html: string) {
  const titleMatch = html.match(/<h2[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)
  const titleText = stripTags(titleMatch?.[1] || '') || ''
  const projectNumber = cleanText(titleText.match(/\[([^\]]+)\]/)?.[1])
  const title = cleanText(titleText.replace(/\[[^\]]+\]\s*:?\s*/, ''))
  const category = cleanText(html.match(/Project Category["'][^>]*>\s*Category\s*:\s*([^<]+)/i)?.[1])
  const theme = cleanText(html.match(/Project Theme["'][^>]*>\s*Theme\s*:\s*([^<]+)/i)?.[1])
  return { projectNumber, title, category, theme }
}

function parseTablesByHeading(html: string) {
  const sections: JsonRecord = {}
  const headingRegex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi
  let match: RegExpExecArray | null
  while ((match = headingRegex.exec(html))) {
    const heading = cleanText(stripTags(match[1])?.replace(/:$/, ''))
    if (!heading) continue
    const afterHeading = html.slice(headingRegex.lastIndex)
    const tableMatch = afterHeading.match(/<table[\s\S]*?<\/table>/i)
    if (!tableMatch) continue
    const tableHtml = tableMatch[0]
    const headers = Array.from(tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((h) => stripTags(h[1]) || '')
    const rows = Array.from(tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
      .map((row) => Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) => stripTags(cell[1]) || null))
      .filter((cells) => cells.length > 0)
      .map((cells) => {
        if (headers.length === cells.length) {
          return Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, cells[index]]))
        }
        return cells
      })
    sections[heading] = rows
  }
  return sections
}

function firstValue(row: JsonRecord, names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''))
  for (const [key, value] of Object.entries(row)) {
    if (normalizedNames.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      const text = cleanText(value)
      if (text) return text
    }
  }
  return null
}

function parseAmount(value: unknown): string | null {
  const text = cleanText(value)
  if (!text) return null
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? match[0] : null
}

function parsePrincipalInvestigator(html: string) {
  const sectionStart = html.search(/Project Investigator and Team members/i)
  if (sectionStart < 0) return { name: null, contactText: null, row: {} as JsonRecord }
  const section = html.slice(sectionStart, sectionStart + 5000)
  const match = section.match(/Project Investigator Name[\s\S]*?<td[^>]*>\s*<pre>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/pre>\s*<\/td>\s*<td[^>]*>\s*<pre>([\s\S]*?)<\/pre>/i)
  const name = decodeHtml(match?.[1])
  const designation = decodeHtml(match?.[2])
  const contactText = decodeHtml(match?.[3])
  return {
    name,
    contactText,
    row: {
      name,
      designation,
      contactDetails: contactText,
    },
  }
}

function parseBudgetDetails(html: string) {
  const sectionStart = html.search(/Project Budget Details|Approved Fund/i)
  if (sectionStart < 0) return { rows: [], approvedFund: null as string | null }
  const section = html.slice(sectionStart, sectionStart + 2500)
  const approvedFundDirect = stripTags(
    section.match(/Approved Fund[\s\S]*?<\/thead>[\s\S]*?<tbody>[\s\S]*?<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] || ''
  )
  const headers = Array.from(section.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((h) => stripTags(h[1]) || '')
  const firstDataRow = Array.from(section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((row) => Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) => stripTags(cell[1]) || null))
    .find((cells) => cells.length > 0)
  const row = firstDataRow && headers.length === firstDataRow.length
    ? Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, firstDataRow[index]]))
    : {}
  return {
    rows: Object.keys(row).length > 0 ? [row] : [],
    approvedFund: approvedFundDirect || firstValue(row, ['Approved Fund', 'Total']),
  }
}

function emailContacts(text: string | null | undefined, label: string): PublicProjectContactInput[] {
  const emails = text?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  return Array.from(new Set(emails.map((email) => email.toLowerCase()))).map((email) => ({
    contactType: 'email',
    label,
    value: email,
  }))
}

function phoneContacts(text: string | null | undefined, label: string): PublicProjectContactInput[] {
  const phones = text?.match(/(?:\+?91[-\s]?)?(?:\d[-\s]?){8,12}\d/g) || []
  return Array.from(new Set(phones.map((phone) => phone.replace(/\s+/g, ' ').trim()))).map((phone) => ({
    contactType: 'phone',
    label,
    value: phone,
  }))
}

function buildSourceRecordKey(ipn: string, projectNumber?: string | null) {
  return `CSIR:${projectNumber || ipn}`
}

function responseBodyText(response: AxiosResponse<unknown>) {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {})
}

export class CsirPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'CSIR' as const
  baseUrl = CSIR_BASE_URL

  private readonly client: AxiosInstance
  private readonly cookies = new Map<string, string>()
  private lastRequestAt = 0

  constructor(
    private readonly options: {
      userAgent?: string
      requestSpacingMs?: number
      timeoutMs?: number
    } = {}
  ) {
    this.client = axios.create({
      baseURL: CSIR_BASE_URL,
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
    let page = 1
    let totalPages = Number.POSITIVE_INFINITY

    while (page <= totalPages && emitted < maxRecords) {
      const html = await this.fetchListPage(page)
      totalPages = Math.min(totalPages, this.parseTotalPages(html) || totalPages)
      const listings = this.parseListings(html, page)

      if (listings.length === 0) {
        return
      }

      for (const listing of listings) {
        if (emitted >= maxRecords) return
        emitted += 1
        yield {
          sourceKey: 'CSIR',
          externalId: listing.projectNumber || listing.ipn,
          sourceVariant: 'csir_project',
          sourceRecordKey: buildSourceRecordKey(listing.ipn, listing.projectNumber),
          detailUrl: `${CSIR_BASE_URL}/control`,
          listingPayload: listing,
        }
      }

      page += 1
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const listing = record.listingPayload as CsirListingPayload
    const detailHtml = await this.fetchDetailPage(listing.ipn)
    const header = parseHeader(detailHtml)
    const fieldMap = tableFieldMap(detailHtml)
    const sections = parseTablesByHeading(detailHtml)
    const piDirect = parsePrincipalInvestigator(detailHtml)
    const budgetDirect = parseBudgetDetails(detailHtml)
    const projectInvestigatorRows = (sections['Project Investigator and Team members'] || []) as JsonRecord[]
    const piRow = projectInvestigatorRows[0] || {}
    const piName =
      piDirect.name ||
      firstValue(piRow, ['Project Investigator Name', 'Team member Name']) ||
      cleanText(listing.investigator)
    const piContactText = piDirect.contactText || firstValue(piRow, ['Contact Details'])
    const contacts = [
      ...emailContacts(piContactText, 'CSIR project investigator'),
      ...phoneContacts(piContactText, 'CSIR project investigator'),
    ]

    const teamRows = Object.entries(sections)
      .filter(([heading]) => /team/i.test(heading))
      .flatMap(([, rows]) => (Array.isArray(rows) ? rows : []))
      .filter((row) => row && typeof row === 'object') as JsonRecord[]

    const participants: PublicProjectParticipantInput[] = []
    if (piName) {
      participants.push({
        role: 'PI',
        name: piName,
        institutionName: cleanText(piContactText?.split(/\n|<br\/?>/i)[0]) || null,
        country: 'India',
        sourcePayload: Object.keys(piDirect.row).length > 0 ? piDirect.row : piRow,
      })
    }

    teamRows.slice(1).forEach((row) => {
      const names = firstValue(row, ['Team member Name', 'Project Investigator Name'])
      if (!names) return
      names
        .split(/\s*,\s*/)
        .map((name) => cleanText(name))
        .filter((name): name is string => Boolean(name))
        .forEach((name) => {
          participants.push({
            role: 'TEAM_MEMBER',
            name,
            country: 'India',
            sourcePayload: row,
          })
        })
    })

    const approvedFund =
      budgetDirect.approvedFund ||
      firstValue(((sections['Project Budget Details'] || []) as JsonRecord[])[0] || {}, ['Approved Fund']) ||
      firstValue(((sections['Project Budget Details'] || []) as JsonRecord[])[0] || {}, ['Total'])

    const title = header.title || cleanText(listing.title) || record.externalId
    const objectives = cleanText(fieldMap.Objectives)
    const executiveSummary =
      cleanText(fieldMap['Executive Summery']) ||
      cleanText(fieldMap['Executive Summary'])

    return {
      sourceKey: 'CSIR',
      externalId: listing.projectNumber || listing.ipn,
      sourceVariant: 'csir_project',
      sourceRecordKey: record.sourceRecordKey,
      fileNumber: cleanText(fieldMap['Approval OM No']),
      projectNumber: header.projectNumber || listing.projectNumber || listing.ipn,
      sourceUrl: `${CSIR_BASE_URL}${SEARCH_PATH}`,
      detailUrl: `${CSIR_BASE_URL}/control`,
      statusText: cleanText(fieldMap['Project Status']) || cleanText(listing.status),
      projectType: cleanText(fieldMap['Project Type']) || cleanText(listing.projectType),
      programName: 'CSIR R&D Projects',
      schemeName: cleanText(header.category || listing.category),
      schemeHierarchy: {
        source: 'CSIR',
        category: header.category || listing.category,
        theme: header.theme || listing.theme,
        projectType: fieldMap['Project Type'] || listing.projectType,
      },
      category: header.category || listing.category,
      theme: header.theme || listing.theme,
      title,
      abstractText: executiveSummary || objectives,
      executiveSummary,
      objectivesText: objectives,
      milestonesText: cleanText(fieldMap.Milestone),
      deliverablesText: cleanText(fieldMap.Deliverables),
      outputPlannedText: cleanText(fieldMap['Output Planned']),
      outputAchievedText: cleanText(fieldMap['Output Achieved']),
      keywords: splitKeywords(fieldMap.Keywords),
      primaryInvestigatorName: piName,
      primaryInstitutionName: cleanText(piContactText?.split(/\n/)[0]),
      country: 'India',
      sanctionYear: parseYear(fieldMap['Starting Date'] || listing.startDate),
      startDate: parseDate(fieldMap['Starting Date'] || listing.startDate),
      endDate: parseDate(fieldMap['Scheduled Completion Date'] || listing.endDate),
      budgetAmount: parseAmount(approvedFund),
      budgetCurrency: 'INR',
      budgetComponents: {
        budgetDetails: sections['Project Budget Details'] || budgetDirect.rows || [],
        inHouseBudgetHeadWise: sections['In-house Project'] || sections['In-house Project : Budget Head-wise Fund Details'] || [],
        externalBudgetHeadWise: sections['External Project'] || sections['External Project : Budget Head-wise Fund Details'] || [],
      },
      manpower: sections['Project Investigator and Team members'] || [],
      publications: sections['Project Publications'] || sections['Publications'] || [],
      patents: sections['Patents'] || sections['Project Patents'] || [],
      outcomes: {
        outcomePlanned: fieldMap['Outcome Planned'] || null,
        outcomeAchieved: fieldMap['Outcome Achieved'] || null,
        progressDetails: sections['Project Progress Details'] || [],
        committeeDetails: sections['Committee Details'] || [],
        ipDetails: sections['IP Details'] || [],
        fundingAgencyDetails: sections['Funding Agency Details'] || [],
      },
      rawPayload: {
        listing,
        detail: {
          header,
          fieldMap,
          sections,
          html: detailHtml,
        },
      },
      extendedFields: {
        ipn: listing.ipn,
        page: listing.page,
        headquarterNodal: fieldMap['Headquarter Nodal'] || null,
        partneringLab: fieldMap['Partnering Lab'] || null,
        collaborators: fieldMap.Collaborators || null,
        detailedActivities: fieldMap['Detailed Activities'] || null,
        workplan: fieldMap.Workplan || null,
        remarks: fieldMap.Remarks || null,
      },
      participants,
      contacts: this.uniqueContacts(contacts),
    }
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    const listing = record.listingPayload as CsirListingPayload
    const detailHtml = await this.fetchDetailPage(listing.ipn)
    const detailPayload = {
      detailUrl: `${CSIR_BASE_URL}/control`,
      html: detailHtml,
    }

    return {
      sourceKey: 'CSIR',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: `${CSIR_BASE_URL}${SEARCH_PATH}`,
      detailUrl: detailPayload.detailUrl,
      fetchedAt: new Date().toISOString(),
      listingPayload: listing,
      detailPayload,
      rawPayload: {
        listing,
        detail: detailPayload,
      },
    }
  }

  private async fetchListPage(page: number) {
    const path = page <= 1 ? SEARCH_PATH : `/control?_srch&frm=${page}`
    const response = await this.request('GET', path)
    return responseBodyText(response)
  }

  private async fetchDetailPage(ipn: string) {
    const params = new URLSearchParams()
    params.set('ipn', ipn)
    params.set('ul', '_pd')
    const response = await this.request('POST', '/control', params)
    return responseBodyText(response)
  }

  private parseTotalPages(html: string) {
    const match = html.match(/Page\s+\d+\s+of\s+(\d+)/i)
    return match ? Number(match[1]) : null
  }

  private parseListings(html: string, page: number): CsirListingPayload[] {
    const listings: CsirListingPayload[] = []
    const detailRegex = /viewDetails\('([^']+)'\)/gi
    let match: RegExpExecArray | null
    while ((match = detailRegex.exec(html))) {
      const ipn = match[1]
      const cardClassIndex = html.lastIndexOf('card-media', match.index)
      const windowStart = cardClassIndex >= 0 ? Math.max(0, html.lastIndexOf('<div', cardClassIndex)) : -1
      const fallbackStart = Math.max(0, match.index - 3500)
      const chunk = html.slice(windowStart >= 0 ? windowStart : fallbackStart, match.index + 200)
      const text = stripTags(chunk) || ''
      const projectNumber =
        cleanText(chunk.match(/<span>\s*\[([^\]]+)\]\s*<\/span>\s*&nbsp;:&nbsp;/i)?.[1]) ||
        cleanText(text.match(/\[([A-Z0-9 ]+)\]\s*:/)?.[1])
      const title =
        decodeHtml(chunk.match(/<span>\s*\[[^\]]+\]\s*<\/span>\s*&nbsp;:&nbsp;\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]) ||
        cleanText(text.match(/\[[A-Z0-9 ]+\]\s*:\s*([\s\S]*?)\s*Category\s*:/i)?.[1])
      const category = cleanText(text.match(/Category\s*:\s*([A-Z0-9]+)/i)?.[1])
      const theme = cleanText(text.match(/Theme\s*:\s*([A-Z0-9]+)/i)?.[1])
      const projectType = cleanText(text.match(/(Internal|External)\s+Project/i)?.[0])
      const startDate = cleanText(text.match(/Start Date\s*:\s*([^|]+)\|/i)?.[1])
      const endDate = cleanText(text.match(/End Date\s*:\s*([^\n]+)/i)?.[1])
      const investigator = cleanText(text.match(/Project Investigator\s*:\s*([\s\S]*?)\s+Status\s*:/i)?.[1])
      const status = cleanText(text.match(/Status\s*:\s*([A-Za-z]+)/i)?.[1])

      listings.push({
        ipn,
        page,
        projectNumber,
        title,
        projectType,
        category,
        theme,
        investigator,
        status,
        startDate,
        endDate,
      })
    }
    return listings
  }

  private mergeCookies(response: AxiosResponse<unknown>) {
    const setCookie = response.headers['set-cookie']
    const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    values.forEach((cookie) => {
      const [pair] = cookie.split(';')
      const index = pair.indexOf('=')
      if (index > 0) {
        this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
      }
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
    if (elapsed < spacing) {
      await sleep(spacing - elapsed)
    }
    this.lastRequestAt = Date.now()
  }

  private async request(method: 'GET' | 'POST', path: string, data?: URLSearchParams): Promise<AxiosResponse<unknown>> {
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.waitForRequestSlot()
      try {
        const response = await this.client.request({
          method,
          url: path,
          data,
          headers: {
            ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
            ...(method === 'POST'
              ? {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  Referer: `${CSIR_BASE_URL}${SEARCH_PATH}`,
                }
              : {}),
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
          throw new Error(`CSIR HTTP ${response.status} for ${path}`)
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
      (/captcha|access\s+challenge|unusual\s+traffic/i.test(text) && !/R&D Projects of CSIR|Project Profile/i.test(text))
    ) {
      throw new PublicProjectSourceBlockedError(`CSIR presented an access challenge or rate limit (${response.status})`)
    }
  }

  private uniqueContacts(contacts: PublicProjectContactInput[]) {
    const seen = new Set<string>()
    return contacts.filter((contact) => {
      const key = `${contact.contactType}:${contact.value}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}

export function createCsirPublicProjectConnector() {
  return new CsirPublicProjectConnector()
}

export const __csirTestables = {
  buildSourceRecordKey,
  cleanText,
  parseHeader,
  tableFieldMap,
}
