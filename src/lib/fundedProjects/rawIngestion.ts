import crypto from 'node:crypto'

import axios, { type AxiosInstance } from 'axios'

import { prisma } from '@/lib/prisma'

export const FUNDED_PROJECT_RAW_SOURCE_NAMES = [
  'NIH_REPORTER',
  'NSF_AWARD_SEARCH',
  'CORDIS',
  'UKRI_GTR',
  'NWO_NWOPEN',
] as const

export type FundedProjectRawSourceName = (typeof FUNDED_PROJECT_RAW_SOURCE_NAMES)[number]

export interface FundedProjectRawIngestionOptions {
  sinceYear?: number
  fromYear?: number
  toYear?: number
  maxPerSource?: number
  maxRecordsPerSource?: number
  pageSize?: number
  requestTimeoutMs?: number
  sources?: FundedProjectRawSourceName[]
}

interface RawFundedProjectRecord {
  sourceName: FundedProjectRawSourceName
  sourceCountry?: string | null
  sourceAgency?: string | null
  sourceProjectId: string
  sourceUrl?: string | null
  projectTitle?: string | null
  projectAbstract?: string | null
  projectObjectives?: string | null
  principalInvestigator?: string | null
  leadInstitution?: string | null
  fundingProgram?: string | null
  fundingScheme?: string | null
  startDate?: Date | null
  endDate?: Date | null
  fiscalYear?: number | null
  rawPayload: Record<string, unknown>
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text && text !== '-' && !/^null$/i.test(text) ? text : null
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : []
}

function parseDate(value: unknown): Date | null {
  const text = cleanText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseEpochDate(value: unknown): Date | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const date = new Date(numeric)
  return Number.isNaN(date.getTime()) ? null : date
}

function contentHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? {})).digest('hex')
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback
}

function currentNihFiscalYear(now = new Date()) {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
}

function sinceYear(options: FundedProjectRawIngestionOptions) {
  return options.fromYear ?? options.sinceYear ?? 2015
}

function throughYear(options: FundedProjectRawIngestionOptions, fallback = new Date().getUTCFullYear()) {
  return options.toYear ?? fallback
}

function yearRange(sinceYear: number, throughYear = new Date().getUTCFullYear()) {
  const start = boundedInteger(sinceYear, 2015, 1970, throughYear + 1)
  return Array.from({ length: throughYear - start + 1 }, (_, index) => start + index)
}

function sourceLimit(options: FundedProjectRawIngestionOptions) {
  return boundedInteger(options.maxRecordsPerSource ?? options.maxPerSource, 100, 1, 100000)
}

function sourcePageSize(options: FundedProjectRawIngestionOptions, max = 500) {
  return boundedInteger(options.pageSize, 25, 1, max)
}

function makeClient(timeoutMs: number | undefined): AxiosInstance {
  return axios.create({
    timeout: boundedInteger(timeoutMs, 30000, 1000, 120000),
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent':
        'GrapsiFundedProjectRawIngestion/1.0 (+https://grapsi.ai; raw public funded-project indexing)',
      Accept: 'application/json',
    },
  })
}

async function requestJson(client: AxiosInstance, config: Parameters<AxiosInstance['request']>[0]) {
  const response = await client.request(config)
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status} from ${config.url}`)
  }
  return response.data
}

function contactPi(project: Record<string, any>) {
  return (
    asArray(project.principal_investigators).map(asRecord).find((pi) => pi.is_contact_pi === true) ||
    asRecord(asArray(project.principal_investigators)[0])
  )
}

function personName(person: Record<string, any>) {
  return cleanText(person.full_name) || [person.first_name, person.middle_name, person.last_name].map(cleanText).filter(Boolean).join(' ') || null
}

async function fetchNihReporter(client: AxiosInstance, options: FundedProjectRawIngestionOptions): Promise<RawFundedProjectRecord[]> {
  const records: RawFundedProjectRecord[] = []
  const limit = sourceLimit(options)
  const pageSize = sourcePageSize(options, 500)
  const fiscalYears = yearRange(sinceYear(options), throughYear(options, currentNihFiscalYear()))

  for (const fiscalYear of fiscalYears) {
    let offset = 0
    while (records.length < limit && offset <= 14999) {
      const payload = asRecord(
        await requestJson(client, {
          method: 'POST',
          url: 'https://api.reporter.nih.gov/v2/projects/search',
          data: {
            criteria: { fiscal_years: [fiscalYear], include_active_projects: false },
            include_fields: [
              'ApplId',
              'FiscalYear',
              'ProjectNum',
              'CoreProjectNum',
              'ProjectTitle',
              'AbstractText',
              'PublicHealthRelevance',
              'AwardAmount',
              'AgencyIcAdmin',
              'AgencyIcFundings',
              'Organization',
              'PrincipalInvestigators',
              'ProgramOfficers',
              'ProjectStartDate',
              'ProjectEndDate',
              'BudgetStart',
              'BudgetEnd',
              'ProjectDetailUrl',
              'AwardNoticeDate',
              'ActivityCode',
              'FundingMechanism',
              'OpportunityNumber',
            ],
            offset,
            limit: pageSize,
            sort_field: 'appl_id',
            sort_order: 'asc',
          },
          headers: { 'Content-Type': 'application/json' },
        })
      )
      const rows = asArray(payload.results).map(asRecord)
      if (rows.length === 0) break

      for (const row of rows) {
        if (records.length >= limit) break
        const applId = cleanText(row.appl_id)
        if (!applId) continue
        const org = asRecord(row.organization)
        const agency = asRecord(row.agency_ic_admin)
        const pi = contactPi(row)
        records.push({
          sourceName: 'NIH_REPORTER',
          sourceCountry: cleanText(org.org_country) || 'United States',
          sourceAgency: cleanText(agency.abbreviation) || cleanText(agency.code) || 'NIH',
          sourceProjectId: applId,
          sourceUrl: cleanText(row.project_detail_url) || `https://reporter.nih.gov/project-details/${applId}`,
          projectTitle: cleanText(row.project_title),
          projectAbstract: cleanText(row.abstract_text),
          projectObjectives: cleanText(row.public_health_relevance),
          principalInvestigator: personName(pi),
          leadInstitution: cleanText(org.org_name),
          fundingProgram: cleanText(agency.name) || cleanText(agency.abbreviation),
          fundingScheme: cleanText(row.activity_code) || cleanText(row.funding_mechanism),
          startDate: parseDate(row.project_start_date),
          endDate: parseDate(row.project_end_date),
          fiscalYear: Number(row.fiscal_year) || fiscalYear,
          rawPayload: {
            provider: 'NIH RePORTER Project API v2',
            meta: payload.meta || null,
            row,
          },
        })
      }

      if (rows.length < pageSize) break
      offset += pageSize
    }
  }

  return records
}

async function fetchNsfAwards(client: AxiosInstance, options: FundedProjectRawIngestionOptions): Promise<RawFundedProjectRecord[]> {
  const records: RawFundedProjectRecord[] = []
  const limit = sourceLimit(options)
  const pageSize = Math.min(sourcePageSize(options, 100), 25)
  const currentYear = throughYear(options)
  const dateStart = `01/01/${sinceYear(options)}`
  const dateEnd = `12/31/${currentYear}`
  let offset = 0

  while (records.length < limit) {
    const payload = asRecord(
      await requestJson(client, {
        url: `https://www.research.gov/awardapi-service/v1/awards.json?offset=${offset + 1}&rpp=${pageSize}&dateStart=${encodeURIComponent(
          dateStart
        )}&dateEnd=${encodeURIComponent(dateEnd)}`,
      })
    )
    const response = asRecord(payload.response)
    const rows = asArray(response.award).map(asRecord)
    if (rows.length === 0) break

    for (const row of rows) {
      if (records.length >= limit) break
      const awardId = cleanText(row.id)
      if (!awardId) continue
      const startDate = parseDate(row.startDate || row.date)
      records.push({
        sourceName: 'NSF_AWARD_SEARCH',
        sourceCountry: cleanText(row.awardeeCountryCode) || 'United States',
        sourceAgency: 'NSF',
        sourceProjectId: awardId,
        sourceUrl: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${awardId}`,
        projectTitle: cleanText(row.title),
        projectAbstract: cleanText(row.abstractText),
        principalInvestigator: cleanText(row.pdPIName) || cleanText([row.piFirstName, row.piLastName].filter(Boolean).join(' ')),
        leadInstitution: cleanText(row.awardeeName),
        fundingProgram: cleanText(row.fundProgramName),
        fundingScheme: cleanText(row.program),
        startDate,
        endDate: parseDate(row.expDate),
        fiscalYear: startDate?.getFullYear() || null,
        rawPayload: { provider: 'NSF Awards API', row },
      })
    }

    offset += rows.length
  }

  return records
}

function cordisHits(payload: unknown): Record<string, any>[] {
  const hits = asRecord(asRecord(asRecord(payload).result).hits).hit
  return asArray(hits)
    .map((hit) => asRecord(hit).project || hit)
    .map(asRecord)
    .filter((project) => Object.keys(project).length > 0)
}

function cordisCoordinator(row: Record<string, any>) {
  const organizations = asArray(asRecord(asRecord(row.relations).associations).organization).map(asRecord)
  const coordinator = organizations.find((organization) => cleanText(asRecord(organization['@attributes']).type) === 'coordinator')
  return cleanText(coordinator?.legalName) || cleanText(coordinator?.shortName)
}

async function fetchCordis(client: AxiosInstance, options: FundedProjectRawIngestionOptions): Promise<RawFundedProjectRecord[]> {
  const records: RawFundedProjectRecord[] = []
  const limit = sourceLimit(options)
  const pageSize = sourcePageSize(options, 100)
  const frameworks = ['HORIZON', 'H2020']

  for (const framework of frameworks) {
    let page = 1
    while (records.length < limit) {
      const url = new URL('https://cordis.europa.eu/search')
      url.searchParams.set('q', `contenttype='project' AND frameworkProgramme='${framework}'`)
      url.searchParams.set('p', String(page))
      url.searchParams.set('num', String(Math.min(pageSize, limit - records.length)))
      url.searchParams.set('format', 'json')

      const payload = await requestJson(client, { url: url.toString() })
      const rows = cordisHits(payload)
      if (rows.length === 0) break

      for (const row of rows) {
        if (records.length >= limit) break
        const id = cleanText(row.id || row.rcn || row.projectID)
        const startDate = parseDate(row.startDate || row.start_date)
        const fromYear = sinceYear(options)
        if (startDate && startDate.getUTCFullYear() < fromYear) continue

        records.push({
          sourceName: 'CORDIS',
          sourceCountry: 'European Union',
          sourceAgency: 'European Commission CORDIS',
          sourceProjectId: id || contentHash(row).slice(0, 16),
          sourceUrl: id ? `https://cordis.europa.eu/project/id/${encodeURIComponent(id)}` : cleanText(row.projectUrl || row.url),
          projectTitle: cleanText(row.title || row.acronym),
          projectAbstract: cleanText(row.teaser || row.objective || row.description),
          projectObjectives: cleanText(row.objective),
          principalInvestigator: null,
          leadInstitution: cordisCoordinator(row),
          fundingProgram: cleanText(row.programme || row.frameworkProgramme || framework),
          fundingScheme: cleanText(row.fundingScheme),
          startDate,
          endDate: parseDate(row.endDate || row.end_date),
          fiscalYear: startDate?.getFullYear() || Number(row.year) || null,
          rawPayload: { provider: 'CORDIS public search JSON', row },
        })
      }

      page += 1
    }
  }

  return records
}

function ukriReference(project: unknown): string | null {
  const identifiers = asArray(asRecord(asRecord(project).identifiers).identifier).map(asRecord)
  return cleanText(identifiers.find((identifier) => cleanText(identifier.type) === 'RCUK')?.value) || cleanText(asRecord(project).grantReference)
}

function ukriLeadInstitution(project: unknown): string | null {
  const participants = asArray(asRecord(asRecord(project).participantValues).participant).map(asRecord)
  return (
    cleanText(participants.find((participant) => cleanText(participant.role) === 'LEAD_PARTICIPANT')?.organisationName) ||
    cleanText(asRecord(project).leadOrganisationDepartment)
  )
}

async function fetchUkri(client: AxiosInstance, options: FundedProjectRawIngestionOptions): Promise<RawFundedProjectRecord[]> {
  const records: RawFundedProjectRecord[] = []
  const limit = sourceLimit(options)
  const pageSize = sourcePageSize(options, 100)
  let page = 1

  while (records.length < limit) {
    const payload = asRecord(
      await requestJson(client, {
        url: `https://gtr.ukri.org/gtr/api/projects?p=${page}&s=${pageSize}`,
        headers: { Accept: 'application/vnd.rcuk.gtr.json-v7' },
      })
    )
    const rows = asArray(payload.project || asRecord(payload.projects).project).map(asRecord)
    if (rows.length === 0) break

    for (const row of rows) {
      if (records.length >= limit) break
      const reference = ukriReference(row) || cleanText(row.id) || contentHash(row).slice(0, 16)
      const fundLink = asArray(asRecord(row.links).link).map(asRecord).find((link) => cleanText(link.rel) === 'FUND')
      const startDate = parseEpochDate(fundLink?.start || row.start)
      const endDate = parseEpochDate(fundLink?.end || row.end)
      records.push({
        sourceName: 'UKRI_GTR',
        sourceCountry: 'United Kingdom',
        sourceAgency: cleanText(row.leadFunder) || 'UKRI',
        sourceProjectId: reference,
        sourceUrl: cleanText(row.href) || cleanText(row.resourceUrl)?.replace('/api/projects', '/projects'),
        projectTitle: cleanText(row.title),
        projectAbstract: cleanText(row.abstractText),
        projectObjectives: cleanText(row.techAbstractText || row.potentialImpact),
        leadInstitution: ukriLeadInstitution(row),
        fundingProgram: cleanText(row.leadFunder),
        fundingScheme: cleanText(row.grantCategory),
        startDate,
        endDate,
        fiscalYear: startDate?.getFullYear() || null,
        rawPayload: { provider: 'UKRI Gateway to Research API', row },
      })
    }

    page += 1
  }

  return records
}

async function fetchNwo(client: AxiosInstance, options: FundedProjectRawIngestionOptions): Promise<RawFundedProjectRecord[]> {
  const url = new URL(process.env.NWO_NWOPEN_PROJECTS_URL || 'https://nwopen-api.nwo.nl/NWOpen-API/api/Projects')
  if (!process.env.NWO_NWOPEN_PROJECTS_URL && !url.searchParams.has('summary')) {
    url.searchParams.set('summary', process.env.NWO_NWOPEN_SUMMARY_QUERY || 'research')
  }
  const payload = await requestJson(client, { url: url.toString() })
  const rows = asArray(asRecord(payload).results || asRecord(payload).items || asRecord(payload).data || payload).map(asRecord)
  return rows.slice(0, sourceLimit(options)).map((row) => {
    const id = cleanText(row.id || row.projectId || row.grantNumber) || contentHash(row).slice(0, 16)
    const startDate = parseDate(row.startDate || row.start_date)
    return {
      sourceName: 'NWO_NWOPEN',
      sourceCountry: 'Netherlands',
      sourceAgency: 'NWO',
      sourceProjectId: id,
      sourceUrl: cleanText(row.url || row.projectUrl),
      projectTitle: cleanText(row.title || row.projectTitle),
      projectAbstract: cleanText(row.summary || row.abstract || row.description),
      principalInvestigator: cleanText(row.principalInvestigator || row.projectLeader),
      leadInstitution: cleanText(row.institution || row.organisation || row.organization),
      fundingProgram: cleanText(row.programme || row.program),
      fundingScheme: cleanText(row.scheme || row.call),
      startDate,
      endDate: parseDate(row.endDate || row.end_date),
      fiscalYear: startDate?.getFullYear() || Number(row.year) || null,
      rawPayload: { provider: 'NWO NWOpen API', row },
    }
  })
}

async function upsertRawRecord(record: RawFundedProjectRecord) {
  const hash = contentHash(record.rawPayload)
  return prisma.$executeRawUnsafe(
    `
      INSERT INTO funded_project_raw_sources (
        id,
        source_name,
        source_country,
        source_agency,
        source_project_id,
        source_url,
        project_title,
        project_abstract,
        project_objectives,
        principal_investigator,
        lead_institution,
        funding_program,
        funding_scheme,
        start_date,
        end_date,
        fiscal_year,
        raw_payload_json,
        content_hash,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, NOW(), NOW(), NOW(), NOW()
      )
      ON CONFLICT (source_name, source_project_id)
      DO UPDATE SET
        source_country = EXCLUDED.source_country,
        source_agency = EXCLUDED.source_agency,
        source_url = EXCLUDED.source_url,
        project_title = EXCLUDED.project_title,
        project_abstract = EXCLUDED.project_abstract,
        project_objectives = EXCLUDED.project_objectives,
        principal_investigator = EXCLUDED.principal_investigator,
        lead_institution = EXCLUDED.lead_institution,
        funding_program = EXCLUDED.funding_program,
        funding_scheme = EXCLUDED.funding_scheme,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        fiscal_year = EXCLUDED.fiscal_year,
        raw_payload_json = EXCLUDED.raw_payload_json,
        content_hash = EXCLUDED.content_hash,
        last_seen_at = NOW(),
        updated_at = NOW()
    `,
    crypto.randomUUID(),
    record.sourceName,
    record.sourceCountry || null,
    record.sourceAgency || null,
    record.sourceProjectId,
    record.sourceUrl || null,
    record.projectTitle || null,
    record.projectAbstract || null,
    record.projectObjectives || null,
    record.principalInvestigator || null,
    record.leadInstitution || null,
    record.fundingProgram || null,
    record.fundingScheme || null,
    record.startDate || null,
    record.endDate || null,
    record.fiscalYear || null,
    JSON.stringify(record.rawPayload),
    hash
  )
}

async function fetchSource(
  source: FundedProjectRawSourceName,
  client: AxiosInstance,
  options: FundedProjectRawIngestionOptions
) {
  switch (source) {
    case 'NIH_REPORTER':
      return fetchNihReporter(client, options)
    case 'NSF_AWARD_SEARCH':
      return fetchNsfAwards(client, options)
    case 'CORDIS':
      return fetchCordis(client, options)
    case 'UKRI_GTR':
      return fetchUkri(client, options)
    case 'NWO_NWOPEN':
      return fetchNwo(client, options)
    default:
      return []
  }
}

export async function ingestFundedProjectRawSources(options: FundedProjectRawIngestionOptions = {}) {
  const sources = options.sources?.length ? options.sources : [...FUNDED_PROJECT_RAW_SOURCE_NAMES]
  const client = makeClient(options.requestTimeoutMs)
  const result: Record<string, { fetched: number; upserted: number; error?: string }> = {}

  for (const source of sources) {
    try {
      const records = await fetchSource(source, client, options)
      for (const record of records) {
        await upsertRawRecord(record)
      }
      result[source] = { fetched: records.length, upserted: records.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[funded-project-raw] ${source} failed or was blocked/rate-limited; continuing with remaining sources: ${message}`)
      result[source] = {
        fetched: 0,
        upserted: 0,
        error: message,
      }
    }
  }

  return result
}

export const runFundedProjectRawIngestion = ingestFundedProjectRawSources

export const __fundedProjectRawIngestionTestables = {
  cleanText,
  cordisHits,
  contentHash,
  currentNihFiscalYear,
  ukriLeadInstitution,
  ukriReference,
}
