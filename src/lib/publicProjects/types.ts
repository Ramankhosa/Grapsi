import type {
  PublicProjectCrawlMode,
  PublicProjectParticipantRole,
  PublicProjectSourceKey,
} from '@/lib/prisma-generated'

export type JsonRecord = Record<string, any>

export interface PublicProjectContactInput {
  contactType: 'email' | 'phone' | 'address' | string
  label?: string | null
  value: string
  sourcePayload?: JsonRecord | null
}

export interface PublicProjectParticipantInput {
  role: PublicProjectParticipantRole
  name: string
  institutionName?: string | null
  departmentName?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  sourcePayload?: JsonRecord | null
}

export interface NormalizedPublicProject {
  sourceKey: PublicProjectSourceKey
  externalId: string
  sourceVariant: string
  sourceRecordKey: string
  fileNumber?: string | null
  projectNumber?: string | null
  sourceUrl?: string | null
  detailUrl?: string | null
  statusText?: string | null
  projectType?: string | null
  programName?: string | null
  schemeName?: string | null
  schemeHierarchy?: JsonRecord | null
  category?: string | null
  theme?: string | null
  discipline?: string | null
  areaName?: string | null
  subAreaName?: string | null
  title: string
  abstractText?: string | null
  executiveSummary?: string | null
  objectivesText?: string | null
  milestonesText?: string | null
  deliverablesText?: string | null
  outputPlannedText?: string | null
  outputAchievedText?: string | null
  keywords?: string[]
  primaryInvestigatorName?: string | null
  primaryInstitutionName?: string | null
  departmentName?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  sanctionYear?: number | null
  startDate?: Date | null
  endDate?: Date | null
  durationMonths?: number | null
  budgetAmount?: string | number | null
  budgetCurrency?: string | null
  budgetComponents?: JsonRecord | unknown[] | null
  manpower?: JsonRecord | unknown[] | null
  equipment?: JsonRecord | unknown[] | null
  publications?: JsonRecord | unknown[] | null
  patents?: JsonRecord | unknown[] | null
  outcomes?: JsonRecord | unknown[] | null
  rawPayload?: JsonRecord | null
  extendedFields?: JsonRecord | null
  participants?: PublicProjectParticipantInput[]
  contacts?: PublicProjectContactInput[]
}

export interface PublicProjectDiscoveredRecord {
  sourceKey: PublicProjectSourceKey
  externalId: string
  sourceVariant: string
  sourceRecordKey: string
  state?: string | null
  detailUrl?: string | null
  listingPayload: JsonRecord
}

export interface PublicProjectDiscoveryOptions {
  mode: PublicProjectCrawlMode
  states?: string[]
  maxRecords?: number
  onlinePerState?: number
  legacyPerState?: number
  skipExisting?: boolean
}

export interface PublicProjectConnector {
  sourceKey: PublicProjectSourceKey
  baseUrl: string
  listStates(): Promise<string[]>
  discover(options: PublicProjectDiscoveryOptions): AsyncGenerator<PublicProjectDiscoveredRecord>
  fetchAndNormalize(record: PublicProjectDiscoveredRecord): Promise<NormalizedPublicProject>
}

export class PublicProjectSourceBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicProjectSourceBlockedError'
  }
}
