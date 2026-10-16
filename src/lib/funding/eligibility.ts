/**
 * Geographic eligibility as separate requirements.
 *
 * A call can restrict where the applicant lives (residence), which passport
 * they hold (citizenship) and where the work happens (host). These are
 * different questions: 4,552 of the imported calls accept any citizenship but
 * only applicants based in one country, so collapsing them into one list would
 * wrongly qualify an India-based researcher for a US-residents-only award.
 *
 * "applicant" is the combined dimension: the legacy `eligible_countries` list,
 * which the finder has always matched against a researcher's residence OR
 * citizenship. Legacy calls are backfilled into it so their behaviour does not
 * change.
 *
 * Verdicts are three-valued on purpose. Missing information is NEEDS_CHECK,
 * never a pass and never a fail: discovery shows it as "Check eligibility",
 * and alerts drop only an explicit INELIGIBLE (a researcher with no country on
 * their profile is a gap in our data, not a disqualification).
 *
 * Pure module (no database).
 */
import { resolveCountryList, type GeoSpecialToken } from '@/lib/geo/countries'

export const ELIGIBILITY_DIMENSIONS = ['applicant', 'residence', 'citizenship', 'host'] as const
export type EligibilityDimensionKey = (typeof ELIGIBILITY_DIMENSIONS)[number]

export type EligibilityScope = 'ANY' | 'REGIONS' | 'COUNTRIES' | 'UNSPECIFIED'

export interface EligibilityDimension {
  /** null = not evaluated (a legacy row the backfill has not reached). */
  scope: EligibilityScope | null
  /** ISO alpha-2. For REGIONS this is the source's own expansion of the region. */
  countryCodes: string[]
  /** Only ever explicit source exclusions; never inferred from a missing name. */
  excludedCodes: string[]
  regionCodes: string[]
}

export type EligibilityVerdict = 'ELIGIBLE' | 'INELIGIBLE' | 'NEEDS_CHECK' | 'NOT_EVALUATED'

export interface ApplicantGeography {
  residence?: string[]
  citizenship?: string[]
  /** Where the applicant intends to do the work (defaults to residence). */
  host?: string[]
}

export const EMPTY_DIMENSION: EligibilityDimension = { scope: null, countryCodes: [], excludedCodes: [], regionCodes: [] }

function upper(codes: string[] | undefined): string[] {
  return Array.from(new Set((codes || []).map((code) => String(code || '').trim().toUpperCase()).filter(Boolean)))
}

export function evaluateDimension(dimension: EligibilityDimension, applicantCodes: string[] | undefined): EligibilityVerdict {
  if (!dimension.scope) return 'NOT_EVALUATED'
  const codes = upper(applicantCodes)
  const excluded = new Set(upper(dimension.excludedCodes))
  if (dimension.scope === 'ANY') {
    if (codes.length === 0) return excluded.size === 0 ? 'ELIGIBLE' : 'NEEDS_CHECK'
    return codes.some((code) => !excluded.has(code)) ? 'ELIGIBLE' : 'INELIGIBLE'
  }
  if (dimension.scope === 'UNSPECIFIED') return 'NEEDS_CHECK'
  const allowed = new Set(upper(dimension.countryCodes))
  // A region whose member list the source did not give cannot be judged here.
  if (allowed.size === 0) return 'NEEDS_CHECK'
  if (codes.length === 0) return 'NEEDS_CHECK'
  return codes.some((code) => allowed.has(code) && !excluded.has(code)) ? 'ELIGIBLE' : 'INELIGIBLE'
}

export interface EligibilityAssessment {
  overall: EligibilityVerdict
  dimensions: Record<EligibilityDimensionKey, EligibilityVerdict>
}

export function evaluateEligibility(
  call: Partial<Record<EligibilityDimensionKey, EligibilityDimension>>,
  applicant: ApplicantGeography
): EligibilityAssessment {
  const residence = upper(applicant.residence)
  const citizenship = upper(applicant.citizenship)
  const host = upper(applicant.host && applicant.host.length > 0 ? applicant.host : applicant.residence)
  const dimensions: Record<EligibilityDimensionKey, EligibilityVerdict> = {
    // Legacy semantics: listed if the applicant lives in OR holds a passport of it.
    applicant: evaluateDimension(call.applicant || EMPTY_DIMENSION, Array.from(new Set([...residence, ...citizenship]))),
    residence: evaluateDimension(call.residence || EMPTY_DIMENSION, residence),
    citizenship: evaluateDimension(call.citizenship || EMPTY_DIMENSION, citizenship),
    host: evaluateDimension(call.host || EMPTY_DIMENSION, host),
  }
  const verdicts = Object.values(dimensions).filter((verdict) => verdict !== 'NOT_EVALUATED')
  let overall: EligibilityVerdict = 'NOT_EVALUATED'
  if (verdicts.includes('INELIGIBLE')) overall = 'INELIGIBLE'
  else if (verdicts.includes('NEEDS_CHECK')) overall = 'NEEDS_CHECK'
  else if (verdicts.length > 0) overall = 'ELIGIBLE'
  return { overall, dimensions }
}

type DimensionRow = Record<string, unknown>

/**
 * A researcher profile's countries, stored as names, as ISO codes for
 * evaluateEligibility. Empty lists when the profile states no country.
 */
export function applicantGeographyFromProfile(profile: {
  countryOfResidence?: string | null
  citizenshipCountries?: string[] | null
}): ApplicantGeography {
  return {
    residence: resolveCountryList(profile.countryOfResidence ? [profile.countryOfResidence] : []).codes,
    citizenship: resolveCountryList(profile.citizenshipCountries || []).codes,
  }
}

/** The overall verdict for a funding_calls row's stored dimensions (snake_case columns). */
export function eligibilityVerdictForRow(row: DimensionRow, applicant: ApplicantGeography): EligibilityVerdict {
  const call = Object.fromEntries(ELIGIBILITY_DIMENSIONS.map((key) => [key, dimensionFromRow(row, key)]))
  return evaluateEligibility(call, applicant).overall
}

/** Reads one dimension from a funding_calls row (snake_case columns). */
export function dimensionFromRow(row: DimensionRow, key: EligibilityDimensionKey): EligibilityDimension {
  const list = (name: string) => (Array.isArray(row[name]) ? (row[name] as string[]) : [])
  const scope = row[`${key}_scope`]
  return {
    scope: typeof scope === 'string' && scope ? (scope as EligibilityScope) : null,
    countryCodes: list(`${key}_country_codes`),
    excludedCodes: list(`${key}_excluded_codes`),
    regionCodes: list(`${key}_region_codes`),
  }
}

/** The write shape for one dimension. */
export function dimensionColumns(key: EligibilityDimensionKey, dimension: EligibilityDimension) {
  return {
    [`${key}_scope`]: dimension.scope,
    [`${key}_country_codes`]: dimension.countryCodes,
    [`${key}_excluded_codes`]: dimension.excludedCodes,
    [`${key}_region_codes`]: dimension.regionCodes,
  } as Record<string, string | string[] | null>
}

export interface DimensionBuildResult {
  dimension: EligibilityDimension
  /** Country values that could not be resolved (reported, never guessed). */
  unknownValues: string[]
  /** Group tags with no known region code (reported). */
  unknownGroups: string[]
}

/**
 * Builds a dimension from a source's group tags (e.g. "Global", "Europe+")
 * and its explicit country list. Only explicit meaning counts: a "Global" tag
 * means ANY and its expanded list is not stored; a region tag keeps the
 * source's own member list; a bare list is COUNTRIES; nothing at all is
 * UNSPECIFIED.
 */
export function buildDimension(input: {
  groupTags: string[]
  countryValues: string[]
  regionCodeForTag: (tag: string) => string | 'ANY' | null
}): DimensionBuildResult {
  const unknownGroups: string[] = []
  const regionCodes = new Set<string>()
  let any = false
  for (const tag of input.groupTags) {
    const code = input.regionCodeForTag(tag)
    if (code === 'ANY') any = true
    else if (code) regionCodes.add(code)
    else if (String(tag || '').trim()) unknownGroups.push(String(tag).trim())
  }
  const resolved = resolveCountryList(input.countryValues)
  const tokens = new Set<GeoSpecialToken>(resolved.tokens)
  if (tokens.has('ANY')) any = true
  if (tokens.has('EU')) regionCodes.add('EU')
  if (tokens.has('ONLINE')) {
    // Work done online can be hosted anywhere.
    any = true
    regionCodes.add('ONLINE')
  }

  let dimension: EligibilityDimension
  if (any) {
    // The expanded "Global" list is the site's rendering of the tag, not a
    // statement of exclusions, so it is deliberately not stored.
    dimension = { scope: 'ANY', countryCodes: [], excludedCodes: [], regionCodes: Array.from(regionCodes).sort() }
  } else if (regionCodes.size > 0) {
    dimension = { scope: 'REGIONS', countryCodes: resolved.codes, excludedCodes: [], regionCodes: Array.from(regionCodes).sort() }
  } else if (resolved.codes.length > 0) {
    dimension = { scope: 'COUNTRIES', countryCodes: resolved.codes, excludedCodes: [], regionCodes: [] }
  } else {
    dimension = { scope: 'UNSPECIFIED', countryCodes: [], excludedCodes: [], regionCodes: [] }
  }
  return { dimension, unknownValues: resolved.unknown, unknownGroups }
}
