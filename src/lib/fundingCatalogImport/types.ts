import type { EligibilityDimension } from '@/lib/funding/eligibility'

import type { DerivedLifecycle } from './normalize/deadlines'
import type { ParsedAmount } from './normalize/money'

export interface NormalizedExternalFunder {
  sourceKey: string
  externalId: string
  slug: string | null
  sourceUrl: string | null
  name: string
  normalizedName: string
  acronym: string | null
  countryCode: string | null
  /** e.g. EU for a European Union body (no single country). */
  regionCode: string | null
  description: string | null
  sourcePublishedAt: Date | null
  sourceModifiedAt: Date | null
  rawPayload: Record<string, unknown>
}

export interface NormalizedExternalCall {
  sourceKey: string
  externalId: string
  slug: string | null
  sourceUrl: string | null
  sourcePublishedAt: Date | null
  sourceModifiedAt: Date | null
  fetchedAt: Date | null
  /** The source page is gone (404/410). Says nothing about the opportunity itself. */
  sourceUnavailable: boolean
  /** The source's own error for the detail page (e.g. "HTTP 404"). */
  sourceError: string | null
  /** Detail page never fetched: funder, deadlines and amount are unknown, not empty. */
  detailMissing: boolean

  title: string
  titleNative: string | null
  description: string | null
  summary: string | null
  applyUrl: string | null

  funderExternalIds: string[]
  funderNames: string[]
  funderCountryCode: string | null
  funderRegionCode: string | null

  amount: ParsedAmount
  durationText: string | null
  durationMinMonths: number | null
  durationMaxMonths: number | null

  lifecycle: DerivedLifecycle

  residence: EligibilityDimension
  citizenship: EligibilityDimension
  host: EligibilityDimension
  regionsVersion: string
  unknownCountryValues: string[]
  eligibilityText: string | null

  // Legacy display columns, filled for screens that read them.
  geographyScope: string | null
  eligibleCountryNames: string[]
  hostCountryNames: string[]
  eligibleRegions: string[]
  citizenshipRequirements: string[]
  funderCountryName: string | null

  fundingKinds: string[]
  careerStages: string[]
  institutionTypes: string[]
  sponsorType: string | null
  funderTypeVotes: string[]
  disciplines: string[]
  researchAreaCodes: string[]
  sdgGoals: number[]
  challengeTags: string[]
  indirectCostPolicy: string | null
  workRightsRequired: boolean | null
  requiresNomination: boolean | null
  nominationNote: string | null
  requiredQualifications: string[]
  targetGroups: string[]
  membershipRequirements: string[]
  additionalBenefits: string[]
  programmeFramework: string | null
  contentLanguage: string
  sourceFacets: Record<string, string[]>

  /** Source labels with no crosswalk entry (reported in the run, never guessed). */
  unmappedLabels: Array<{ vocabulary: string; label: string }>
  rawPayload: Record<string, unknown>
}
