import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import crypto from 'node:crypto'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'
import { PublicProjectSourceBlockedError } from '@/lib/publicProjects/types'
import type { PublicProjectSourceKey } from '@/lib/prisma-generated'

const DEFAULT_USER_AGENT =
  'GrapsiPublicProjectCrawler/1.0 (+https://grapsi.ai; raw funded-project indexing; contact: support@grapsi.ai)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\u00a0/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').trim()
  return text ? text : null
}

function stableHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? {})).digest('hex')
}

function currentYear() {
  return new Date().getUTCFullYear()
}

function boundedPageSize(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback
}

function fiscalYears(options: PublicProjectDiscoveryOptions, fallbackStartYear: number) {
  if (Array.isArray(options.fiscalYears) && options.fiscalYears.length > 0) {
    return options.fiscalYears
      .map((year) => Number(year))
      .filter((year) => Number.isInteger(year) && year >= 1900 && year <= currentYear() + 1)
  }
  const start = Number.isInteger(options.startYear) ? Number(options.startYear) : fallbackStartYear
  const end = Number.isInteger(options.endYear) ? Number(options.endYear) : currentYear()
  return Array.from({ length: Math.max(1, end - start + 1) }, (_, index) => start + index)
}

function responseBodyText(response: AxiosResponse<unknown>) {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {})
}

abstract class RawApiConnector {
  abstract sourceKey: PublicProjectSourceKey
  abstract baseUrl: string

  protected readonly client: AxiosInstance
  private lastRequestAt = 0

  constructor(
    protected readonly options: {
      userAgent?: string
      requestSpacingMs?: number
      timeoutMs?: number
    } = {}
  ) {
    this.client = axios.create({
      timeout: options.timeoutMs || 60000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
      },
    })
  }

  async listStates(): Promise<string[]> {
    return []
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    return {
      sourceKey: record.sourceKey,
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: this.baseUrl,
      detailUrl: record.detailUrl || null,
      fetchedAt: new Date().toISOString(),
      listingPayload: record.listingPayload,
      detailPayload: null,
      rawPayload: {
        listing: record.listingPayload,
      },
    }
  }

  async fetchAndNormalize(_record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    throw new Error(`${this.sourceKey} supports raw-only ingestion. Create the crawl with filters.rawOnly=true.`)
  }

  protected async getJson(url: string, params?: JsonRecord): Promise<JsonRecord> {
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.waitForRequestSlot()
      try {
        const response = await this.client.get(url, { params })
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
          const retryAfterSeconds = Number(response.headers['retry-after'] || 0)
          await sleep(retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000 * 2 ** attempt)
          continue
        }
        this.assertNotBlocked(response)
        if (response.status >= 400) {
          throw new Error(`${this.sourceKey} HTTP ${response.status}`)
        }
        return response.data as JsonRecord
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

  private async waitForRequestSlot() {
    const spacing = this.options.requestSpacingMs ?? 1000
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < spacing) await sleep(spacing - elapsed)
    this.lastRequestAt = Date.now()
  }

  private assertNotBlocked(response: AxiosResponse<unknown>) {
    const text = responseBodyText(response)
    if (
      response.status === 403 ||
      response.status === 429 ||
      (/captcha|access\s+challenge|unusual\s+traffic|blocked/i.test(text) && !/[{[]/.test(text.trim().slice(0, 1)))
    ) {
      throw new PublicProjectSourceBlockedError(`${this.sourceKey} presented an access challenge or rate limit (${response.status})`)
    }
  }
}

export class NsfPublicProjectRawConnector extends RawApiConnector {
  sourceKey = 'NSF' as const
  baseUrl = 'https://www.research.gov/awardapi-service/v1/awards.json'

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    const years = fiscalYears(options, currentYear() - 1)
    let emitted = 0

    for (const year of years) {
      let offset = 1
      while (emitted < maxRecords) {
        const payload = await this.getJson(this.baseUrl, {
          dateStart: `01/01/${year}`,
          dateEnd: `12/31/${year}`,
          offset,
          printFields:
            'id,title,abstractText,awardeeName,piFirstName,piLastName,startDate,expDate,fundsObligatedAmt,awardAgencyCode',
        })
        const rows = Array.isArray((payload.response as JsonRecord | undefined)?.award)
          ? ((payload.response as JsonRecord).award as JsonRecord[])
          : []
        if (rows.length === 0) return

        for (const row of rows) {
          if (emitted >= maxRecords) return
          const id = cleanText(row.id) || stableHash(row).slice(0, 16)
          emitted += 1
          yield {
            sourceKey: 'NSF',
            externalId: id,
            sourceVariant: 'nsf_award_api',
            sourceRecordKey: `NSF:${id}`,
            detailUrl: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${encodeURIComponent(id)}`,
            listingPayload: { award: row, search: { year, offset } },
          }
        }

        offset += rows.length
      }
    }
  }
}

export class UkriGtrPublicProjectRawConnector extends RawApiConnector {
  sourceKey = 'UKRI_GTR' as const
  baseUrl = 'https://gtr.ukri.org/gtr/api/projects'

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    const fetchSize = boundedPageSize(options.pageSize, 20, 100)
    let emitted = 0
    let page = 1

    while (emitted < maxRecords) {
      const payload = await this.getJson(this.baseUrl, { p: page, fetchSize })
      const rows = Array.isArray(payload.project) ? (payload.project as JsonRecord[]) : []
      if (rows.length === 0) return

      for (const row of rows) {
        if (emitted >= maxRecords) return
        const id = cleanText(row.id) || cleanText(row.grantReference) || stableHash(row).slice(0, 16)
        emitted += 1
        yield {
          sourceKey: 'UKRI_GTR',
          externalId: id,
          sourceVariant: 'ukri_gtr_project_api',
          sourceRecordKey: `UKRI_GTR:${id}`,
          detailUrl: `https://gtr.ukri.org/projects?ref=${encodeURIComponent(id)}`,
          listingPayload: { project: row, search: { page, fetchSize } },
        }
      }

      page += 1
    }
  }
}

export class CordisPublicProjectRawConnector extends RawApiConnector {
  sourceKey = 'CORDIS' as const
  baseUrl = 'https://cordis.europa.eu/search/en'

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    const num = boundedPageSize(options.pageSize, 20, 100)
    let emitted = 0
    let page = 1

    while (emitted < maxRecords) {
      const payload = await this.getJson(this.baseUrl, {
        q: "contenttype='project'",
        p: page,
        num,
        format: 'json',
      })
      const hits = ((payload.hits as JsonRecord | undefined)?.hit || []) as JsonRecord[]
      const rows = Array.isArray(hits) ? hits : hits ? [hits] : []
      if (rows.length === 0) return

      for (const row of rows) {
        if (emitted >= maxRecords) return
        const project = (row.project || row) as JsonRecord
        const id = cleanText(project.id) || cleanText(project.rcn) || stableHash(project).slice(0, 16)
        emitted += 1
        yield {
          sourceKey: 'CORDIS',
          externalId: id,
          sourceVariant: 'cordis_search_project_json',
          sourceRecordKey: `CORDIS:${id}`,
          detailUrl: cleanText(project.id) ? `https://cordis.europa.eu/project/id/${project.id}` : null,
          listingPayload: { hit: row, search: { page, num } },
        }
      }

      page += 1
    }
  }
}

export class WorldBankPublicProjectRawConnector extends RawApiConnector {
  sourceKey = 'WORLD_BANK' as const
  baseUrl = 'https://search.worldbank.org/api/v2/projects'

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    const rows = boundedPageSize(options.pageSize, 20, 100)
    let emitted = 0
    let offset = 0

    while (emitted < maxRecords) {
      const payload = await this.getJson(this.baseUrl, { format: 'json', rows, os: offset })
      const projects = payload.projects && typeof payload.projects === 'object' ? (payload.projects as JsonRecord) : {}
      const entries = Object.entries(projects)
      if (entries.length === 0) return

      for (const [id, project] of entries) {
        if (emitted >= maxRecords) return
        emitted += 1
        yield {
          sourceKey: 'WORLD_BANK',
          externalId: id,
          sourceVariant: 'world_bank_projects_api_v2',
          sourceRecordKey: `WORLD_BANK:${id}`,
          detailUrl: `https://projects.worldbank.org/en/projects-operations/project-detail/${encodeURIComponent(id)}`,
          listingPayload: { project: project as JsonRecord, search: { offset, rows } },
        }
      }

      offset += entries.length
    }
  }
}

export function createNsfPublicProjectRawConnector() {
  return new NsfPublicProjectRawConnector()
}

export function createNsfPublicProjectConnector() {
  return createNsfPublicProjectRawConnector()
}

export function createUkriGtrPublicProjectRawConnector() {
  return new UkriGtrPublicProjectRawConnector()
}

export function createUkriGtrPublicProjectConnector() {
  return createUkriGtrPublicProjectRawConnector()
}

export const UkriGtrPublicProjectConnector = UkriGtrPublicProjectRawConnector

export function createCordisPublicProjectRawConnector() {
  return new CordisPublicProjectRawConnector()
}

export const NsfPublicProjectConnector = NsfPublicProjectRawConnector
export const __globalRawTestables = {
  cleanText,
  fiscalYears,
  stableHash,
}

export function createCordisPublicProjectConnector() {
  return createCordisPublicProjectRawConnector()
}

export function createWorldBankPublicProjectRawConnector() {
  return new WorldBankPublicProjectRawConnector()
}

export function createWorldBankPublicProjectConnector() {
  return createWorldBankPublicProjectRawConnector()
}
