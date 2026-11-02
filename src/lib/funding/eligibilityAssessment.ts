/**
 * One eligibility assessment for a (call, person) pair, shared by the stored
 * match census, researcher search, the routing preview, alerts and reports.
 *
 * Research fit and eligibility are different questions. "Matched faculty" is a
 * research-fit count; this module says, alongside it, whether the facts we
 * hold pass the call's stated restrictions, conflict with them, or cannot be
 * judged. It never invents an answer:
 *
 *  - INELIGIBLE only for an explicit geographic exclusion (residence,
 *    citizenship, host or the combined applicant list), which is the rule
 *    alerts have always applied.
 *  - Career stage and institution type are compared after normalising both
 *    sides to the shared vocabulary. A canonical mismatch is a known conflict
 *    shown to officers, but stays NEEDS_CHECK rather than INELIGIBLE: career
 *    stages overlap ("Early Career Researcher" vs "Early Career Faculty"), and
 *    a hard block would hide people an officer would accept.
 *  - A missing fact, or a value outside the vocabulary, is NEEDS_CHECK.
 *
 * Pure module (no database).
 */
import {
  ELIGIBILITY_DIMENSIONS,
  applicantGeographyFromProfile,
  dimensionFromRow,
  evaluateEligibility,
  type ApplicantGeography,
  type EligibilityDimensionKey,
  type EligibilityVerdict,
} from './eligibility'
import { normalizeCareerStageList, normalizeInstitutionTypeList } from '@/lib/recommendations/utils'

/**
 * Version of the shared eligibility assessment. Part of the census fingerprint,
 * so changing the rules re-assesses stored matches.
 */
export const ELIGIBILITY_ASSESSMENT_VERSION = 'eligibility-assessment-v1'

export type EligibilityReasonKind = 'conflict' | 'missing' | 'unsupported'
export type EligibilityCheck = EligibilityDimensionKey | 'career_stage' | 'institution_type'

export interface EligibilityReason {
  dimension: EligibilityCheck
  kind: EligibilityReasonKind
  text: string
}

export interface EligibilityAssessmentResult {
  verdict: EligibilityVerdict
  reasons: EligibilityReason[]
  /** The restrictions this call states that were actually compared. */
  checked: EligibilityCheck[]
  version: string
  assessedAt: string
}

/** How reports group people: passes the recorded checks, a known conflict, or still to check. */
export type EligibilityGroup = 'PASS' | 'CONFLICT' | 'CHECK'

/** The call's restrictions: a funding_calls row (snake_case geographic columns) plus its lists. */
export interface EligibilityCallFacts {
  row: Record<string, unknown>
  careerStages: string[]
  institutionTypes: string[]
}

export interface EligibilityPersonFacts {
  countryOfResidence?: string | null
  citizenshipCountries?: string[] | null
  residenceCountryCode?: string | null
  citizenshipCountryCodes?: string[] | null
  careerStage?: string | null
  institutionType?: string | null
}

/** The funding_calls columns an assessment reads, for SELECTs that feed it. */
export const ELIGIBILITY_CALL_COLUMNS = [
  'career_stages', 'institution_types',
  ...ELIGIBILITY_DIMENSIONS.flatMap((key) => [`${key}_scope`, `${key}_country_codes`, `${key}_excluded_codes`, `${key}_region_codes`]),
] as const

const GEO_LABEL: Record<EligibilityDimensionKey, string> = {
  applicant: 'country',
  residence: 'country of residence',
  citizenship: 'citizenship',
  host: 'host country',
}

function applicantGeography(person: EligibilityPersonFacts): ApplicantGeography {
  const fromNames = applicantGeographyFromProfile({
    countryOfResidence: person.countryOfResidence,
    citizenshipCountries: person.citizenshipCountries,
  })
  const residenceCode = (person.residenceCountryCode || '').trim()
  const citizenshipCodes = (person.citizenshipCountryCodes || []).map((code) => code.trim()).filter(Boolean)
  return {
    residence: residenceCode ? [residenceCode] : fromNames.residence,
    citizenship: citizenshipCodes.length ? citizenshipCodes : fromNames.citizenship,
  }
}

function normalizeOne(value: string, normalize: (values: string[]) => string[] | null): string | null {
  return normalize([value])?.[0] ?? null
}

/**
 * Compare one list restriction: null when the call states nothing, otherwise
 * the dimension compared and the reason it did not pass (null when it did).
 * A conflict needs every call value and the person's value to be canonical:
 * an unmapped call value might be the one that admits this person.
 */
function compareList(
  dimension: 'career_stage' | 'institution_type',
  label: string,
  callValues: string[],
  personValue: string | null | undefined,
  normalize: (values: string[]) => string[] | null
): { dimension: EligibilityCheck; reason: EligibilityReason | null } | null {
  const stated = callValues.map((value) => value.trim()).filter(Boolean)
  if (stated.length === 0) return null
  const recorded = (personValue || '').trim()
  if (!recorded) return { dimension, reason: { dimension, kind: 'missing', text: `No ${label} recorded on the profile` } }
  const callCanonical = stated.map((value) => normalizeOne(value, normalize))
  const personCanonical = normalizeOne(recorded, normalize)
  if (personCanonical && callCanonical.includes(personCanonical)) return { dimension, reason: null }
  if (!personCanonical || callCanonical.some((value) => value === null)) {
    return { dimension, reason: { dimension, kind: 'unsupported', text: `Call ${label} (${stated.join(', ')}) needs checking against “${recorded}”` } }
  }
  return { dimension, reason: { dimension, kind: 'conflict', text: `Call is for ${stated.join(', ')}; profile says ${recorded}` } }
}

export function assessEligibility(
  call: EligibilityCallFacts,
  person: EligibilityPersonFacts,
  now: Date = new Date()
): EligibilityAssessmentResult {
  const reasons: EligibilityReason[] = []
  const checked: EligibilityCheck[] = []

  const dimensions = Object.fromEntries(ELIGIBILITY_DIMENSIONS.map((key) => [key, dimensionFromRow(call.row, key)]))
  const applicant = applicantGeography(person)
  const geo = evaluateEligibility(dimensions, applicant)
  for (const key of ELIGIBILITY_DIMENSIONS) {
    const verdict = geo.dimensions[key]
    if (verdict === 'NOT_EVALUATED') continue
    checked.push(key)
    if (verdict === 'INELIGIBLE') {
      reasons.push({ dimension: key, kind: 'conflict', text: `Recorded ${GEO_LABEL[key]} is outside the call's eligible countries` })
    } else if (verdict === 'NEEDS_CHECK') {
      const codes = key === 'citizenship' ? applicant.citizenship
        : key === 'applicant' ? [...(applicant.residence || []), ...(applicant.citizenship || [])]
          : applicant.residence
      reasons.push(codes && codes.length
        ? { dimension: key, kind: 'unsupported', text: `The call's ${GEO_LABEL[key]} rule needs checking` }
        : { dimension: key, kind: 'missing', text: `No ${GEO_LABEL[key]} recorded on the profile` })
    }
  }

  for (const result of [
    compareList('career_stage', 'career stage', call.careerStages, person.careerStage, normalizeCareerStageList),
    compareList('institution_type', 'institution type', call.institutionTypes, person.institutionType, normalizeInstitutionTypeList),
  ]) {
    if (result === null) continue
    checked.push(result.dimension)
    if (result.reason) reasons.push(result.reason)
  }

  const verdict: EligibilityVerdict = geo.overall === 'INELIGIBLE' ? 'INELIGIBLE'
    : reasons.length > 0 ? 'NEEDS_CHECK'
      : checked.length > 0 ? 'ELIGIBLE'
        : 'NOT_EVALUATED'
  return { verdict, reasons, checked: Array.from(new Set(checked)), version: ELIGIBILITY_ASSESSMENT_VERSION, assessedAt: now.toISOString() }
}

export function eligibilityGroup(assessment: Pick<EligibilityAssessmentResult, 'verdict' | 'reasons'> | null | undefined): EligibilityGroup {
  if (!assessment) return 'CHECK'
  if (assessment.verdict === 'INELIGIBLE' || assessment.reasons.some((reason) => reason.kind === 'conflict')) return 'CONFLICT'
  return assessment.verdict === 'ELIGIBLE' ? 'PASS' : 'CHECK'
}

/** The conflicts, worded for a card: what an officer must look at first. */
export function eligibilityConflictTexts(assessment: Pick<EligibilityAssessmentResult, 'reasons'> | null | undefined): string[] {
  return (assessment?.reasons || []).filter((reason) => reason.kind === 'conflict').map((reason) => reason.text)
}

/** Read a stored assessment back from JSON, or null if it is absent or malformed. */
export function readEligibilityAssessment(value: unknown): EligibilityAssessmentResult | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<EligibilityAssessmentResult>
  if (typeof candidate.verdict !== 'string' || !Array.isArray(candidate.reasons)) return null
  return candidate as EligibilityAssessmentResult
}
