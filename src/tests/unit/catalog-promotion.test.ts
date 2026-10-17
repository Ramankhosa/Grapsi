import { describe, expect, it } from 'vitest'

import { DERIVED_TABLES, policyForTicks, promotionOf, tenantVerdicts } from '@/lib/fundingCatalogImport/promote'

const usOnly = {
  residence_scope: 'COUNTRIES', residence_country_codes: ['US'], residence_excluded_codes: [], residence_region_codes: [],
  citizenship_scope: 'ANY', citizenship_country_codes: [], citizenship_excluded_codes: [], citizenship_region_codes: [],
  host_scope: 'COUNTRIES', host_country_codes: ['US'], host_excluded_codes: [], host_region_codes: [],
}
const worldwideCitizensOfKenya = {
  residence_scope: 'ANY', residence_country_codes: [], residence_excluded_codes: [], residence_region_codes: [],
  citizenship_scope: 'COUNTRIES', citizenship_country_codes: ['KE'], citizenship_excluded_codes: [], citizenship_region_codes: [],
}

describe('promotion to the funding department', () => {
  it('maps the curator’s ticks to a notification policy', () => {
    expect(policyForTicks({ notifyOfficers: true, alertResearchers: false })).toBe('OFFICERS_ONLY')
    expect(policyForTicks({ notifyOfficers: true, alertResearchers: true })).toBe('NORMAL')
    expect(policyForTicks({ notifyOfficers: false, alertResearchers: false })).toBe('SUPPRESSED')
  })

  it('checks each department tenant’s country, India when none is set', () => {
    const [india, usa] = tenantVerdicts(usOnly, [
      { id: 't1', name: 'Indian University', country_code: null },
      { id: 't2', name: 'US College', country_code: 'US' },
    ])
    expect(india).toMatchObject({ countryCode: 'IN', countryAssumed: true, verdict: 'INELIGIBLE' })
    expect(usa).toMatchObject({ countryCode: 'US', countryAssumed: false, verdict: 'ELIGIBLE' })
  })

  it('reads a citizenship limit for the tenant’s own citizens', () => {
    const [india] = tenantVerdicts(worldwideCitizensOfKenya, [{ id: 't1', name: 'Indian University', country_code: 'IN' }])
    expect(india.verdict).toBe('INELIGIBLE')
  })

  it('counts routing and catalogue rows as derived, never assignments or proposals', () => {
    expect(DERIVED_TABLES.has('dsr_call_school_mappings')).toBe(true)
    expect(DERIVED_TABLES.has('funding_call_guidelines')).toBe(true)
    expect(DERIVED_TABLES.has('call_assignments')).toBe(false)
    expect(DERIVED_TABLES.has('grant_proposals')).toBe(false)
    expect(DERIVED_TABLES.has('grant_prep_sessions')).toBe(false)
  })

  it('knows a promoted call by its visibility and its promotion record', () => {
    const record = { at: '2026-10-17T00:00:00Z', by: 'curator@example.org' }
    expect(promotionOf({ visibility: 'GLOBAL_PUBLISHED', metadata: { dsr_promotion: record } })).toMatchObject(record)
    expect(promotionOf({ visibility: 'GLOBAL_CATALOG', metadata: { dsr_promotion: record } })).toBeNull()
    expect(promotionOf({ visibility: 'GLOBAL_PUBLISHED', metadata: {} })).toBeNull()
  })
})
