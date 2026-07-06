import type {
  JsonRecord,
  NormalizedPublicProject,
  PublicProjectConnector,
  PublicProjectDiscoveredRecord,
  PublicProjectDiscoveryOptions,
  PublicProjectRawRecord,
} from '@/lib/publicProjects/types'
import type { PublicProjectSourceKey } from '@/lib/prisma-generated'

import {
  asArray,
  asRecord,
  cleanText,
  createJsonClient,
  firstText,
  parseDate,
  participant,
  getJson,
} from './fundedSourceUtils'

const NWO_BASE_URL = 'https://nwopen-api.nwo.nl/NWOpen-API/api'
const NWO_PROJECTS_URL = `${NWO_BASE_URL}/Projects`
const DEFAULT_REQUEST_SPACING_MS = 1000
const NWO_SOURCE_KEY = 'NWO' as unknown as PublicProjectSourceKey

type NwoPayload = {
  meta?: {
    count?: number
    per_page?: number
    pages?: number
    page?: number
    release_date?: string
  }
  projects?: JsonRecord[]
}

function sourceRecordKey(externalId: string) {
  return `NWO:${externalId}`
}

function memberName(member: JsonRecord) {
  return [member.degree_pre_nominal, member.first_name, member.prefix, member.last_name].map((item) => cleanText(item)).filter(Boolean).join(' ')
}

function projectMembers(row: JsonRecord) {
  return asArray(row.project_members).map((item) => asRecord(item))
}

function leadMember(row: JsonRecord) {
  const members = projectMembers(row)
  return (
    members.find((member) => /main applicant|project leader/i.test(cleanText(member.role) || '') && member.active !== false) ||
    members.find((member) => member.active !== false) ||
    members[0] ||
    {}
  )
}

export class NwoPublicProjectConnector implements PublicProjectConnector {
  sourceKey = NWO_SOURCE_KEY
  baseUrl = NWO_BASE_URL

  private readonly client = createJsonClient(NWO_BASE_URL, Number(process.env.NWO_TIMEOUT_MS || 60000))
  private readonly lastRequestAt = { value: 0 }

  async listStates(): Promise<string[]> {
    return []
  }

  async *discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord> {
    const maxRecords = options.maxRecords ?? (options.mode === 'pilot' ? 25 : Number.POSITIVE_INFINITY)
    const pageSize = Math.min(Math.max(options.pageSize || 100, 1), 100)
    const startYear = options.startYear || 2015
    const endYear = options.endYear || new Date().getFullYear()
    let emitted = 0
    let page = 1

    while (emitted < maxRecords) {
      const payload = await getJson<NwoPayload>(
        this.client,
        'NWO NWOpen',
        `/Projects?page=${page}&per_page=${pageSize}`,
        Number(process.env.NWO_REQUEST_SPACING_MS || DEFAULT_REQUEST_SPACING_MS),
        this.lastRequestAt
      )
      const rows = Array.isArray(payload.projects) ? payload.projects : []
      if (rows.length === 0) break

      for (const row of rows) {
        const start = parseDate(row.start_date)
        const year = start?.getFullYear()
        if (year && (year < startYear || year > endYear)) continue
        const externalId = firstText(row.project_id)
        if (!externalId) continue
        emitted += 1
        yield {
          sourceKey: NWO_SOURCE_KEY,
          externalId,
          sourceVariant: `${startYear}_${endYear}`,
          sourceRecordKey: sourceRecordKey(externalId),
          detailUrl: `https://www.nwo.nl/en/projects/${encodeURIComponent(externalId)}`,
          listingPayload: {
            page,
            meta: payload.meta || null,
            record: row,
          },
        }
        if (emitted >= maxRecords) return
      }

      page += 1
      const totalPages = Number(payload.meta?.pages || 0)
      if (totalPages > 0 && page > totalPages) break
    }
  }

  async fetchRaw(record: PublicProjectDiscoveredRecord): Promise<PublicProjectRawRecord> {
    return {
      sourceKey: NWO_SOURCE_KEY,
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      sourceUrl: NWO_PROJECTS_URL,
      detailUrl: record.detailUrl || null,
      fetchedAt: new Date().toISOString(),
      listingPayload: record.listingPayload,
      detailPayload: null,
      rawPayload: record.listingPayload,
    }
  }

  async fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject> {
    const row = asRecord(record.listingPayload.record) || record.listingPayload
    const lead = leadMember(row)
    const leadParticipant = participant('PI', memberName(lead), {
      institutionName: lead.organisation,
      country: 'Netherlands',
      sourcePayload: lead,
    })
    const additionalMembers = projectMembers(row)
      .filter((member) => member !== lead)
      .map((member) =>
        participant(/co-applicant/i.test(cleanText(member.role) || '') ? 'CO_PI' : 'TEAM_MEMBER', memberName(member), {
          institutionName: member.organisation,
          country: 'Netherlands',
          sourcePayload: member,
        })
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    return {
      sourceKey: NWO_SOURCE_KEY,
      externalId: record.externalId,
      sourceVariant: record.sourceVariant,
      sourceRecordKey: record.sourceRecordKey,
      projectNumber: record.externalId,
      sourceUrl: NWO_PROJECTS_URL,
      detailUrl: record.detailUrl,
      projectType: 'funded_project',
      programName: cleanText(row.department),
      schemeName: cleanText(row.funding_scheme),
      areaName: cleanText(row.sub_department),
      title: firstText(row.title) || record.externalId,
      abstractText: cleanText(row.summary_en || row.summary_nl),
      primaryInvestigatorName: memberName(lead) || null,
      primaryInstitutionName: cleanText(lead.organisation),
      country: 'Netherlands',
      sanctionYear: Number(row.reporting_year || parseDate(row.start_date)?.getFullYear() || null) || null,
      startDate: parseDate(row.start_date),
      endDate: parseDate(row.end_date),
      publications: row.products || null,
      rawPayload: record.listingPayload,
      extendedFields: {
        rawIngestionOnly: true,
        fundingSchemeId: row.funding_scheme_id,
        department: row.department,
        subDepartment: row.sub_department,
        reportingYear: row.reporting_year,
        apiReleaseDate: asRecord(record.listingPayload.meta).release_date,
      },
      participants: [...(leadParticipant ? [leadParticipant] : []), ...additionalMembers],
    }
  }
}

export function createNwoPublicProjectConnector() {
  return new NwoPublicProjectConnector()
}
