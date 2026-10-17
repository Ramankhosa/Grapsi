/**
 * Funding directory filters, checked against an independent reading of the
 * data. Read-only.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/verify-directory-filters.ts [--combos 300] [--seed 7] [--verbose]
 *
 * The rules being checked (the directory's contract):
 *   - inside one filter, the chosen values are alternatives (OR);
 *   - different filters must all hold (AND), and so must the search text;
 *   - text: words are all required (AND), `or` between words offers
 *     alternatives, `-word` excludes, "quoted words" are a phrase;
 *   - a facet's count is what the results become when that value is chosen;
 *   - every value the UI offers is accepted by the API.
 * Country filters read eligibility the way the eligibility badge does
 * (lib/funding/eligibility), so the filter and the badge cannot disagree.
 *
 * Each check prints PASS/FAIL with the first mismatching examples; the exit
 * code is 1 when any check fails.
 */
import { Prisma } from '@prisma/client'

import prisma from '../src/lib/prisma'
import { evaluateDimension, type EligibilityDimension } from '../src/lib/funding/eligibility'
import { resolveCountryList } from '../src/lib/geo/countries'
import {
  RECOMMENDATION_CAREER_STAGE_OPTIONS,
  RECOMMENDATION_FUNDING_KIND_OPTIONS,
  RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS,
  RECOMMENDATION_INSTITUTION_TYPE_OPTIONS,
  RECOMMENDATION_REGION_OPTIONS,
  RECOMMENDATION_SPONSOR_TYPE_OPTIONS,
} from '../src/lib/recommendations/constants'
import { toggleFacetValue } from '../src/lib/recommendations/directorySelections'
import type { DirectoryFacetDimension, RecommendationAccessScope, RecommendationSearchFilters } from '../src/lib/recommendations/types'
import {
  normalizeCareerStageList,
  normalizeFundingKindList,
  normalizeGeographyScopeList,
  normalizeInstitutionTypeList,
  normalizeRegionList,
  normalizeSponsorTypeList,
  validateNormalizedControlledFilters,
} from '../src/lib/recommendations/utils'
import { recommendationSearchService } from '../src/lib/services/recommendationSearchService'

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const VERBOSE = process.argv.includes('--verbose')
const COMBOS = Number(arg('combos') || 300)
let seed = Number(arg('seed') || 7)
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = <T>(items: readonly T[], n: number): T[] => {
  const pool = [...items]
  const out: T[] = []
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0])
  return out
}

/** Case-, accent- and punctuation-insensitive form of a stored or chosen value. */
const key = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

type Row = {
  id: string
  imported: boolean
  is_rolling: boolean | null
  deadline: string | null
  source_closed: boolean
  entry_closes: string | null
  funding_kinds: string[]
  institution_types: string[]
  career_stages: string[]
  sponsor_type: string | null
  geography_scope: string | null
  eligible_countries: string[]
  eligible_regions: string[]
  host_countries: string[]
  funder_country: string | null
  funder_country_code: string | null
  citizenship_requirements: string[]
  residency_requirements: string[]
  application_languages: string[]
  funder_id: string | null
  agency: string | null
  sdg_goals: number[]
  programme_framework: string | null
  amount_min: number | null
  amount_max: number | null
  currency_key: string
  usd_min: number | null
  usd_max: number | null
  tax: string[]
  dims: Record<'applicant' | 'residence' | 'citizenship' | 'host', EligibilityDimension>
}

const DIMENSION_COLUMNS = (name: string) => Prisma.raw(
  `jsonb_build_object('scope', ${name}_scope, 'countryCodes', ${name}_country_codes, 'excludedCodes', ${name}_excluded_codes, 'regionCodes', ${name}_region_codes) AS "${name}"`
)

async function loadRows(tenantId: string) {
  const raw = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
    SELECT fc.id, fc.import_run_id IS NOT NULL AS imported, fc.is_rolling,
           COALESCE(fc.close_date, fc.expiration_date)::date::text AS deadline,
           fc.source_closed_at IS NOT NULL AS source_closed, fc.entry_closes_at::date::text AS entry_closes,
           fc.funding_kinds, fc.institution_types, fc.career_stages, fc.sponsor_type, fc.geography_scope,
           fc.eligible_countries, fc.eligible_regions, fc.host_countries, fc.funder_country, fc.funder_country_code,
           fc.citizenship_requirements, fc.residency_requirements, fc.application_languages, fc.funder_id,
           COALESCE(NULLIF(TRIM(fc.agency_name), ''), NULLIF(TRIM(fc."agencyName"), '')) AS agency,
           fc.sdg_goals, fc.programme_framework, fc.amount_min, fc.amount_max,
           UPPER(COALESCE(fc.currency_code, fc.currency, '')) AS currency_key,
           fc.amount_min_usd_est AS usd_min, fc.amount_max_usd_est AS usd_max,
           COALESCE((SELECT array_agg(t.taxonomy_area_id) FROM funding_call_research_area_taxonomies t WHERE t.funding_call_id = fc.id), ARRAY[]::text[]) AS tax,
           ${DIMENSION_COLUMNS('applicant')}, ${DIMENSION_COLUMNS('residence')}, ${DIMENSION_COLUMNS('citizenship')}, ${DIMENSION_COLUMNS('host')}
    FROM funding_calls fc
    WHERE (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED') AND COALESCE(fc.is_active, true)
      AND (fc.visibility::text IN ('GLOBAL_PUBLISHED', 'GLOBAL_CATALOG') OR (fc.visibility::text = 'TENANT_PRIVATE' AND fc."tenantId" = ${tenantId}))`)
  return raw.map((r) => ({
    ...r,
    dims: { applicant: r.applicant, residence: r.residence, citizenship: r.citizenship, host: r.host },
  })) as Row[]
}

// ---------------------------------------------------------------- the rules

function rowIsOpen(row: Row, today: string) {
  const datesOk = Boolean(row.is_rolling) || !row.deadline || row.deadline >= today
  const lifecycleOk = !row.imported || (!row.source_closed && (!row.entry_closes || row.entry_closes >= today))
  return datesOk && lifecycleOk
}

const anyOf = (stored: string[] | null | undefined, chosen: string[]) => {
  const wanted = new Set(chosen.map(key))
  return (stored || []).some((value) => wanted.has(key(value)))
}
const oneOf = (stored: string | null, chosen: string[]) => stored !== null && chosen.map(key).includes(key(stored))
const codesOf = (values: string[]) => resolveCountryList(values).codes
const notIneligible = (dimension: EligibilityDimension, code: string) => evaluateDimension(dimension, [code]) !== 'INELIGIBLE'

/** Open to applicants from at least one chosen country. */
function eligibleFor(row: Row, codes: string[]) {
  if (row.imported) {
    return codes.some((code) => notIneligible(row.dims.residence, code) && notIneligible(row.dims.citizenship, code))
  }
  const listed = codesOf(row.eligible_countries)
  if (codes.some((code) => listed.includes(code))) return true
  // A curated call whose eligibility has been evaluated (the backfill) and is
  // open to the country — "worldwide" above all — the badge says Eligible.
  return Boolean(row.dims.applicant?.scope) && codes.some((code) => evaluateDimension(row.dims.applicant, [code]) === 'ELIGIBLE')
}

/** Citizenship: imported calls by their dimension; curated free text is never read, so they pass. */
function citizenOk(row: Row, codes: string[]) {
  if (codes.length === 0 || !row.imported) return true
  return codes.some((code) => notIneligible(row.dims.citizenship, code))
}

/** Residence: imported calls by their dimension; curated by their country list, worldwide, or no country information. */
function residentOk(row: Row, codes: string[]) {
  if (codes.length === 0) return true
  if (row.imported) return codes.some((code) => notIneligible(row.dims.residence, code))
  if (row.eligible_countries.length === 0 && (row.dims.applicant?.scope ?? 'UNSPECIFIED') === 'UNSPECIFIED') return true
  return eligibleFor(row, codes)
}

function hostedIn(row: Row, codes: string[]) {
  if (row.imported) return codes.some((code) => notIneligible(row.dims.host, code))
  const listed = codesOf(row.host_countries)
  return codes.some((code) => listed.includes(code))
}

function funderIn(row: Row, codes: string[]) {
  if (row.imported) return row.funder_country_code !== null && codes.includes(row.funder_country_code)
  return row.funder_country !== null && codes.some((code) => codesOf([row.funder_country!]).includes(code))
}

function amountSide(row: Row, side: 'min' | 'max', value: number, filters: RecommendationSearchFilters, rates: Map<string, number>) {
  const raw = side === 'min' ? (row.amount_max ?? row.amount_min) : (row.amount_min ?? row.amount_max)
  const usd = side === 'min' ? (row.usd_max ?? row.usd_min) : (row.usd_min ?? row.usd_max)
  const ok = (a: number, b: number) => (side === 'min' ? a >= b : a <= b)
  if (!filters.amountCurrency) {
    const known = raw !== null && ok(Number(raw), value)
    return filters.includeUnknownAmount ? raw === null || known : known
  }
  const same = row.currency_key === filters.amountCurrency
  const here = same && raw !== null
  const inUsd = !same && usd !== null
  const rate = rates.get(filters.amountCurrency)
  const passes = (here && ok(Number(raw), value)) || (inUsd && rate !== undefined && ok(Number(usd), value * rate))
  return filters.includeUnknownAmount ? passes || !(here || inUsd) : passes
}

type FunderNames = Map<string, string[]>

function matches(row: Row, f: RecommendationSearchFilters, ctx: { today: string; rates: Map<string, number>; funders: FunderNames }) {
  if (!f.includeExpired && !rowIsOpen(row, ctx.today)) return false
  if (f.rollingOnly && !row.is_rolling) return false
  if (f.deadlineFrom && !(row.deadline && row.deadline >= f.deadlineFrom)) return false
  if (f.deadlineTo && !(row.deadline && row.deadline <= f.deadlineTo)) return false
  if (typeof f.amountMin === 'number' && !amountSide(row, 'min', f.amountMin, f, ctx.rates)) return false
  if (typeof f.amountMax === 'number' && !amountSide(row, 'max', f.amountMax, f, ctx.rates)) return false
  if (f.geographyScope?.length && !oneOf(row.geography_scope, f.geographyScope)) return false
  if (f.fundingKinds?.length && !anyOf(row.funding_kinds, f.fundingKinds)) return false
  if (f.institutionTypes?.length && !anyOf(row.institution_types, f.institutionTypes)) return false
  if (f.careerStages?.length && !anyOf(row.career_stages, f.careerStages)) return false
  if (f.sponsorTypes?.length && !oneOf(row.sponsor_type, f.sponsorTypes)) return false
  if (f.eligibleRegions?.length && !anyOf(row.eligible_regions, f.eligibleRegions)) return false
  // Language: accepts it, or does not say.
  if (f.applicationLanguages?.length && row.application_languages.length > 0 && !anyOf(row.application_languages, f.applicationLanguages)) return false
  // The applicant's citizenship / residence: only a call that rules them out goes.
  if (f.citizenshipRequirements?.length && !citizenOk(row, codesOf(f.citizenshipRequirements))) return false
  if (f.residencyRequirements?.length && !residentOk(row, codesOf(f.residencyRequirements))) return false
  if (f.eligibleCountries?.length && !eligibleFor(row, codesOf(f.eligibleCountries))) return false
  if (f.hostCountries?.length && !hostedIn(row, codesOf(f.hostCountries))) return false
  if (f.funderCountries?.length && !funderIn(row, codesOf(f.funderCountries))) return false
  if (f.taxonomyAreaIds?.length && !row.tax.some((id) => f.taxonomyAreaIds!.includes(id))) return false
  if (f.sdgGoals?.length && !(row.sdg_goals || []).some((goal) => f.sdgGoals!.includes(String(goal)))) return false
  if (f.programmeFrameworks?.length) {
    const pf = row.programme_framework
    if (!pf || !f.programmeFrameworks.some((value) => key(pf) === key(value) || pf.startsWith(`${value} › `))) return false
  }
  if (f.funderIds?.length) {
    const byLink = row.funder_id !== null && f.funderIds.includes(row.funder_id)
    const byName = row.funder_id === null && row.agency !== null &&
      f.funderIds.some((id) => (ctx.funders.get(id) || []).includes(row.agency!.trim().toLowerCase()))
    if (!byLink && !byName) return false
  }
  return true
}

// ---------------------------------------------------------------- harness

type Check = { name: string; total: number; failures: string[] }
const checks: Check[] = []
function check(name: string) {
  const entry: Check = { name, total: 0, failures: [] }
  checks.push(entry)
  return {
    pass: () => { entry.total += 1 },
    fail: (detail: string) => { entry.total += 1; entry.failures.push(detail) },
  }
}

async function main() {
  const tenantUser = await prisma.user.findFirst({ where: { tenantId: { not: null }, tenant: { atiId: { not: 'PLATFORM' } } }, select: { tenantId: true } })
  if (!tenantUser?.tenantId) throw new Error('Needs a researcher tenant.')
  const access: RecommendationAccessScope = { tenantId: tenantUser.tenantId, isSuperAdmin: false }
  const [{ today }] = await prisma.$queryRaw<Array<{ today: string }>>(Prisma.sql`SELECT CURRENT_DATE::text AS today`)
  const rateRows = await prisma.$queryRaw<Array<{ currency: string; usd: number }>>(Prisma.sql`
    SELECT DISTINCT ON (currency) currency, usd_per_unit::float AS usd FROM currency_rates ORDER BY currency, as_of DESC`)
  const rates = new Map(rateRows.map((r) => [r.currency, r.usd]))
  const funderRows = await prisma.$queryRaw<Array<{ id: string; names: string[] }>>(Prisma.sql`
    SELECT id, array_remove(ARRAY[LOWER(TRIM(name)), LOWER(TRIM(acronym))] || ARRAY(SELECT LOWER(TRIM(a)) FROM unnest(aliases) a), NULL) AS names FROM funders`)
  const funders: FunderNames = new Map(funderRows.map((f) => [f.id, f.names.filter(Boolean)]))
  const rows = await loadRows(access.tenantId!)
  const ctx = { today, rates, funders }
  const expected = (f: RecommendationSearchFilters) => rows.filter((row) => matches(row, f, ctx)).length

  const serviceCount = async (filters: RecommendationSearchFilters, query = '') => {
    const result = await recommendationSearchService.browseDirectory({ query, page: 1, access, filters: { ...filters, limit: 1 } })
    return result.totalResults
  }

  const compare = async (c: ReturnType<typeof check>, label: string, filters: RecommendationSearchFilters) => {
    const invalid = validateNormalizedControlledFilters(filters)
    if (invalid) return c.fail(`${label}: the API refuses it — ${invalid.slice(0, 90)}`)
    const [got, want] = [await serviceCount(filters), expected(filters)]
    if (got === want) return c.pass()
    c.fail(`${label}: directory ${got}, expected ${want}`)
  }

  console.log(`${rows.length} published calls visible to a researcher; ${rows.filter((r) => rowIsOpen(r, today)).length} open on ${today}.`)

  // 1. The open set itself.
  {
    const c = check('open calls (no filters)')
    await compare(c, 'no filters', {})
    await compare(c, 'include closed calls', { includeExpired: true })
  }

  // 2. Every filter alone, over every value the data or the UI offers.
  const distinct = (pickValues: (row: Row) => Array<string | null | undefined>) =>
    Array.from(new Set(rows.flatMap((row) => pickValues(row)).filter((v): v is string => Boolean(v))))
  // Controlled vocabularies: what a user can choose is the vocabulary (stored
  // values outside it are listed as data notes below, not offered).
  const unreachable: string[] = []
  const vocabulary = (field: string, stored: string[], options: readonly string[], normalize: (v: string[]) => string[] | null) => {
    for (const value of stored) if (normalize([value])?.[0] !== value) unreachable.push(`${field} "${value}"`)
    return [...new Set([...options, ...stored.filter((value) => normalize([value])?.[0] === value)])]
  }
  const single: Array<[keyof RecommendationSearchFilters, string[]]> = [
    ['fundingKinds', vocabulary('fundingKinds', distinct((r) => r.funding_kinds), RECOMMENDATION_FUNDING_KIND_OPTIONS, normalizeFundingKindList)],
    ['careerStages', vocabulary('careerStages', distinct((r) => r.career_stages), RECOMMENDATION_CAREER_STAGE_OPTIONS, normalizeCareerStageList)],
    ['institutionTypes', vocabulary('institutionTypes', distinct((r) => r.institution_types), RECOMMENDATION_INSTITUTION_TYPE_OPTIONS, normalizeInstitutionTypeList)],
    ['sponsorTypes', vocabulary('sponsorTypes', distinct((r) => [r.sponsor_type]), RECOMMENDATION_SPONSOR_TYPE_OPTIONS, normalizeSponsorTypeList)],
    ['geographyScope', vocabulary('geographyScope', distinct((r) => [r.geography_scope]), RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS, normalizeGeographyScopeList)],
    ['eligibleRegions', vocabulary('eligibleRegions', distinct((r) => r.eligible_regions), RECOMMENDATION_REGION_OPTIONS, normalizeRegionList)],
    ['eligibleCountries', ['India', 'IN', 'United States', 'Germany', 'Iran', 'Kenya', 'Brazil', 'Korea, Republic of', 'Côte d’Ivoire', ...pick(distinct((r) => r.eligible_countries), 12)]],
    ['hostCountries', ['India', 'United Kingdom', 'Singapore', 'Germany', ...pick(distinct((r) => r.host_countries), 8)]],
    ['funderCountries', ['India', 'United States', 'Germany', 'Belgium', 'Korea, Republic of', ...pick(distinct((r) => [r.funder_country]), 8)]],
    // Countries, plus free text an older link may carry (dropped, so no filter).
    ['citizenshipRequirements', ['India', 'United States', 'Singapore', 'Canada', 'Australia', 'Citizens of EU member states']],
    ['residencyRequirements', ['India', 'United Kingdom', 'Germany', 'Brazil', 'Must reside in Canada']],
    ['applicationLanguages', ['English', 'French', 'German']],
    ['sdgGoals', Array.from({ length: 17 }, (_, i) => String(i + 1))],
    ['programmeFrameworks', ['Horizon Europe', ...pick(distinct((r) => [r.programme_framework]), 4)]],
    ['taxonomyAreaIds', pick(distinct((r) => r.tax), 12)],
    ['funderIds', [...pick(distinct((r) => [r.funder_id]), 10), ...funderRows.filter((f) => rows.some((r) => !r.funder_id && r.agency && f.names.includes(r.agency.trim().toLowerCase()))).slice(0, 3).map((f) => f.id)]],
  ]
  for (const [field, values] of single) {
    const c = check(`filter alone: ${field}`)
    for (const value of values) await compare(c, `${field} = ${value}`, { [field]: [value] })
  }
  {
    const c = check('filter alone: deadline, rolling, amount')
    const plus = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10)
    const cases: Array<[string, RecommendationSearchFilters]> = [
      ['rolling only', { rollingOnly: true }],
      ['deadline within 30 days', { deadlineFrom: today, deadlineTo: plus(30) }],
      ['deadline within 90 days', { deadlineFrom: today, deadlineTo: plus(90) }],
      ['deadline from +60 days', { deadlineFrom: plus(60) }],
      ['deadline up to +14 days', { deadlineTo: plus(14) }],
      ['amount ≥ 50,000 (raw)', { amountMin: 50000 }],
      ['amount ≤ 20,000 (raw)', { amountMax: 20000 }],
      ['amount ≥ 50,000 USD', { amountMin: 50000, amountCurrency: 'USD' }],
      ['amount ≤ 20,000 EUR', { amountMax: 20000, amountCurrency: 'EUR' }],
      ['amount 10–100 lakh INR', { amountMin: 1_000_000, amountMax: 10_000_000, amountCurrency: 'INR' }],
      ['amount ≥ 50,000 USD + unknown', { amountMin: 50000, amountCurrency: 'USD', includeUnknownAmount: true }],
      ['closed calls + deadline last 30 days', { includeExpired: true, deadlineFrom: plus(-30), deadlineTo: today }],
    ]
    for (const [label, filters] of cases) await compare(c, label, filters)
  }

  // 3. Several values inside one filter: alternatives (OR).
  {
    const c = check('several values in one filter (OR)')
    for (const [field, values] of single) {
      if (values.length < 2) continue
      for (let i = 0; i < 4; i++) {
        const chosen = pick(values, 2 + Math.floor(random() * 2))
        await compare(c, `${field} any of [${chosen.join(' | ')}]`, { [field]: chosen })
      }
    }
  }

  // 4. Filters combined: all must hold (AND).
  {
    const c = check(`filters combined (AND), ${COMBOS} random combinations`)
    const fields = single.filter(([, values]) => values.length > 0)
    for (let i = 0; i < COMBOS; i++) {
      const filters: RecommendationSearchFilters = {}
      for (const [field, values] of pick(fields, 2 + Math.floor(random() * 3))) {
        ;(filters as Record<string, unknown>)[field] = pick(values, 1 + Math.floor(random() * 2))
      }
      if (random() < 0.25) filters.rollingOnly = true
      if (random() < 0.2) Object.assign(filters, { amountMin: 20000, amountCurrency: random() < 0.5 ? 'USD' : '' })
      await compare(c, JSON.stringify(filters), filters)
    }
  }

  // 5. Search text with filters, and the text operators.
  {
    const c = check('search text (all words required; or / -word / "phrase")')
    const textIds = async (raw: string) =>
      new Set((await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM funding_calls WHERE ts_document @@ websearch_to_tsquery('english', ${raw})
        UNION SELECT funding_call_id FROM funding_call_research_area_taxonomies t
        WHERE to_tsvector('english', coalesce(t.taxonomy_level1_code, '') || ' ' || coalesce(t.taxonomy_level1_name, '') || ' ' ||
              coalesce(t.taxonomy_level2_code, '') || ' ' || coalesce(t.taxonomy_level2_name, '')) @@ websearch_to_tsquery('english', ${raw})`)).map((r) => r.id))
    const queries = ['cancer', 'cancer immunotherapy', 'climate change india', 'marfan or ataxia', 'machine learning -medical', '"early career" fellowship', 'Horizon Europe', 'Forschung', 'the of']
    const filterSets: RecommendationSearchFilters[] = [{}, { fundingKinds: ['Fellowship'] }, { eligibleCountries: ['India'] }, { careerStages: ['Postdoctoral'], rollingOnly: false }]
    for (const q of queries) {
      const [{ empty }] = await prisma.$queryRaw<Array<{ empty: boolean }>>(Prisma.sql`SELECT numnode(websearch_to_tsquery('english', ${q})) = 0 AS empty`)
      const ids = await textIds(q)
      for (const filters of filterSets) {
        // A query of stop words only filters nothing.
        const want = rows.filter((row) => (empty || ids.has(row.id)) && matches(row, filters, ctx)).length
        const got = await serviceCount(filters, q)
        if (got === want) c.pass()
        else c.fail(`"${q}" + ${JSON.stringify(filters)}: directory ${got}, expected ${want}`)
      }
    }
  }

  // 6. Facets: offered values are accepted, and a value's count is what choosing it gives.
  {
    const accepted = check('facet values the API accepts')
    const counted = check('facet count = results after choosing it')
    const facets = await recommendationSearchService.getDirectoryFacets({ access, filters: {} })
    for (const [dimension, items] of Object.entries(facets.facets) as Array<[DirectoryFacetDimension, Array<{ value: string; count: number }>]>) {
      for (const item of items.slice(0, VERBOSE ? 30 : 12)) {
        const chosen = toggleFacetValue({}, dimension, item.value)
        const invalid = validateNormalizedControlledFilters(chosen)
        if (invalid) { accepted.fail(`${dimension} "${item.value}": ${invalid.slice(0, 80)}`); continue }
        accepted.pass()
        const got = await serviceCount(chosen)
        if (got === item.count) counted.pass()
        else counted.fail(`${dimension} "${item.value}": facet says ${item.count}, choosing it gives ${got}`)
      }
    }
    // Within a dimension values are alternatives, so once one is chosen the
    // others must show what adding them brings (counted without the
    // dimension's own selection), not their overlap with it.
    const disjunctive = check('facet counts with a value already chosen (OR within a group)')
    for (const dimension of ['fundingKind', 'careerStage', 'sponsorType', 'sdgGoal'] as DirectoryFacetDimension[]) {
      const [first, second] = facets.facets[dimension] || []
      if (!first || !second) continue
      const chosen = toggleFacetValue({}, dimension, first.value)
      const after = await recommendationSearchService.getDirectoryFacets({ access, filters: chosen })
      const shown = (after.facets[dimension] || []).find((item) => item.value === second.value)?.count ?? 0
      const alone = await serviceCount(toggleFacetValue({}, dimension, second.value))
      const both = await serviceCount(toggleFacetValue(chosen, dimension, second.value))
      // Shown = the value's own count under the other filters; choosing it too gives the union.
      if (shown !== alone) disjunctive.fail(`${dimension}: "${first.value}" chosen, "${second.value}" shows ${shown}, alone it gives ${alone}`)
      else if (both < Math.max(shown, after.totalPublished)) disjunctive.fail(`${dimension}: choosing both gives ${both}, fewer than either`)
      else disjunctive.pass()
    }
    // The facet total is the result count under every filter, facets included.
    const totals = check('facet total = result count, with facets and other filters chosen')
    for (let i = 0; i < 25; i++) {
      let filters: RecommendationSearchFilters = random() < 0.5 ? { rollingOnly: random() < 0.3, eligibleCountries: random() < 0.5 ? ['India'] : [] } : {}
      for (const dimension of pick(Object.keys(facets.facets) as DirectoryFacetDimension[], 1 + Math.floor(random() * 3))) {
        for (const item of pick(facets.facets[dimension] || [], 1 + Math.floor(random() * 2))) filters = toggleFacetValue(filters, dimension, item.value)
      }
      const query = random() < 0.3 ? 'cancer' : ''
      const after = await recommendationSearchService.getDirectoryFacets({ access, filters, query: query || undefined })
      const got = await serviceCount(filters, query)
      if (after.totalPublished === got) totals.pass()
      else totals.fail(`${JSON.stringify(filters)}${query ? ` + "${query}"` : ''}: facets total ${after.totalPublished}, results ${got}`)
    }
  }

  // ---------------------------------------------------------------- report
  if (unreachable.length > 0) {
    console.log(`NOTE  stored values outside the filter vocabulary (no filter reaches them; data to clean): ${unreachable.join(', ')}`)
  }
  let failed = 0
  for (const entry of checks) {
    const bad = entry.failures.length
    failed += bad > 0 ? 1 : 0
    console.log(`${bad === 0 ? 'PASS' : 'FAIL'}  ${entry.name}: ${entry.total - bad}/${entry.total}`)
    for (const failure of entry.failures.slice(0, VERBOSE ? 50 : 6)) console.log(`        ${failure}`)
    if (bad > (VERBOSE ? 50 : 6)) console.log(`        … ${bad - (VERBOSE ? 50 : 6)} more`)
  }
  console.log(failed === 0 ? '\nAll directory filter checks pass.' : `\n${failed} check(s) failed.`)
  process.exitCode = failed === 0 ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
