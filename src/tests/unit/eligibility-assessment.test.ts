import { describe, expect, it } from 'vitest'

import {
  assessEligibility,
  eligibilityConflictTexts,
  eligibilityGroup,
  type EligibilityCallFacts,
} from '@/lib/funding/eligibilityAssessment'

// One eligibility rule for census, search, routing preview, alerts and reports.
// Missing facts stay uncertain; only an explicit geographic exclusion is
// INELIGIBLE; vocabulary differences are not mistaken for conflicts.

function call(row: Record<string, unknown> = {}, lists: Partial<Pick<EligibilityCallFacts, 'careerStages' | 'institutionTypes'>> = {}): EligibilityCallFacts {
  return { row, careerStages: lists.careerStages ?? [], institutionTypes: lists.institutionTypes ?? [] }
}

const UK_RESIDENTS = { residence_scope: 'COUNTRIES', residence_country_codes: ['GB'], residence_excluded_codes: [], residence_region_codes: [] }

describe('assessEligibility', () => {
  it('is NOT_EVALUATED when the call states no restriction', () => {
    expect(assessEligibility(call(), { careerStage: 'PhD' }).verdict).toBe('NOT_EVALUATED')
  })

  it('separates residence from citizenship', () => {
    const indianInUk = { countryOfResidence: 'United Kingdom', citizenshipCountries: ['India'] }
    const ukCitizenInIndia = { countryOfResidence: 'India', citizenshipCountries: ['United Kingdom'] }
    expect(assessEligibility(call(UK_RESIDENTS), indianInUk).verdict).toBe('ELIGIBLE')
    const ruledOut = assessEligibility(call(UK_RESIDENTS), ukCitizenInIndia)
    expect(ruledOut.verdict).toBe('INELIGIBLE')
    expect(eligibilityGroup(ruledOut)).toBe('CONFLICT')
    expect(eligibilityConflictTexts(ruledOut)[0]).toMatch(/country of residence/)
  })

  it('prefers stored ISO codes over names', () => {
    expect(assessEligibility(call(UK_RESIDENTS), { countryOfResidence: 'Somewhere unlisted', residenceCountryCode: 'GB' }).verdict).toBe('ELIGIBLE')
  })

  it('treats a host restriction as the residence when no host is recorded', () => {
    const hostInGermany = { host_scope: 'COUNTRIES', host_country_codes: ['DE'], host_excluded_codes: [], host_region_codes: [] }
    expect(assessEligibility(call(hostInGermany), { countryOfResidence: 'Germany' }).verdict).toBe('ELIGIBLE')
    expect(assessEligibility(call(hostInGermany), { countryOfResidence: 'India' }).verdict).toBe('INELIGIBLE')
  })

  it('keeps a missing fact uncertain, never a pass or a fail', () => {
    const result = assessEligibility(call(UK_RESIDENTS), {})
    expect(result.verdict).toBe('NEEDS_CHECK')
    expect(result.reasons).toEqual([expect.objectContaining({ dimension: 'residence', kind: 'missing' })])
    expect(eligibilityGroup(result)).toBe('CHECK')
  })

  it('compares career stages after normalising both sides, so spelling is not a conflict', () => {
    const postdocCall = call({}, { careerStages: ['Postdoctoral'] })
    expect(assessEligibility(postdocCall, { careerStage: 'postdoc' }).verdict).toBe('ELIGIBLE')
    expect(assessEligibility(postdocCall, { careerStage: 'POSTDOCTORAL' }).verdict).toBe('ELIGIBLE')
    expect(assessEligibility(call({}, { careerStages: ['early_career_researcher'] }), { careerStage: 'Early Career Researcher' }).verdict).toBe('ELIGIBLE')
  })

  it('shows a canonical career-stage mismatch as a known conflict without making anyone ineligible', () => {
    const result = assessEligibility(call({}, { careerStages: ['PhD'] }), { careerStage: 'Senior Researcher' })
    expect(result.verdict).toBe('NEEDS_CHECK')
    expect(eligibilityGroup(result)).toBe('CONFLICT')
    expect(result.reasons[0]).toMatchObject({ dimension: 'career_stage', kind: 'conflict' })
  })

  it('asks for a check, not a conflict, when either side is outside the vocabulary', () => {
    const unknownProfile = assessEligibility(call({}, { careerStages: ['PhD'] }), { careerStage: 'Dean of Research' })
    expect(unknownProfile.reasons[0]).toMatchObject({ kind: 'unsupported' })
    const unknownCall = assessEligibility(call({}, { careerStages: ['PhD', 'Clinician scientists'] }), { careerStage: 'Senior Researcher' })
    expect(unknownCall.reasons[0]).toMatchObject({ kind: 'unsupported' })
    expect(eligibilityGroup(unknownCall)).toBe('CHECK')
  })

  it('records which restrictions it actually compared', () => {
    const result = assessEligibility(call(UK_RESIDENTS, { institutionTypes: ['University'] }), {
      countryOfResidence: 'United Kingdom', institutionType: 'university',
    })
    expect(result.verdict).toBe('ELIGIBLE')
    expect(result.checked.sort()).toEqual(['institution_type', 'residence'])
    expect(result.version).toBe('eligibility-assessment-v1')
  })
})
