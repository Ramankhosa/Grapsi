import AdmZip from 'adm-zip'

import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'

import {
  asArray,
  asRecord,
  cleanText,
  createJsonClient,
  firstText,
  numberText,
  parseDate,
  participant,
  getJson,
} from './fundedSourceUtils'

const CORDIS_BASE_URL = 'https://cordis.europa.eu'
const DATA_EUROPA_BASE_URL = 'https://data.europa.eu'
const DEFAULT_DATASET_IDS = ['cordis-eu-research-projects-under-horizon-europe-2021-2027', 'cordish2020projects']
const DEFAULT_REQUEST_SPACING_MS = 1000

type DataEuropaDatasetPayload = {
  result?: {
    id?: string
    title?: Record<string, string>
    distributions?: Array<{
      title?: Record<string, string>
      media_type?: string
      download_url?: string[]
      access_url?: string[]
      modified?: string
      format?: {
        id?: string
      }
    }>
  }
}

function sourceRecordKey(externalId: string) {
  return `CORDIS:${externalId}`
}

function findProjectRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findProjectRows(item))
  }
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return []

  const hasProjectShape = firstText(record.rcn, record.id, record.projectID, record.grantDoi) && firstText(record.title, record.acronym)
  if (hasProjectShape) return [record]

  for (const nested of Object.values(record)) {
    const rows = findProjectRows(nested)
    if (rows.length > 0) return rows
  }
  return []
}

function projectId(row: JsonRecord) {
  return firstText(row.rcn, row.id, row.projectID, row.projectId, row.grantAgreementNumber, row.acronym)
}

function projectStart(row: JsonRecord) {
  return parseDate(firstText(row.startDate, row.start_date, row.start))
}

function projectEnd(row: JsonRecord) {
  return parseDate(firstText(row.endDate, row.end_date, row.end))
}

function coordinator(row: JsonRecord) {
  const relations = asArray(row.relations || row.organizations || row.organisations).map((item) => asRecord(item))
  return relations.find((item) => /coordinator/i.test(cleanText(item.role || item.organizationRole || item.ecContributionRole) || '')) || relations[0] || {}
}

export class CordisPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'CORDIS' as const
  baseUrl = CORDIS_BASE_URL

  private readonly dataEuropaClient = createJsonClient(DATA_EUROPA_BASE_URL, Number(process.env.CORDIS_TIMEOUT_MS || 60000))
  private readonly cordisClient = createJsonClient(CORDIS_BASE_URL, Number(process.env.CORDIS_TIMEOUT_MS || 120000))
  private readonly lastRequestAt = { value: 0 }

  async listStates(): Promise<string[]> {
    return []
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 25 : Number.POSITIVE_INFINITY)
    const startYear = options.startYear || 2015
    const endYear = options.endYear || new Date().getFullYear()
    const datasetIds = DEFAULT_DATASET_IDS
    let emitted = 0

    for (const datasetId of datasetIds) {
      if (emitted >= maxRecords) return
      const dataset = await getJson<DataEuropaDatasetPayload>(
        this.dataEuropaClient,
        'CORDIS data.europa',
        `/api/hub/search/datasets/${encodeURIComponent(datasetId)}?locale=en`,
        Number(process.env.CORDIS_REQUEST_SPACING_MS || DEFAULT_REQUEST_SPACING_MS),
        this.lastRequestAt
      )
      const distribution = dataset.result?.distributions?.find((item) => {
        const title = cleanText(item.title?.en)
        const url = firstText(item.download_url?.[0], item.access_url?.[0])
        return /Projects/i.test(title || '') && /json/i.test(item.media_type || item.format?.id || url || '')
      })
      const downloadUrl = firstText(distribution?.download_url?.[0], distribution?.access_url?.[0])
      if (!downloadUrl) continue

      const zipResponse = await this.cordisClient.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: Number(process.env.CORDIS_DOWNLOAD_TIMEOUT_MS || 180000),
      })
      if (zipResponse.status === 403 || zipResponse.status === 429) {
        throw new Error(`CORDIS data distribution blocked or rate-limited (${zipResponse.status})`)
      }
      if (zipResponse.status >= 400) {
        throw new Error(`CORDIS data distribution HTTP ${zipResponse.status}`)
      }

      const zip = new AdmZip(Buffer.from(zipResponse.data as ArrayBuffer))
      const entries = zip
        .getEntries()
        .filter((entry) => !entry.isDirectory && /\.json$/i.test(entry.entryName))
        .sort((a, b) => a.entryName.localeCompare(b.entryName))

      for (const entry of entries) {
        if (emitted >= maxRecords) return
        let parsed: unknown
        try {
          parsed = JSON.parse(entry.getData().toString('utf8'))
        } catch {
          continue
        }

        for (const row of findProjectRows(parsed)) {
          const start = projectStart(row)
          const year = start?.getFullYear()
          if (year && (year < startYear || year > endYear)) continue

          const externalId = projectId(row)
          if (!externalId) continue
          emitted += 1
          yield {
            sourceKey: 'CORDIS',
            externalId,
            sourceVariant: datasetId,
            sourceRecordKey: sourceRecordKey(externalId),
            detailUrl: firstText(row.projectUrl, row.url, row.website) || `https://cordis.europa.eu/project/id/${encodeURIComponent(externalId)}`,
            listingPayload: {
              datasetId,
              datasetModified: distribution?.modified || null,
              zipEntryName: entry.entryName,
              record: row,
            },
          }
          if (emitted >= maxRecords) return
        }
      }
    }
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    return {
      sourceKey: 'CORDIS',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: CORDIS_BASE_URL,
      detailUrl: record.detailUrl || null,
      fetchedAt: new Date().toISOString(),
      listingPayload: record.listingPayload,
      detailPayload: null,
      rawPayload: record.listingPayload,
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const row = asRecord(record.listingPayload.record) || record.listingPayload
    const lead = coordinator(row)
    const pi = participant('PI', row.principalInvestigator || row.coordinatorName || lead.name || lead.shortName, {
      institutionName: lead.name || lead.legalName || lead.shortName,
      city: lead.city,
      country: lead.country || lead.countryCode,
      sourcePayload: lead,
    })

    return {
      sourceKey: 'CORDIS',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      projectNumber: firstText(row.grantAgreementNumber, row.id, row.rcn),
      sourceUrl: CORDIS_BASE_URL,
      detailUrl: record.detailUrl,
      statusText: cleanText(row.status),
      projectType: cleanText(row.typeOfAction || row.actionType) || 'funded_project',
      programName: cleanText(row.programme || row.frameworkProgramme || row.fundingScheme),
      schemeName: cleanText(row.topic || row.call || row.fundingScheme),
      title: firstText(row.title, row.acronym) || record.externalId,
      abstractText: cleanText(row.objective || row.objectives || row.teaser),
      keywords: asArray(row.euroSciVoc || row.subjects || row.keywords).map((item) => cleanText(item)).filter((item): item is string => Boolean(item)),
      primaryInvestigatorName: cleanText(row.principalInvestigator || row.coordinatorName || lead.name || lead.shortName),
      primaryInstitutionName: cleanText(lead.name || lead.legalName || lead.shortName),
      city: cleanText(lead.city),
      country: cleanText(lead.country || lead.countryCode) || null,
      sanctionYear: projectStart(row)?.getFullYear() || null,
      startDate: projectStart(row),
      endDate: projectEnd(row),
      budgetAmount: numberText(row.ecMaxContribution || row.ecContribution || row.totalCost),
      budgetCurrency: 'EUR',
      budgetComponents: {
        totalCost: row.totalCost ?? null,
        ecMaxContribution: row.ecMaxContribution ?? null,
        ecContribution: row.ecContribution ?? null,
      },
      rawPayload: record.listingPayload,
      extendedFields: {
        rawIngestionOnly: true,
        acronym: row.acronym,
        call: row.call,
        topic: row.topic,
        datasetId: record.sourceVariant,
        datasetModified: record.listingPayload.datasetModified,
      },
      participants: pi ? [pi] : [],
    }
  }
}

export function createCordisPublicProjectConnector() {
  return new CordisPublicProjectConnector()
}
