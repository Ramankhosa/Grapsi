import { describe, expect, it } from 'vitest'

import { evaluateEligibility, buildDimension, type EligibilityDimension } from '@/lib/funding/eligibility'
import { resolveCountryList } from '@/lib/geo/countries'
import { mapScientifyGrant, normalizeFunderName } from '@/lib/fundingCatalogImport/adapters/scientify'
import { loadScientifyCrosswalks } from '@/lib/fundingCatalogImport/crosswalks'
import { findDuplicatePairs, type DedupCall } from '@/lib/fundingCatalogImport/duplicates'
import { deriveLifecycle } from '@/lib/fundingCatalogImport/normalize/deadlines'
import { parseAmount, parseDurationMonths } from '@/lib/fundingCatalogImport/normalize/money'
import { splitBilingualTitle, seriesTitle } from '@/lib/fundingCatalogImport/normalize/titles'
import { findForbiddenStatements } from '../../../scripts/check-additive-migration'

const dim = (scope: EligibilityDimension['scope'], countryCodes: string[] = [], regionCodes: string[] = []): EligibilityDimension => ({
  scope,
  countryCodes,
  excludedCodes: [],
  regionCodes,
})

describe('country normaliser', () => {
  it('resolves the names the old normaliser dropped', () => {
    const r = resolveCountryList(['United States', 'Turkey', 'Korea', 'Czechia', 'Great Britain', 'Iran', 'Taiwan', 'Tanzania', 'USA', 'United States of America'])
    expect(r.codes).toEqual(['CZ', 'GB', 'IR', 'KR', 'TR', 'TW', 'TZ', 'US'])
    expect(r.unknown).toEqual([])
  })

  it('handles accents, curly quotes and source-specific names', () => {
    expect(resolveCountryList(['Côte d’Ivoire', 'Curaçao', 'Hong Kong, China', 'Channel Islands', 'British Virgin Islands']).codes).toEqual(['CI', 'CW', 'GG', 'HK', 'JE', 'VG'])
  })

  it('reports unknown values and keeps special tokens out of the codes', () => {
    const r = resolveCountryList(['Narnia', 'Global', 'Online', 'European Union'])
    expect(r.codes).toEqual([])
    expect(r.tokens.sort()).toEqual(['ANY', 'EU', 'ONLINE'])
    expect(r.unknown).toEqual(['Narnia'])
  })
})

describe('eligibility dimensions', () => {
  it('global citizenship but US residence is INELIGIBLE for an India-based researcher', () => {
    const result = evaluateEligibility({ residence: dim('COUNTRIES', ['US']), citizenship: dim('ANY') }, { residence: ['IN'], citizenship: ['IN'] })
    expect(result.dimensions.residence).toBe('INELIGIBLE')
    expect(result.dimensions.citizenship).toBe('ELIGIBLE')
    expect(result.overall).toBe('INELIGIBLE')
  })

  it('legacy combined dimension matches residence OR citizenship, as the finder always did', () => {
    const call = { applicant: dim('COUNTRIES', ['IN']) }
    expect(evaluateEligibility(call, { residence: ['GB'], citizenship: ['IN'] }).overall).toBe('ELIGIBLE')
    expect(evaluateEligibility(call, { residence: ['GB'], citizenship: ['GB'] }).overall).toBe('INELIGIBLE')
  })

  it('missing information is NEEDS_CHECK, never a pass or fail', () => {
    expect(evaluateEligibility({ residence: dim('UNSPECIFIED') }, { residence: ['IN'] }).overall).toBe('NEEDS_CHECK')
    expect(evaluateEligibility({ residence: dim('REGIONS', [], ['LMIC']) }, { residence: ['IN'] }).overall).toBe('NEEDS_CHECK')
    expect(evaluateEligibility({ residence: dim('COUNTRIES', ['US']) }, {}).overall).toBe('NEEDS_CHECK')
    expect(evaluateEligibility({}, { residence: ['IN'] }).overall).toBe('NOT_EVALUATED')
  })

  it('a Global tag means ANY and the expanded list is not stored', () => {
    const built = buildDimension({ groupTags: ['Global'], countryValues: ['India', 'Kenya', 'Brazil'], regionCodeForTag: (t) => (t === 'Global' ? 'ANY' : null) })
    expect(built.dimension).toEqual({ scope: 'ANY', countryCodes: [], excludedCodes: [], regionCodes: [] })
  })

  it('a region tag keeps the record’s own member list; unknown values are reported, never excluded', () => {
    const built = buildDimension({ groupTags: ['Low- and Middle-Income Countries (LMICs)'], countryValues: ['India', 'Kenya', 'Narnia'], regionCodeForTag: () => 'LMIC' })
    expect(built.dimension.scope).toBe('REGIONS')
    expect(built.dimension.countryCodes).toEqual(['IN', 'KE'])
    expect(built.dimension.excludedCodes).toEqual([])
    expect(built.unknownValues).toEqual(['Narnia'])
  })
})

describe('amount parser', () => {
  const cases: Array<[string, Partial<ReturnType<typeof parseAmount>>]> = [
    ['Up to 150,000 USD per year + 12% indirect costs', { min: null, max: 150000, currency: 'USD', timeBasis: 'PER_YEAR' }],
    ['12.5 million DKK', { min: 12_500_000, max: 12_500_000, currency: 'DKK' }],
    ['1 - 2 million EUR', { min: 1_000_000, max: 2_000_000, currency: 'EUR' }],
    ['50,000 USD per year per team member', { max: 50000, timeBasis: 'PER_YEAR', recipientBasis: 'PER_TEAM_MEMBER' }],
    ['Up to 100 million JPN', { max: 100_000_000, currency: 'JPY' }],
    ['At least 10,000 EUR', { min: 10000, max: null }],
    ['Around 2 million EUR per project', { min: 2_000_000, max: 2_000_000, approximate: true, recipientBasis: 'PER_AWARD' }],
    ['Project dependent', { min: null, max: null, currency: null, unparsed: false }],
    // A rate is not an amount, so there is nothing left unparsed.
    ['60% of project costs', { min: null, max: null, unparsed: false }],
    ['On average 150,000 (5% indirect costs)', { min: null, max: null, unparsed: true }],
  ]
  for (const [text, expected] of cases) {
    it(text, () => expect(parseAmount(text)).toMatchObject(expected))
  }

  it('reads a bare $ only when the funder country says which dollar', () => {
    expect(parseAmount('Up to $750,000').currency).toBeNull()
    expect(parseAmount('Up to $750,000', { funderCountryCode: 'US' })).toMatchObject({ max: 750000, currency: 'USD' })
    expect(parseAmount('Up to $750,000', { funderCountryCode: 'CA' }).currency).toBe('CAD')
  })

  it('parses durations into months', () => {
    expect(parseDurationMonths('Up to 36 months')).toMatchObject({ min: null, max: 36 })
    expect(parseDurationMonths('2-3 years')).toMatchObject({ min: 24, max: 36 })
    expect(parseDurationMonths('N/A')).toMatchObject({ min: null, max: null })
  })
})

describe('deadlines and lifecycle', () => {
  const base = { isRolling: false, sourceClosed: false, funderCountryCode: 'US', today: '2026-10-15' }

  it('a letter of intent closes entry before the full application, and is flagged for checking', () => {
    const life = deriveLifecycle({ ...base, deadlines: [{ label: 'Letter of inquiry', date: '2026-10-01' }, { label: 'Full application due', date: '2027-02-17' }] })
    expect(life.finalDeadline).toBe('2027-02-17')
    expect(life.entryCloses).toBe('2026-10-01')
    expect(life.status).toBe('CLOSED')
    expect(life.needsCheck).toBe(true)
    expect(life.deadlines.every((d) => d.stageRequired === null)).toBe(true)
  })

  it('the source closed marker wins over future dates; rolling has no deadline', () => {
    expect(deriveLifecycle({ ...base, sourceClosed: true, deadlines: [{ label: 'Full application due', date: '2027-01-01' }] }).status).toBe('CLOSED')
    expect(deriveLifecycle({ ...base, isRolling: true, deadlines: [] }).status).toBe('ROLLING')
  })

  it('open date in the future is FORTHCOMING; India deadlines are pinned to IST', () => {
    const life = deriveLifecycle({ ...base, funderCountryCode: 'IN', deadlines: [{ label: 'Open date', date: '2026-11-01' }, { label: 'Full application due', date: '2026-12-01' }] })
    expect(life.status).toBe('FORTHCOMING')
    expect(life.openDate).toBe('2026-11-01')
    expect(life.deadlineTimezone).toBe('Asia/Kolkata')
    expect(deriveLifecycle({ ...base, funderCountryCode: 'US', deadlines: [] }).deadlineTimezone).toBeNull()
  })
})

describe('titles', () => {
  it('splits only genuinely bilingual titles', () => {
    expect(splitBilingualTitle('Projektanslag | Project grant (Sweden | Parkinson’s disease)').native).toBe('Projektanslag')
    expect(splitBilingualTitle('2027 FEBS | EMBO Women in Science Award').native).toBeNull()
    expect(splitBilingualTitle('Clinical Research Award (cystic fibrosis | worldwide)').native).toBeNull()
  })

  it('series title drops years, rounds and the source tag suffix', () => {
    expect(seriesTitle('2027 Friedrich Miescher Award (biochemistry | Switzerland)')).toBe(seriesTitle('Friedrich Miescher Award (biochemistry | Swiss researchers)'))
  })
})

describe('duplicate tiers', () => {
  const call = (id: string, over: Partial<DedupCall>): DedupCall => ({
    id,
    kind: 'imported',
    title: 'Pilot Award',
    funderKeys: ['mra'],
    urlKeys: ['curemelanoma.org/rfp'],
    finalDeadline: '2026-11-01',
    year: 2026,
    descriptionHash: null,
    seriesKey: null,
    ...over,
  })

  it('different awards on one programme page are RELATED, not duplicates', () => {
    const pairs = findDuplicatePairs([call('a', { title: 'Young Investigator Award (melanoma | worldwide)' }), call('b', { title: 'Team Science Award (melanoma | worldwide)' })], [])
    expect(pairs.map((p) => p.tier)).toEqual(['RELATED'])
  })

  it('the same opportunity listed per eligibility group is a LIKELY duplicate flagged as a listing variant', () => {
    const pairs = findDuplicatePairs([call('a', { title: 'Postdoctoral Fellowships (USA | multiple sclerosis)' }), call('b', { title: 'Postdoctoral Fellowships (US citizens | multiple sclerosis)' })], [])
    expect(pairs[0].tier).toBe('LIKELY_DUPLICATE')
    expect(pairs[0].signals.listingVariant).toBe(true)
  })

  it('another year of an annual programme is never a duplicate', () => {
    const pairs = findDuplicatePairs([call('a', { title: '2026 Pilot Award', finalDeadline: '2026-03-01' }), call('b', { title: '2027 Pilot Award', finalDeadline: '2027-03-01' })], [])
    expect(pairs.every((p) => p.tier === 'RELATED')).toBe(true)
  })

  it('an imported call matching an existing call by funder, title and round is LIKELY', () => {
    const existing: DedupCall = { ...call('x', { title: 'Clinical Pilot and Feasibility Award' }), kind: 'existing', urlKeys: [] }
    const pairs = findDuplicatePairs([call('a', { title: 'Clinical Pilot and Feasibility Award (cystic fibrosis | worldwide)', urlKeys: [] })], [existing])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ candidateId: 'x', candidateKind: 'existing', tier: 'LIKELY_DUPLICATE' })
  })

  it('unrelated calls produce nothing', () => {
    expect(findDuplicatePairs([call('a', { title: 'Ocean Science Fellowship', funderKeys: ['nsf'], urlKeys: ['nsf.gov/a'] })], [{ ...call('x', { title: 'Cancer Research Prize', funderKeys: ['cruk'], urlKeys: ['cruk.org/b'] }), kind: 'existing' }])).toEqual([])
  })
})

describe('migration guard', () => {
  it('allows additive statements and same-name check widening only', () => {
    expect(findForbiddenStatements('ALTER TABLE "x" ADD COLUMN "y" TEXT; CREATE INDEX "i" ON "x"("y");')).toEqual([])
    expect(findForbiddenStatements('ALTER TABLE "x" DROP CONSTRAINT "c", ADD CONSTRAINT "c" CHECK (true);')).toEqual([])
    expect(findForbiddenStatements('ALTER TABLE "x" DROP CONSTRAINT "c", ADD CONSTRAINT "d" CHECK (true);')).not.toEqual([])
    expect(findForbiddenStatements('ALTER TABLE "x" DROP COLUMN "y";')).not.toEqual([])
    expect(findForbiddenStatements('UPDATE funding_calls SET title = 1;')).not.toEqual([])
    expect(findForbiddenStatements('-- a comment that says DROP TABLE\nALTER TABLE "x" ADD COLUMN "z" INT;')).toEqual([])
  })
})

describe('scientify adapter', () => {
  const crosswalks = loadScientifyCrosswalks()
  const funderById = new Map()
  const record = {
    id: 3541,
    slug: 'cystic-fibrosis-clinical-pilot-feasibility-award',
    url: 'https://www.scientifyresearch.org/grant/cystic-fibrosis-clinical-pilot-feasibility-award/',
    title: 'Clinical Pilot and Feasibility Award (cystic fibrosis | worldwide)',
    funder_id: 3773,
    funder_name: 'Cystic Fibrosis Foundation',
    funders: [{ id: 3773, name: 'Cystic Fibrosis Foundation' }],
    apply_url: 'https://www.cff.org/researchers/clinical-pilot-and-feasibility-award',
    amount_raw: 'Up to 150,000 USD per year + 12% indirect costs',
    duration_raw: 'Up to 2 years',
    deadlines: [
      { label: 'Letter of inquiry', date: '2026-10-01' },
      { label: 'Full application due', date: '2027-02-17' },
    ],
    description: 'Funding for investigators to generate preliminary data.',
    published_gmt: '2026-09-21T14:05:03',
    modified_gmt: '2026-09-24T20:25:17',
    fetched_at: '2026-10-14T10:39:27+00:00',
    other_detail_fields: {},
    taxonomies: {
      location: ['USA'],
      challenge: ['Rare diseases', 'SDG03 - Good health and well-being'],
      'host-location': ['Afghanistan', 'Albania'],
      'recipient-citizenship': ['Afghanistan', 'Albania'],
      'my-primary-locations': ['USA'],
      'multi-location': ['Global'],
      'multi-citizenship': ['Global'],
      mul: [],
      'grant-type': ['Research grant', 'Research grant - Teams'],
      'career-stage': ['Early-career principal investigators', 'Senior researchers'],
      discipline: ['Biomedical research', 'Genetics', 'Pulmonology'],
      'my-subject': ['Medicine'],
      'indirect-cost': ['Indirect costs included'],
      'legal-working-rights': ['Working rights required or implied'],
      'funding-sources': ['Foundation and society funding'],
      'recipient-qualification': ['Not specified'],
      nomination: [],
      diversities: [],
      'society-memberships': [],
      'additional-benefit': ['Additional benefits not specified'],
      horizon: [],
    },
  }

  it('maps a record into separate eligibility dimensions, stages and vocabularies', () => {
    const call = mapScientifyGrant(record, { crosswalks, funderById, today: '2026-10-15' })
    expect(call.residence).toMatchObject({ scope: 'COUNTRIES', countryCodes: ['US'] })
    expect(call.citizenship.scope).toBe('ANY')
    expect(call.host.scope).toBe('ANY')
    expect(call.lifecycle).toMatchObject({ entryCloses: '2026-10-01', finalDeadline: '2027-02-17', status: 'CLOSED', needsCheck: true })
    expect(call.amount).toMatchObject({ max: 150000, currency: 'USD', timeBasis: 'PER_YEAR' })
    expect(call.fundingKinds).toEqual(['Research Grant'])
    expect(call.careerStages).toEqual(expect.arrayContaining(['Early Career Faculty', 'Senior Researcher']))
    expect(call.sponsorType).toBe('Foundation')
    expect(call.sdgGoals).toEqual([3])
    expect(call.researchAreaCodes).toEqual(expect.arrayContaining(['LIF.01', 'MED.01']))
    expect(call.unmappedLabels).toEqual([])
    expect(call.titleNative).toBeNull()
    expect(call.indirectCostPolicy).toBe('INCLUDED')
  })

  it('normalises funder names for matching', () => {
    expect(normalizeFunderName('American Association for Cancer Research (AACR)')).toBe('american association for cancer research')
  })
})
