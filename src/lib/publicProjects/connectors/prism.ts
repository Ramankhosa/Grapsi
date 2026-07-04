import axios, { type AxiosInstance, type AxiosResponse } from 'axios'
import { parseDocument } from 'htmlparser2'
import { findOne, getText } from 'domutils'
import { convert } from 'html-to-text'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectContactInput,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectParticipantInput,
} from '@/lib/publicProjects/types'
import { PublicProjectSourceBlockedError } from '@/lib/publicProjects/types'

const PRISM_BASE_URL = 'https://prism.serbonline.in'
const SEARCH_URL = `${PRISM_BASE_URL}/Search`
const DEFAULT_USER_AGENT =
  'GrapsiPublicProjectCrawler/1.0 (+https://grapsi.ai; public awarded-project indexing; contact: support@grapsi.ai)'
const DEFAULT_REQUEST_SPACING_MS = 250

type PrismListingRow = JsonRecord & {
  proposalId?: string
  fileNumber?: string
  schemeName?: string
  areaName?: string
  subAreaName?: string
  projectTitle?: string
  fullPiName?: string
  instituteName?: string
  status?: string
  actionName?: string
  yearOfSanction?: string | number
  budget?: string | number
  encodedProposalId?: string
  encodedUserId?: string
  onlineOffline?: string
}

type PrismDetailPayload = {
  detailUrl: string
  variant: 'online' | 'legacy'
  html?: string
  decodedProposalId?: string | null
  extracted?: JsonRecord
  auxiliary?: JsonRecord
  offlineApiPayload?: JsonRecord
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > 0 ? text : null
}

function htmlToPlainText(html: string | null | undefined): string | null {
  if (!html) {
    return null
  }

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

function metaContent(html: string, name: string): string | null {
  const nameFirst = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  const contentFirst = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["'][^>]*>`, 'i')
  return html.match(nameFirst)?.[1] || html.match(contentFirst)?.[1] || null
}

function nodeTextById(html: string, id: string): string | null {
  const doc = parseDocument(html)
  const node = findOne(
    (candidate: any) => candidate?.type === 'tag' && candidate.attribs?.id === id,
    doc.children as any,
    true
  )

  return node ? cleanText(getText(node as any)) : null
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return parseMaybeJson(JSON.parse(trimmed))
      } catch {
        return value
      }
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => parseMaybeJson(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, nested]) => [key, parseMaybeJson(nested)])
    )
  }

  return value
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function asArray(value: unknown): unknown[] {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function firstRecord(value: unknown): JsonRecord {
  const first = asArray(value).find((item) => item && typeof item === 'object')
  return asRecord(first)
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function pickField(record: JsonRecord, candidates: string[]): string | null {
  const normalizedEntries = Object.entries(record).map(([key, value]) => [normalizeKey(key), value] as const)
  const normalizedCandidates = candidates.map(normalizeKey)
  for (const candidate of normalizedCandidates) {
    const match = normalizedEntries.find(([key]) => key === candidate)
    const text = cleanText(match?.[1])
    if (text) {
      return text
    }
  }
  return null
}

function parseBudget(value: unknown): string | null {
  const text = cleanText(value)
  if (!text) {
    return null
  }

  const normalized = text.replace(/,/g, '')
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  return match ? match[0] : null
}

function parseYear(value: unknown): number | null {
  const text = cleanText(value)
  const match = text?.match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

function parseDate(value: unknown): Date | null {
  const text = cleanText(value)
  if (!text || text === '-' || /^na$/i.test(text)) {
    return null
  }

  const iso = text.match(/\b(19|20)\d{2}-\d{1,2}-\d{1,2}\b/)?.[0]
  if (iso) {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const slash = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d{2})\b/)
  if (slash) {
    const [, dd, mm, yyyy] = slash
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const fallback = new Date(text)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function splitKeywords(value: unknown): string[] {
  const text = cleanText(value)
  if (!text) {
    return []
  }

  return Array.from(
    new Set(
      text
        .split(/[,;|]/)
        .map((keyword) => cleanText(keyword))
        .filter((keyword): keyword is string => Boolean(keyword))
    )
  )
}

function emailContacts(text: string | null | undefined): PublicProjectContactInput[] {
  if (!text) {
    return []
  }

  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  return Array.from(new Set(emails.map((email) => email.trim().toLowerCase()))).map((email) => ({
    contactType: 'email',
    label: 'PRISM profile',
    value: email,
  }))
}

function phoneContacts(text: string | null | undefined): PublicProjectContactInput[] {
  if (!text) {
    return []
  }

  const phones = text.match(/(?:\+?91[-\s]?)?(?:\d[-\s]?){8,12}\d/g) || []
  return Array.from(new Set(phones.map((phone) => phone.replace(/\s+/g, ' ').trim()))).map((phone) => ({
    contactType: 'phone',
    label: 'PRISM profile',
    value: phone,
  }))
}

function buildSourceRecordKey(variant: string, externalId: string) {
  return `PRISM:${variant}:${externalId}`
}

function isLegacyListing(row: PrismListingRow) {
  const marker = cleanText(row.onlineOffline || row.actionName || row.status || '')
  return Boolean(marker && /offline|legacy/i.test(marker))
}

function toStateArray(payload: unknown): string[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.data)
      ? (payload as any).data
      : []

  return Array.from(
    new Set(
      raw
        .map((item: any) => {
          if (typeof item === 'string') {
            return item
          }
          return item?.stateName || item?.STATE_NAME || item?.name || item?.label || item?.value
        })
        .map((state: unknown) => cleanText(state)?.toUpperCase())
        .filter((state: string | null | undefined): state is string => Boolean(state))
    )
  )
}

function responseBodyText(response: AxiosResponse<unknown>) {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {})
}

export class PrismPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'PRISM' as const
  baseUrl = PRISM_BASE_URL

  private readonly client: AxiosInstance
  private readonly cookies = new Map<string, string>()
  private csrfToken: string | null = null
  private csrfHeader: string | null = null
  private sessionReady = false
  private sessionPromise: Promise<void> | null = null
  private lastRequestAt = 0
  private requestSlotQueue: Promise<void> = Promise.resolve()
  private blockedUntil = 0

  constructor(
    private readonly options: {
      userAgent?: string
      requestSpacingMs?: number
      timeoutMs?: number
    } = {}
  ) {
    this.client = axios.create({
      baseURL: PRISM_BASE_URL,
      timeout: options.timeoutMs || 30000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
      },
    })
  }

  async listStates(): Promise<string[]> {
    await this.ensureSession()
    const payload = await this.postForm('/stateNameListSearchBy', {})
    const states = toStateArray(payload)
    if (states.length === 0) {
      throw new Error('PRISM state discovery returned no states')
    }
    return states
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const states = options.states?.length
      ? options.states.map((state) => state.toUpperCase())
      : options.mode === 'pilot'
        ? ['PUNJAB', 'DELHI']
        : await this.listStates()

    let emitted = 0
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 20 : Number.POSITIVE_INFINITY)
    const onlinePerState = options.onlinePerState ?? (options.mode === 'pilot' ? 5 : Number.POSITIVE_INFINITY)
    const legacyPerState = options.legacyPerState ?? (options.mode === 'pilot' ? 5 : Number.POSITIVE_INFINITY)

    for (const state of states) {
      if (emitted >= maxRecords) {
        return
      }

      const rows = await this.getStateListings(state)
      const onlineRows = rows.filter((row) => !isLegacyListing(row)).slice(0, onlinePerState)
      const legacyRows = rows.filter((row) => isLegacyListing(row)).slice(0, legacyPerState)
      const selectedRows = options.mode === 'pilot' ? [...onlineRows, ...legacyRows] : rows

      for (const row of selectedRows) {
        if (emitted >= maxRecords) {
          return
        }

        const discovered = this.toDiscoveredRecord(row, state)
        if (!discovered) {
          continue
        }

        emitted += 1
        yield discovered
      }
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const listing = record.listingPayload as PrismListingRow
    const detail =
      record.sourceVariant === 'legacy'
        ? await this.fetchLegacyDetail(record, listing)
        : await this.fetchOnlineDetail(record, listing)

    return this.normalizeProject(record, listing, detail)
  }

  private async ensureSession() {
    if (this.sessionReady) {
      return
    }
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const response = await this.request('GET', '/Search')
        const html = responseBodyText(response)
        this.csrfToken = metaContent(html, '_csrf')
        this.csrfHeader = metaContent(html, '_csrf_header')

        if (!this.csrfToken || !this.csrfHeader) {
          throw new Error('PRISM search page did not expose CSRF metadata')
        }

        this.sessionReady = true
      })().finally(() => {
        this.sessionPromise = null
      })
    }
    await this.sessionPromise
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
    const slot = this.requestSlotQueue.then(async () => {
      const waitUntil = Math.max(this.lastRequestAt + spacing, this.blockedUntil)
      const delay = waitUntil - Date.now()
      if (delay > 0) {
        await sleep(delay)
      }
      this.lastRequestAt = Date.now()
    })
    this.requestSlotQueue = slot.catch(() => undefined)
    await slot
  }

  private deferRequests(delayMs: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delayMs)
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
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  'X-Requested-With': 'XMLHttpRequest',
                  Referer: SEARCH_URL,
                  ...(this.csrfToken && this.csrfHeader ? { [this.csrfHeader]: this.csrfToken } : {}),
                }
              : {}),
          },
        })

        this.mergeCookies(response)

        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
          const retryAfterSeconds = Number(response.headers['retry-after'] || 0)
          const retryDelay = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000 * 2 ** attempt
          this.deferRequests(retryDelay)
          await sleep(retryDelay)
          continue
        }

        this.assertNotBlocked(response)

        if (response.status >= 400) {
          throw new Error(`PRISM HTTP ${response.status} for ${path}`)
        }

        return response
      } catch (error) {
        if (error instanceof PublicProjectSourceBlockedError) {
          throw error
        }
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
    const isHardBlock = response.status === 403 || response.status === 429
    const looksLikeNormalPrismResponse =
      /<meta[^>]+name=["']_csrf["']/i.test(text) ||
      /stateRelatedProjectDetailsSearchBy|stateNameListSearchBy|projectTitleHeader|onlineProposalForm|SROfflineFileDetailsRelatedToFileNumber/i.test(
        text
      ) ||
      Array.isArray(response.data) ||
      (response.data && typeof response.data === 'object' && ('data' in (response.data as JsonRecord)))
    const isChallengeText = /please\s+verify|captcha\s+required|access\s+challenge|unusual\s+traffic/i.test(text)

    if (isHardBlock || (isChallengeText && !looksLikeNormalPrismResponse)) {
      throw new PublicProjectSourceBlockedError(`PRISM presented an access challenge or rate limit (${response.status})`)
    }
  }

  private async postForm(path: string, body: Record<string, string | number | boolean | null | undefined>) {
    await this.ensureSession()
    const params = new URLSearchParams()
    Object.entries(body).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        params.set(key, String(value))
      }
    })

    const response = await this.request('POST', path, params)
    return parseMaybeJson(response.data)
  }

  private async getStateListings(state: string): Promise<PrismListingRow[]> {
    const payload = await this.postForm('/stateRelatedProjectDetailsSearchBy', {
      stateName: state,
      type: 'accept',
      offlineSearch: 'false',
    })
    const rows = Array.isArray((payload as any)?.data)
      ? (payload as any).data
      : Array.isArray(payload)
        ? payload
        : []

    return rows.filter((row: unknown): row is PrismListingRow => Boolean(row && typeof row === 'object'))
  }

  private toDiscoveredRecord(row: PrismListingRow, state: string): PublicProjectDiscoveredRecord | null {
    const variant = isLegacyListing(row) ? 'legacy' : 'online'
    const externalId =
      cleanText(row.proposalId) ||
      cleanText(row.fileNumber) ||
      cleanText(row.encodedProposalId) ||
      cleanText(row.projectTitle)

    if (!externalId) {
      return null
    }

    const detailPath =
      variant === 'legacy'
        ? `/OfflineProject/SROProposalDetails/${row.encodedProposalId || ''}`
        : `/SRProposalDetails/${row.encodedProposalId || ''}`

    return {
      sourceKey: 'PRISM',
      externalId,
      sourceVariant: variant,
      sourceRecordKey: buildSourceRecordKey(variant, externalId),
      state,
      detailUrl: `${PRISM_BASE_URL}${detailPath}`,
      listingPayload: {
        ...row,
        stateName: state,
      },
    }
  }

  private async fetchOnlineDetail(
    record: PublicProjectDiscoveredRecord,
    listing: PrismListingRow
  ): Promise<PrismDetailPayload> {
    const detailPath = `/SRProposalDetails/${listing.encodedProposalId || ''}`
    const response = await this.request('GET', detailPath)
    const html = responseBodyText(response)
    const decodedProposalId = listing.encodedProposalId ? await this.decodeValue(listing.encodedProposalId) : null

    const extracted = {
      title: nodeTextById(html, 'projectTitleHeader'),
      fileNumber: nodeTextById(html, 'fileNo'),
      projectCost: nodeTextById(html, 'projectCost'),
      startDate: nodeTextById(html, 'projectStartDate'),
      projectStatus: nodeTextById(html, 'projectStatus'),
      profileText: nodeTextById(html, 'profile-expand'),
      projectSummary: nodeTextById(html, 'projectSummaryContentDiv'),
    }

    const auxiliary = decodedProposalId ? await this.fetchOnlineAuxiliary(decodedProposalId) : {}

    return {
      detailUrl: record.detailUrl || `${PRISM_BASE_URL}${detailPath}`,
      variant: 'online',
      html,
      decodedProposalId,
      extracted,
      auxiliary,
    }
  }

  private async fetchLegacyDetail(
    record: PublicProjectDiscoveredRecord,
    listing: PrismListingRow
  ): Promise<PrismDetailPayload> {
    const detailPath = `/OfflineProject/SROProposalDetails/${listing.encodedProposalId || ''}`
    const response = await this.request('GET', detailPath)
    const html = responseBodyText(response)
    const decodedProposalId = listing.encodedProposalId ? await this.decodeValue(listing.encodedProposalId) : null
    const offlineApiPayload = decodedProposalId
      ? asRecord(
          await this.postForm('/OfflineProject/SROfflineFileDetailsRelatedToFileNumber', {
            fileNumber: decodedProposalId,
          })
        )
      : {}

    return {
      detailUrl: record.detailUrl || `${PRISM_BASE_URL}${detailPath}`,
      variant: 'legacy',
      html,
      decodedProposalId,
      offlineApiPayload: parseMaybeJson(offlineApiPayload) as JsonRecord,
    }
  }

  private async decodeValue(encodedValue: string): Promise<string | null> {
    try {
      const payload = await this.postForm('/SRDecodeUserId', {
        userId: encodedValue,
      })
      return (
        cleanText((payload as any)?.decodedValue) ||
        cleanText((payload as any)?.data) ||
        cleanText((payload as any)?.value) ||
        cleanText(payload)
      )
    } catch (error) {
      if (error instanceof PublicProjectSourceBlockedError) {
        throw error
      }
      return null
    }
  }

  private async fetchOnlineAuxiliary(decodedProposalId: string): Promise<JsonRecord> {
    const endpoints: Array<[string, string, Record<string, string>]> = [
      [
        'budget',
        '/rest/proposal/proposalBudgetDetailsYearPROBIS',
        { proposalId: decodedProposalId, pid: decodedProposalId, id: decodedProposalId },
      ],
      [
        'manpowerSanctioned',
        '/rest/proposal/proposalManpowerSanctionedDetailsYearPROBIS',
        { proposalId: decodedProposalId, pid: decodedProposalId, id: decodedProposalId },
      ],
      [
        'manpowerTrained',
        '/rest/proposal/proposalManpowerTrainedDetailsYearPROBIS',
        { proposalId: decodedProposalId, pid: decodedProposalId, id: decodedProposalId },
      ],
      [
        'equipment',
        '/rest/proposal/proposalEquipmentSanctionedDetailsYearPROBIS',
        { proposalId: decodedProposalId, pid: decodedProposalId, id: decodedProposalId },
      ],
      [
        'publications',
        '/OD/Rest/publication/publicationSpecificToProposalV1',
        { proposalId: decodedProposalId, startDate: '-1', endDate: '-1' },
      ],
      [
        'patents',
        '/OD/Rest/patents/patentsSpecificToProposal',
        { proposalId: decodedProposalId, pid: decodedProposalId },
      ],
    ]

    const entries = await Promise.all(
      endpoints.map(async ([key, path, body]) => {
        try {
          return [key, await this.postForm(path, body)] as const
        } catch (error) {
          if (error instanceof PublicProjectSourceBlockedError) {
            throw error
          }
          return [
            key,
            { error: error instanceof Error ? error.message : String(error) },
          ] as const
        }
      })
    )
    const result: JsonRecord = Object.fromEntries(entries)
    return result
  }

  private normalizeProject(
    record: PublicProjectDiscoveredRecord,
    listing: PrismListingRow,
    detail: PrismDetailPayload
  ): NormalizedPublicProject {
    const legacyPayload = asRecord(detail.offlineApiPayload)
    const projectDetails = firstRecord(
      legacyPayload.ProjectDetails || legacyPayload.projectDetails || legacyPayload.ProjectDetail
    )
    const fileDetails = firstRecord(legacyPayload.FileDetails || legacyPayload.fileDetails)
    const piDetails = firstRecord(legacyPayload.PIDetails || legacyPayload.piDetails || legacyPayload.PiDetails)
    const coPiDetails = asArray(legacyPayload.CoPIDetails || legacyPayload.coPIDetails || legacyPayload.copiDetails)
      .map((item) => asRecord(item))
      .filter((item) => Object.keys(item).length > 0)

    const extracted = asRecord(detail.extracted)
    const profileText = cleanText(extracted.profileText)
    const onlineSummary = cleanText(extracted.projectSummary)
    const legacyObjective = pickField(projectDetails, [
      'projectObjective',
      'projectObjectives',
      'objective',
      'objectives',
      'project objective',
      'Project Objective',
    ])
    const legacySummary = pickField(projectDetails, ['projectSummary', 'summary', 'abstract'])
    const title =
      cleanText(extracted.title) ||
      pickField(projectDetails, ['projectTitle', 'title', 'Project Title']) ||
      pickField(fileDetails, ['projectTitle', 'title', 'Project Title']) ||
      cleanText(listing.projectTitle) ||
      record.externalId

    const fileNumber =
      cleanText(extracted.fileNumber) ||
      pickField(fileDetails, ['fileNumber', 'fileNo', 'File Number', 'File No']) ||
      cleanText(listing.fileNumber)

    const piName =
      pickField(piDetails, ['fullPiName', 'piName', 'name', 'fullName', 'investigatorName']) ||
      cleanText(listing.fullPiName)
    const institution =
      pickField(piDetails, ['instituteName', 'institutionName', 'institute', 'organizationName']) ||
      cleanText(listing.instituteName)
    const department = pickField(piDetails, ['departmentName', 'department', 'dept'])
    const city = pickField(piDetails, ['city', 'district'])
    const state = record.state || pickField(piDetails, ['state', 'stateName']) || cleanText((listing as any).stateName)

    const contacts = [
      ...emailContacts(profileText),
      ...phoneContacts(profileText),
      ...emailContacts(JSON.stringify(legacyPayload)),
      ...phoneContacts(JSON.stringify(legacyPayload)),
    ]
    if (profileText && contacts.length > 0) {
      contacts.push({
        contactType: 'address',
        label: 'PRISM profile',
        value: profileText,
      })
    }

    const participants: PublicProjectParticipantInput[] = []
    if (piName) {
      participants.push({
        role: 'PI',
        name: piName,
        institutionName: institution,
        departmentName: department,
        city,
        state,
        country: 'India',
        sourcePayload: Object.keys(piDetails).length > 0 ? piDetails : { source: 'listing' },
      })
    }

    coPiDetails.forEach((coPi) => {
      const name = pickField(coPi, ['name', 'fullName', 'coPiName', 'investigatorName'])
      if (name) {
        participants.push({
          role: 'CO_PI',
          name,
          institutionName: pickField(coPi, ['instituteName', 'institutionName', 'institute', 'organizationName']),
          departmentName: pickField(coPi, ['departmentName', 'department', 'dept']),
          city: pickField(coPi, ['city', 'district']),
          state: pickField(coPi, ['state', 'stateName']) || state,
          country: 'India',
          sourcePayload: coPi,
        })
      }
    })

    const keywords = [
      ...splitKeywords(pickField(projectDetails, ['keyWords', 'keywords', 'keyword'])),
      ...splitKeywords((listing as any).keywords),
    ]

    const abstractText = onlineSummary || legacySummary || legacyObjective
    const budgetAmount =
      parseBudget(listing.budget) ||
      parseBudget(extracted.projectCost) ||
      parseBudget(pickField(projectDetails, ['totalCost', 'totalProjectCost', 'projectCost', 'sanctionedBudget']))

    return {
      sourceKey: 'PRISM',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      fileNumber,
      projectNumber: cleanText(listing.proposalId) || detail.decodedProposalId,
      sourceUrl: SEARCH_URL,
      detailUrl: detail.detailUrl,
      statusText:
        cleanText(extracted.projectStatus) ||
        pickField(fileDetails, ['status', 'projectStatus', 'internalStatus']) ||
        cleanText(listing.status || listing.actionName),
      projectType: detail.variant === 'legacy' ? 'legacy_awarded_project' : 'online_awarded_project',
      programName: cleanText(listing.schemeName),
      schemeName: cleanText(listing.schemeName),
      schemeHierarchy: {
        source: 'PRISM',
        scheme: cleanText(listing.schemeName),
        area: cleanText(listing.areaName),
        subArea: cleanText(listing.subAreaName),
        state,
        variant: record.sourceVariant,
      },
      areaName: cleanText(listing.areaName),
      subAreaName: cleanText(listing.subAreaName),
      title,
      abstractText,
      executiveSummary: onlineSummary && onlineSummary !== abstractText ? onlineSummary : null,
      objectivesText: legacyObjective,
      keywords: Array.from(new Set(keywords)),
      primaryInvestigatorName: piName,
      primaryInstitutionName: institution,
      departmentName: department,
      city,
      state,
      country: 'India',
      sanctionYear: parseYear(listing.yearOfSanction),
      startDate: parseDate(extracted.startDate || pickField(projectDetails, ['startDate', 'projectStartDate'])),
      budgetAmount,
      budgetCurrency: 'INR',
      budgetComponents: detail.auxiliary?.budget || legacyPayload.BudgetDetails || legacyPayload.ProjectBudgetDetails || null,
      manpower:
        detail.auxiliary?.manpowerSanctioned ||
        legacyPayload.ManpowerSanctionedDetails ||
        legacyPayload.ManpowerTrainedDetails ||
        null,
      equipment: detail.auxiliary?.equipment || legacyPayload.EquipmentSanctionedDetails || null,
      publications: detail.auxiliary?.publications || legacyPayload.PublicationDetails || null,
      patents: detail.auxiliary?.patents || legacyPayload.PatentDetails || null,
      outcomes: legacyPayload.OutcomeDetails || legacyPayload.ProjectOutcomeDetails || null,
      rawPayload: {
        listing,
        detail,
      },
      extendedFields: {
        encodedProposalId: listing.encodedProposalId,
        encodedUserId: listing.encodedUserId,
        onlineOffline: listing.onlineOffline,
        decodedProposalId: detail.decodedProposalId,
      },
      participants,
      contacts: this.uniqueContacts(contacts),
    }
  }

  private uniqueContacts(contacts: PublicProjectContactInput[]) {
    const seen = new Set<string>()
    return contacts.filter((contact) => {
      const key = `${contact.contactType}:${contact.value}`.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }
}

export function createPrismPublicProjectConnector() {
  const spacing = Number(process.env.PRISM_REQUEST_SPACING_MS || DEFAULT_REQUEST_SPACING_MS)
  const timeout = Number(process.env.PRISM_REQUEST_TIMEOUT_MS || 30000)
  return new PrismPublicProjectConnector({
    requestSpacingMs: Number.isFinite(spacing) && spacing >= 0 ? spacing : DEFAULT_REQUEST_SPACING_MS,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30000,
  })
}

export const __prismTestables = {
  buildSourceRecordKey,
  cleanText,
  isLegacyListing,
  parseBudget,
  toStateArray,
}
