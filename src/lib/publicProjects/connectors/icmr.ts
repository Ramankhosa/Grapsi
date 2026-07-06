import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import pdfParse from 'pdf-parse-fork'
import { convert } from 'html-to-text'
import { createHash } from 'node:crypto'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'
import { PublicProjectSourceBlockedError } from '@/lib/publicProjects/types'

const ICMR_BASE_URL = 'https://www.icmr.gov.in'
const APPROVED_PROJECTS_URL = `${ICMR_BASE_URL}/list-of-approved-projects`
const DEFAULT_USER_AGENT =
  'GrapsiPublicProjectCrawler/1.0 (+https://grapsi.ai; public awarded-project indexing; contact: support@grapsi.ai)'
const DEFAULT_REQUEST_SPACING_MS = 1000

type IcmrPdfLink = {
  pdfId: string
  label: string
  url: string
  timeWindow?: string | null
}

type IcmrParsedRow = JsonRecord & {
  pdfId: string
  pdfLabel: string
  pdfUrl: string
  serialNumber: string
  title?: string | null
  principalInvestigator?: string | null
  principalInvestigatorBlock?: string | null
  fundedBy?: string | null
  dateOfApproval?: string | null
  totalBudget?: string | null
  duration?: string | null
  subjectArea?: string | null
  notes?: string | null
  rawBlock: string
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
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
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

function normalizeUrl(url: string) {
  const compact = url.replace(/\s+/g, '')
  return new URL(compact, ICMR_BASE_URL).toString()
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function buildPdfId(url: string) {
  const parsed = new URL(url)
  const filename = parsed.pathname.split('/').pop()?.replace(/\.pdf$/i, '') || parsed.pathname
  return `${filename.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)}_${hash(url).slice(0, 10)}`
}

function parsePdfLinks(html: string): IcmrPdfLink[] {
  const links: IcmrPdfLink[] = []
  const seen = new Set<string>()
  const regex = /<a\b[^>]*href=["']([^"']*list-ap-pr[^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html))) {
    const url = normalizeUrl(match[1])
    if (seen.has(url)) continue
    seen.add(url)

    const label = stripTags(match[2])?.replace(/\s+(View|Download)$/i, '').trim() || url
    links.push({
      pdfId: buildPdfId(url),
      label,
      url,
      timeWindow: label.replace(/\s*\([^)]*\)\s*$/g, '').replace(/\s+View$/i, '').trim() || null,
    })
  }
  return links
}

function normalizedLines(text: string) {
  return text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => !/^(Research Projects? Approved by HMSC|Indian Council of Medical Research|CHAPTER\s+\d+)$/i.test(line))
}

function isSerialLine(line: string) {
  return /^\d{1,4}$/.test(line.trim())
}

function isHeaderLine(line: string) {
  return /^(S\.?\s*no\.?.*|Details? of (the )?Projects?.*|Principal Investigator(\s+(Funded by|Funding\/Collaborating Agency))?|Funding\/Collaborating Agency|Funded by|Date of approval|Total Budget|Total budget|Duration|Subject Area|Subject area)$/i.test(
    line.trim()
  )
}

function isInvestigatorName(line: string) {
  return /^(Dr|Prof|Professor|Mr|Ms|Mrs|Miss)\.?\s+/i.test(line.trim())
}

function isDuration(line: string) {
  return /^(Duration\s+)?\d+\s*(months?|years?)\b/i.test(line.trim())
}

function isBudget(line: string) {
  return /^(Total budget\s+)?(Rs\.?|INR|₹)\s*/i.test(line.trim()) || /\b(lakhs?|crores?)\b/i.test(line)
}

function isDate(line: string) {
  return /^(Date of approval\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/i.test(
    line.trim()
  )
}

function isSubjectArea(line: string) {
  return /^Subject area\s+/i.test(line.trim())
}

function lineJoin(lines: string[]) {
  return cleanText(lines.join('\n'))
}

function cleanTitle(value?: string | null) {
  return cleanText(
    (value || '')
      .split('\n')
      .filter((line) => !isHeaderLine(line))
      .join('\n')
      .replace(/^\d{1,4}\.\s*/, '')
  )
}

function stripInlineLabel(value?: string | null) {
  return cleanText(
    (value || '')
      .replace(/^Date of approval\s+/i, '')
      .replace(/^Total budget\s+/i, '')
      .replace(/^Duration\s+/i, '')
      .replace(/^Subject area\s+/i, '')
  )
}

function parseBudgetAmount(value?: string | null) {
  if (!value) return null
  const lower = value.toLowerCase()
  const numeric = value.replace(/[^\d.]/g, '')
  if (!numeric) return null
  const amount = Number(numeric)
  if (!Number.isFinite(amount)) return null
  if (/\bcrore?s?\b/.test(lower)) return String(Math.round(amount * 10000000))
  if (/\blakhs?\b/.test(lower)) return String(Math.round(amount * 100000))
  return String(amount)
}

function parseDurationMonths(value?: string | null) {
  if (!value) return null
  const match = value.match(/(\d+)\s*(months?|years?)/i)
  if (!match) return null
  const count = Number(match[1])
  if (!Number.isFinite(count)) return null
  return /^year/i.test(match[2]) ? count * 12 : count
}

function parseApprovalDate(value?: string | null) {
  if (!value) return { date: null as Date | null, year: null as number | null }
  const normalized = value.replace(/(\w+)\s+(\d{1,2})\s+(\d{4})/, '$1 $2, $3')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return { date: null, year: null }
  return { date, year: date.getUTCFullYear() }
}

function splitInstitutionAndFunder(lines: string[], durationIndex: number | null) {
  const beforeDuration = durationIndex === null ? lines : lines.slice(0, durationIndex)
  if (beforeDuration.length === 0) return { institutionLines: [] as string[], fundedByLines: [] as string[] }

  let pinIndex = -1
  for (let index = beforeDuration.length - 1; index >= 0; index -= 1) {
    if (/\b\d{6}\b/.test(beforeDuration[index])) {
      pinIndex = index
      break
    }
  }
  if (pinIndex >= 0 && pinIndex < beforeDuration.length - 1) {
    return {
      institutionLines: beforeDuration.slice(0, pinIndex + 1),
      fundedByLines: beforeDuration.slice(pinIndex + 1),
    }
  }

  const sponsorStart = Math.max(1, beforeDuration.length - Math.min(2, beforeDuration.length))
  return {
    institutionLines: beforeDuration.slice(0, sponsorStart),
    fundedByLines: beforeDuration.slice(sponsorStart),
  }
}

function parseIcmrPdfRows(text: string, pdf: IcmrPdfLink): IcmrParsedRow[] {
  const lines = normalizedLines(text)
  const serialIndexes: Array<{ line: string; index: number; serialNumber: string; inlineTitle?: string | null }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const inline = line.match(/^(\d{1,4})\.\s+(.+)$/)
    if (inline && !/^S\.?\s*No/i.test(line)) {
      serialIndexes.push({ line, index, serialNumber: inline[1], inlineTitle: inline[2] })
      continue
    }

    const dotOnly = line.match(/^(\d{1,4})\.$/)
    if (dotOnly && lines.slice(index + 1, index + 18).some((candidate) => /Principal Investigator/i.test(candidate))) {
      serialIndexes.push({ line, index, serialNumber: dotOnly[1] })
      continue
    }

    if (isSerialLine(line) && lines.slice(index + 1, index + 9).some((candidate) => /^Principal Investigator$/i.test(candidate))) {
      serialIndexes.push({ line, index, serialNumber: line })
    }
  }

  const rows: IcmrParsedRow[] = []
  const seen = new Set<string>()

  for (let position = 0; position < serialIndexes.length; position += 1) {
    const start = serialIndexes[position].index
    const end = serialIndexes[position + 1]?.index ?? lines.length
    const serialNumber = serialIndexes[position].serialNumber
    const inlineTitle = serialIndexes[position].inlineTitle
    const blockLines = lines.slice(start, end).filter((line, index) => index === 0 || !isHeaderLine(line))
    const payloadLines = [inlineTitle, ...blockLines.slice(1)].filter((line): line is string => Boolean(cleanText(line)))
    const investigatorIndex = payloadLines.findIndex(isInvestigatorName)
    if (investigatorIndex < 0) continue

    const titleLines = payloadLines.slice(0, investigatorIndex).filter((line) => !/Approved with/i.test(line))
    let principalInvestigator = cleanText(payloadLines[investigatorIndex])
    let afterInvestigator = payloadLines.slice(investigatorIndex + 1)
    if (
      afterInvestigator[0] &&
      /^[A-Z][A-Za-z'. -]{1,30}$/.test(afterInvestigator[0]) &&
      !/(Professor|Director|Scientist|Head|College|Institute|Foundation|University|Hospital|USA|UK|Germany|Australia|Singapore)/i.test(afterInvestigator[0])
    ) {
      principalInvestigator = cleanText(`${principalInvestigator} ${afterInvestigator[0]}`)
      afterInvestigator = afterInvestigator.slice(1)
    }

    const durationIndex = afterInvestigator.findIndex(isDuration)
    const budgetIndex = afterInvestigator.findIndex(isBudget)
    const dateIndex = afterInvestigator.findIndex(isDate)
    const subjectIndex = afterInvestigator.findIndex(isSubjectArea)
    const metadataIndexes = [durationIndex, budgetIndex, dateIndex, subjectIndex].filter((index) => index >= 0)
    const firstMetadataIndex = metadataIndexes.length ? Math.min(...metadataIndexes) : durationIndex
    const { institutionLines, fundedByLines } = splitInstitutionAndFunder(
      afterInvestigator,
      firstMetadataIndex >= 0 ? firstMetadataIndex : null
    )

    const subjectLines =
      subjectIndex >= 0
        ? [stripInlineLabel(afterInvestigator[subjectIndex]) || '']
        :
      budgetIndex >= 0 && dateIndex >= 0 && dateIndex > budgetIndex
        ? afterInvestigator.slice(budgetIndex + 1, dateIndex)
        : []
    const notes =
      dateIndex >= 0
        ? lineJoin(afterInvestigator.slice(dateIndex + 1).filter((line) => !isHeaderLine(line) && !isSerialLine(line)))
        : null

    const title = cleanTitle(lineJoin(titleLines))
    const rawBlock = blockLines.join('\n')
    const stableKey = `${pdf.pdfId}:${serialNumber}:${(title || principalInvestigator || '').toLowerCase()}`
    if (seen.has(stableKey)) continue
    seen.add(stableKey)

    rows.push({
      pdfId: pdf.pdfId,
      pdfLabel: pdf.label,
      pdfUrl: pdf.url,
      serialNumber,
      title,
      principalInvestigator,
      principalInvestigatorBlock: lineJoin([principalInvestigator || '', ...institutionLines].filter(Boolean)),
      fundedBy: lineJoin(fundedByLines),
      dateOfApproval: dateIndex >= 0 ? stripInlineLabel(afterInvestigator[dateIndex]) : null,
      totalBudget: budgetIndex >= 0 ? stripInlineLabel(afterInvestigator[budgetIndex]) : null,
      duration: durationIndex >= 0 ? stripInlineLabel(afterInvestigator[durationIndex]) : null,
      subjectArea: lineJoin(subjectLines.filter(Boolean)),
      notes,
      rawBlock,
    })
  }

  return rows
}

function buildSourceRecordKey(row: IcmrParsedRow) {
  return `ICMR:${row.pdfId}:${row.serialNumber}:${hash([row.title, row.principalInvestigator].join('|')).slice(0, 12)}`
}

function extractEmails(text?: string | null) {
  if (!text) return []
  return Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []))
}

function extractPhones(text?: string | null) {
  if (!text) return []
  return Array.from(new Set(text.match(/(?:\+?91[-\s]?)?\d[\d\s-]{7,}\d/g) || [])).map((phone) => phone.trim())
}

function responseBodyText(response: AxiosResponse<unknown>) {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {})
}

export class IcmrPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'ICMR' as const
  baseUrl = ICMR_BASE_URL

  private readonly client: AxiosInstance
  private readonly cookies = new Map<string, string>()
  private lastRequestAt = 0
  private pdfLinksCache: IcmrPdfLink[] | null = null

  constructor(
    private readonly options: {
      userAgent?: string
      requestSpacingMs?: number
      timeoutMs?: number
    } = {}
  ) {
    this.client = axios.create({
      timeout: options.timeoutMs || 45000,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        Accept: 'text/html,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
  }

  async listStates(): Promise<string[]> {
    return []
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    let emitted = 0
    const pdfLinks = await this.discoverPdfLinks()

    for (const pdf of pdfLinks) {
      if (emitted >= maxRecords) return
      const pdfBuffer = await this.fetchBuffer(pdf.url)
      const parsed = await pdfParse(pdfBuffer)
      const rows = parseIcmrPdfRows(parsed.text || '', pdf)

      for (const row of rows) {
        if (emitted >= maxRecords) return
        const title =
          cleanTitle(row.title) ||
          cleanTitle(row.rawBlock.split('\n').find((line) => line.length > 20)) ||
          `ICMR approved project ${row.serialNumber}`
        const sourceRecordKey = buildSourceRecordKey({ ...row, title })
        emitted += 1
        yield {
          sourceKey: 'ICMR',
          externalId: `${row.pdfId}:${row.serialNumber}`,
          sourceVariant: 'icmr_approved_project_pdf',
          sourceRecordKey,
          detailUrl: row.pdfUrl,
          listingPayload: {
            ...row,
            title,
            pdfTextHash: hash(parsed.text || ''),
            pdfPages: parsed.numpages || null,
          },
        }
      }
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const row = record.listingPayload as IcmrParsedRow & { pdfPages?: number | null; pdfTextHash?: string | null }
    const title = cleanTitle(row.title) || `ICMR approved project ${row.serialNumber}`
    const approval = parseApprovalDate(row.dateOfApproval)
    const piBlock = cleanText(row.principalInvestigatorBlock)
    const emails = extractEmails(piBlock)
    const phones = extractPhones(piBlock)

    return {
      sourceKey: 'ICMR',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: APPROVED_PROJECTS_URL,
      detailUrl: row.pdfUrl,
      projectType: 'icmr_hmsc_approved_project',
      programName: 'ICMR HMSC Approved Projects',
      schemeName: row.pdfLabel,
      schemeHierarchy: {
        source: 'ICMR',
        page: 'List of Approved Projects',
        pdfId: row.pdfId,
        pdfLabel: row.pdfLabel,
      },
      category: 'International collaborative research project',
      areaName: cleanText(row.subjectArea),
      title,
      abstractText: 'NA',
      primaryInvestigatorName: cleanText(row.principalInvestigator),
      primaryInstitutionName: piBlock,
      country: 'India',
      sanctionYear: approval.year,
      startDate: approval.date,
      durationMonths: parseDurationMonths(row.duration),
      budgetAmount: parseBudgetAmount(row.totalBudget),
      budgetCurrency: row.totalBudget ? 'INR' : null,
      budgetComponents: row.totalBudget
        ? {
            totalBudget: row.totalBudget,
            fundedBy: row.fundedBy,
          }
        : null,
      rawPayload: {
        row,
      },
      extendedFields: {
        pdfId: row.pdfId,
        pdfLabel: row.pdfLabel,
        serialNumber: row.serialNumber,
        fundedBy: row.fundedBy,
        dateOfApproval: row.dateOfApproval,
        totalBudget: row.totalBudget,
        duration: row.duration,
        subjectArea: row.subjectArea,
        notes: row.notes,
        pdfPages: row.pdfPages,
        pdfTextHash: row.pdfTextHash,
        note: 'ICMR source exposes approved-project PDF table rows; abstract is stored as NA and embeddings use title only.',
      },
      participants: row.principalInvestigator
        ? [
            {
              role: 'PI',
              name: row.principalInvestigator,
              institutionName: piBlock,
              country: 'India',
              sourcePayload: {
                principalInvestigatorBlock: row.principalInvestigatorBlock,
              },
            },
          ]
        : [],
      contacts: [
        ...emails.map((email) => ({
          contactType: 'email',
          label: 'ICMR project investigator',
          value: email,
          sourcePayload: { source: 'principalInvestigatorBlock' },
        })),
        ...phones.map((phone) => ({
          contactType: 'phone',
          label: 'ICMR project investigator',
          value: phone,
          sourcePayload: { source: 'principalInvestigatorBlock' },
        })),
      ],
    }
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    const row = record.listingPayload as IcmrParsedRow & { pdfPages?: number | null; pdfTextHash?: string | null }

    return {
      sourceKey: 'ICMR',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: APPROVED_PROJECTS_URL,
      detailUrl: row.pdfUrl,
      fetchedAt: new Date().toISOString(),
      listingPayload: row,
      detailPayload: {
        pdfUrl: row.pdfUrl,
        pdfId: row.pdfId,
        pdfLabel: row.pdfLabel,
        pdfPages: row.pdfPages || null,
        pdfTextHash: row.pdfTextHash || null,
      },
      rawPayload: {
        row,
      },
    }
  }

  private async discoverPdfLinks() {
    if (this.pdfLinksCache) return this.pdfLinksCache
    const response = await this.request('GET', APPROVED_PROJECTS_URL, 'text')
    const html = responseBodyText(response)
    this.pdfLinksCache = parsePdfLinks(html)
    if (this.pdfLinksCache.length === 0) {
      throw new Error('ICMR approved projects page returned no list-ap-pr PDF links')
    }
    return this.pdfLinksCache
  }

  private async fetchBuffer(url: string) {
    const response = await this.request('GET', url, 'arraybuffer')
    return Buffer.from(response.data as ArrayBuffer)
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

  private async request(method: 'GET', url: string, responseType: 'text' | 'arraybuffer'): Promise<AxiosResponse<unknown>> {
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.waitForRequestSlot()
      try {
        const response = await this.client.request({
          method,
          url,
          responseType,
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
          throw new Error(`ICMR HTTP ${response.status} for ${url}`)
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
    if (response.status === 403 || response.status === 429) {
      throw new PublicProjectSourceBlockedError(`ICMR presented an access challenge or rate limit (${response.status})`)
    }
    if (
      typeof response.data === 'string' &&
      /captcha|access\s+challenge|unusual\s+traffic/i.test(response.data) &&
      !/ICMR|Indian Council of Medical Research|List of Approved Projects/i.test(response.data)
    ) {
      throw new PublicProjectSourceBlockedError(`ICMR presented an access challenge or rate limit (${response.status})`)
    }
  }
}

export function createIcmrPublicProjectConnector() {
  return new IcmrPublicProjectConnector()
}

export const __icmrTestables = {
  buildSourceRecordKey,
  parseBudgetAmount,
  parseDurationMonths,
  parseIcmrPdfRows,
  parsePdfLinks,
}
