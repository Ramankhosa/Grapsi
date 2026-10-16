import { describe, expect, it } from 'vitest'

import { isPlaceholderCall, planCallBackfill, type LegacyCallRow } from '@/lib/fundingCatalogImport/backfill'

const ROW: LegacyCallRow = {
  id: 'call-1',
  updated_at: '2026-09-01T10:00:00.000Z',
  title: 'Quantum Materials Equipment Grant',
  agency: 'Department of Science and Technology (DST)',
  source: 'intake',
  funder_country: 'India',
  geography_scope: 'National',
  eligible_countries: ['India'],
  recovered_countries: null,
  currency: 'inr',
  amount_min: 1000000,
  amount_max: 5000000,
  is_rolling: false,
  close_day: '2026-12-31',
  open_day: '2026-10-01',
  has_deadline_rows: false,
  applicant_scope: null,
  final_deadline_at: null,
  entry_closes_at: null,
  currency_code: null,
  amount_min_usd_est: null,
  amount_max_usd_est: null,
  funder_id: null,
  description_source: null,
  enrichment_level: null,
  field_provenance: null,
}

const CONTEXT = {
  rates: new Map([['INR', { usdPerUnit: 0.0105, asOf: '2026-10-15' }]]),
  funders: [
    { id: 'f-dst-za', normalizedName: 'department of science and innovation', acronym: 'DST', countryCode: 'ZA' },
    { id: 'f-wellcome', normalizedName: 'wellcome trust', acronym: null, countryCode: 'GB' },
  ],
  runId: 'run-1',
}

describe('existing-call backfill plan', () => {
  it('fills the new columns from what a curated call already says', () => {
    const plan = planCallBackfill(ROW, CONTEXT)
    expect(plan.sets).toMatchObject({
      applicant_scope: 'COUNTRIES',
      applicant_country_codes: ['IN'],
      final_deadline_at: '2026-12-31',
      entry_closes_at: '2026-12-31',
      currency_code: 'INR',
      amount_min_usd_est: 10500,
      amount_max_usd_est: 52500,
      fx_as_of: '2026-10-15',
      description_source: 'intake',
      enrichment_level: 'CURATED',
    })
    expect(plan.deadlines).toEqual([
      { kind: 'OPEN', dueDate: '2026-10-01' },
      { kind: 'FULL_APPLICATION', dueDate: '2026-12-31' },
    ])
    // Never written for curated calls.
    expect(plan.sets).not.toHaveProperty('deadline_timezone')
    expect(plan.sets).not.toHaveProperty('source_closed_at')
    expect(plan.sets).not.toHaveProperty('host_scope')
  })

  it('does not link a funder on a bare acronym from another country', () => {
    const plan = planCallBackfill(ROW, CONTEXT)
    expect(plan.funder).toMatchObject({ create: { name: 'Department of Science and Technology (DST)', acronym: 'DST', countryCode: 'IN' } })
    const byName = planCallBackfill({ ...ROW, agency: 'Wellcome Trust', funder_country: 'United Kingdom' }, CONTEXT)
    expect(byName.funder).toEqual({ linkTo: 'f-wellcome', how: 'name' })
  })

  it('recovers names the old normaliser dropped, and never stores a list it cannot fully resolve', () => {
    const recovered = planCallBackfill({ ...ROW, eligible_countries: ['India'], recovered_countries: ['India', 'United States'] }, CONTEXT)
    expect(recovered.sets.applicant_country_codes).toEqual(['IN', 'US'])
    const unresolved = planCallBackfill({ ...ROW, eligible_countries: ['India', 'Atlantis'] }, CONTEXT)
    // A shorter list would rule out applicants from the country it lost.
    expect(unresolved.sets.applicant_scope).toBe('UNSPECIFIED')
    expect(unresolved.notes.join(' ')).toMatch(/Atlantis/)
  })

  it('treats a Global call as open to any country', () => {
    const plan = planCallBackfill({ ...ROW, geography_scope: 'Global', eligible_countries: ['India', 'Germany'] }, CONTEXT)
    expect(plan.sets.applicant_scope).toBe('ANY')
    expect(plan.sets.applicant_country_codes).toEqual([])
  })

  it('writes no deadlines for a rolling call and nothing over a value already set', () => {
    const plan = planCallBackfill({ ...ROW, is_rolling: true, applicant_scope: 'COUNTRIES', currency_code: 'INR', funder_id: 'f-x' }, CONTEXT)
    expect(plan.deadlines).toEqual([])
    expect(plan.sets).not.toHaveProperty('final_deadline_at')
    expect(plan.sets).not.toHaveProperty('applicant_scope')
    expect(plan.sets).not.toHaveProperty('currency_code')
    expect(plan.funder).toBeNull()
  })

  it('skips Default Grant Format placeholders', () => {
    expect(isPlaceholderCall({ source: 'default-grant-format', agency: null, title: null })).toBe(true)
    expect(isPlaceholderCall({ source: 'intake', agency: 'Default Grant Format', title: 'x' })).toBe(true)
    expect(isPlaceholderCall({ source: 'intake', agency: 'DST', title: 'Quantum' })).toBe(false)
  })
})
