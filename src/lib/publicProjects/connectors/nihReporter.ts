import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'

import {
  asRecord,
  cleanText,
  createJsonClient,
  dateYear,
  firstText,
  numberText,
  parseDate,
  participant,
  postJson,
  splitKeywords,
} from './fundedSourceUtils'

const NIH_BASE_URL = 'https://api.reporter.nih.gov'
const SEARCH_PATH = '/v2/projects/search'
const REPORTER_SEARCH_URL = 'https://reporter.nih.gov/search'
const DEFAULT_REQUEST_SPACING_MS = 1000

type NihSearchPayload = {
  meta?: {
    total?: number
    offset?: number
    limit?: number
    search_id?: string
    properties?: JsonRecord
  }
  results?: JsonRecord[]
}

function yearRange(options: PublicProjectDiscoveryOptions) {
  if (options.fiscalYears?.length) {
    return Array.from(new Set(options.fiscalYears)).sort((a, b) => b - a)
  }
  const currentYear = new Date().getFullYear()
  const start = options.startYear || 2015
  const end = options.endYear || currentYear
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => end - index)
}

function sourceRecordKey(externalId: string) {
  return `NIH_REPORTER:${externalId}`
}

function org(record: JsonRecord) {
  return asRecord(record.organization)
}

function contactPi(record: JsonRecord) {
  const pis = Array.isArray(record.principal_investigators) ? record.principal_investigators : []
  return asRecord(pis.find((pi: any) => pi?.is_contact_pi) || pis[0])
}

function nihDetailUrl(record: JsonRecord) {
  return firstText(record.project_detail_url) || (record.appl_id ? `https://reporter.nih.gov/project-details/${record.appl_id}` : null)
}

export class NihReporterPublicProjectConnector implements PublicProjectConnector {
  sourceKey = 'NIH_REPORTER' as const
  baseUrl = NIH_BASE_URL

  private readonly client = createJsonClient(NIH_BASE_URL, Number(process.env.NIH_REPORTER_TIMEOUT_MS || 30000))
  private readonly lastRequestAt = { value: 0 }

  async listStates(): Promise<string[]> {
    return []
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 25 : Number.POSITIVE_INFINITY)
    const pageSize = Math.min(Math.max(options.pageSize || 100, 1), 500)
    let emitted = 0

    for (const fiscalYear of yearRange(options)) {
      let offset = 0
      while (emitted < maxRecords && offset <= 14999) {
        const remaining = Number.isFinite(maxRecords) ? Math.min(pageSize, maxRecords - emitted) : pageSize
        const payload = await postJson<NihSearchPayload>(
          this.client,
          'NIH RePORTER',
          SEARCH_PATH,
          {
            criteria: {
              fiscal_years: [fiscalYear],
              ...(options.includeActiveProjects ? { include_active_projects: true } : {}),
            },
            offset,
            limit: remaining,
            sort_field: 'project_start_date',
            sort_order: 'desc',
          },
          Number(process.env.NIH_REPORTER_REQUEST_SPACING_MS || DEFAULT_REQUEST_SPACING_MS),
          this.lastRequestAt
        )

        const rows = Array.isArray(payload.results) ? payload.results : []
        if (rows.length === 0) break

        for (const row of rows) {
          const externalId = firstText(row.appl_id, row.project_num, row.core_project_num)
          if (!externalId) continue
          emitted += 1
          yield {
            sourceKey: 'NIH_REPORTER',
            externalId,
            sourceVariant: `fy_${fiscalYear}`,
            sourceRecordKey: sourceRecordKey(externalId),
            state: cleanText(org(row).org_state),
            detailUrl: nihDetailUrl(row),
            listingPayload: {
              fiscalYear,
              searchMeta: payload.meta || null,
              record: row,
            },
          }
          if (emitted >= maxRecords) return
        }

        offset += rows.length
        if (payload.meta?.total !== undefined && offset >= Number(payload.meta.total)) break
      }
    }
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    return {
      sourceKey: 'NIH_REPORTER',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: REPORTER_SEARCH_URL,
      detailUrl: record.detailUrl || null,
      fetchedAt: new Date().toISOString(),
      listingPayload: record.listingPayload,
      detailPayload: null,
      rawPayload: record.listingPayload,
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const row = asRecord(record.listingPayload.record) || record.listingPayload
    const organization = org(row)
    const pi = contactPi(row)
    const piName = firstText(pi.full_name, row.contact_pi_name)
    const piParticipant = participant('PI', piName, {
      institutionName: organization.org_name,
      city: organization.org_city || organization.city,
      state: organization.org_state,
      country: organization.org_country || organization.country || 'United States',
      sourcePayload: pi,
    })

    return {
      sourceKey: 'NIH_REPORTER',
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      projectNumber: firstText(row.project_num, row.core_project_num),
      sourceUrl: REPORTER_SEARCH_URL,
      detailUrl: record.detailUrl || nihDetailUrl(row),
      statusText: row.is_active === true ? 'active' : 'inactive',
      projectType: 'funded_project',
      programName: firstText(asRecord(row.agency_ic_admin).name, row.funding_mechanism),
      schemeName: firstText(row.activity_code, row.funding_mechanism),
      title: firstText(row.project_title, row.title) || record.externalId,
      abstractText: cleanText(row.abstract_text),
      executiveSummary: cleanText(row.phr_text),
      keywords: [...splitKeywords(row.pref_terms), ...splitKeywords(row.terms)].slice(0, 200),
      primaryInvestigatorName: piName,
      primaryInstitutionName: cleanText(organization.org_name),
      departmentName: cleanText(organization.dept_type),
      city: cleanText(organization.org_city || organization.city),
      state: cleanText(organization.org_state),
      country: cleanText(organization.org_country || organization.country) || 'United States',
      sanctionYear: Number(row.fiscal_year || dateYear(row.award_notice_date) || null) || null,
      startDate: parseDate(row.project_start_date || row.budget_start),
      endDate: parseDate(row.project_end_date || row.budget_end),
      budgetAmount: numberText(row.award_amount),
      budgetCurrency: 'USD',
      budgetComponents: {
        awardAmount: row.award_amount ?? null,
        directCost: row.direct_cost_amt ?? null,
        indirectCost: row.indirect_cost_amt ?? null,
        agencyIcFundings: row.agency_ic_fundings ?? null,
      },
      rawPayload: record.listingPayload,
      extendedFields: {
        rawIngestionOnly: true,
        applId: row.appl_id,
        coreProjectNum: row.core_project_num,
        agencyCode: row.agency_code,
        opportunityNumber: row.opportunity_number,
        awardNoticeDate: row.award_notice_date,
      },
      participants: piParticipant ? [piParticipant] : [],
    }
  }
}

export function createNihReporterPublicProjectConnector() {
  return new NihReporterPublicProjectConnector()
}
