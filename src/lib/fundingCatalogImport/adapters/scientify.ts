/**
 * ScientifyResearch adapter: one crawler record → NormalizedExternalCall.
 *
 * Pure mapping (no database). Field meanings were checked against the crawl:
 *   residence (applicant's current location) = `mul` tags + `my-primary-locations`
 *   citizenship                              = `multi-citizenship` + `recipient-citizenship`
 *   host (where the work happens)            = `multi-location` + `host-location`
 * A "Global" group tag means any country; the site expands it into a ~210
 * country list, which is not stored. Region tags keep the record's own list.
 */
import { buildDimension, type EligibilityDimension } from '@/lib/funding/eligibility'
import { countryNameFor, resolveCountryList } from '@/lib/geo/countries'

import { lookup, splitList, type ScientifyCrosswalks } from '../crosswalks'
import { deriveLifecycle } from '../normalize/deadlines'
import { parseAmount, parseDurationMonths } from '../normalize/money'
import { cleanInline, cleanText, matchKey, uniqueStrings } from '../normalize/text'
import { splitBilingualTitle } from '../normalize/titles'
import type { NormalizedExternalCall, NormalizedExternalFunder } from '../types'

export const SCIENTIFY_REGIONS_VERSION = 'scientify-source-defined-2026-10'

type Json = Record<string, any>

const CLOSED_MARKER = /^this grant is currently closed/i
const ROLLING_MARKER = /^rolling submissions/i

function taxonomy(record: Json, key: string): string[] {
  const values = record?.taxonomies?.[key]
  return Array.isArray(values) ? values.map((value: unknown) => cleanInline(value)).filter(Boolean) : []
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  const text = String(value)
  // WordPress *_gmt values have no zone designator but are UTC.
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function safeUrl(value: unknown): string | null {
  const text = cleanInline(value)
  if (!text) return null
  try {
    const url = new URL(text)
    return /^https?:$/.test(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

/** "Hong Kong Research Grants Council (RGC)" → RGC. */
export function acronymOf(name: string): string | null {
  const match = /\(([A-Z][A-Z0-9&.\-]{1,14})\)\s*$/.exec(name)
  return match ? match[1] : null
}

export function normalizeFunderName(name: string): string {
  return matchKey(name.replace(/\(([^()]*)\)\s*$/, ' '))
    .replace(/\b(the|inc|ltd|llc|gmbh|foundation for|fund for)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function mapScientifyFunder(record: Json): NormalizedExternalFunder {
  const name = cleanInline(record.name)
  const location = resolveCountryList(taxonomy(record, 'location'))
  return {
    sourceKey: 'scientify',
    externalId: String(record.id),
    slug: record.slug ? String(record.slug) : null,
    sourceUrl: safeUrl(record.url),
    name,
    normalizedName: normalizeFunderName(name),
    acronym: acronymOf(name),
    countryCode: location.codes.length === 1 ? location.codes[0] : null,
    regionCode: location.tokens.includes('EU') ? 'EU' : null,
    description: cleanText(record.description) || null,
    sourcePublishedAt: toDate(record.published_gmt),
    sourceModifiedAt: toDate(record.modified_gmt),
    rawPayload: record,
  }
}

const INDIRECT_COST: Record<string, string> = {
  'indirect costs included': 'INCLUDED',
  'direct costs only': 'DIRECT_ONLY',
  'co fund': 'CO_FUND',
  'not specified not applicable': 'UNSPECIFIED',
}

const ELIGIBLE_REGION_FOR_CODE: Record<string, string> = {
  EUROPE_PLUS: 'Europe',
  NORDICS: 'Europe',
  BALTICS: 'Europe',
  EU: 'European Union',
  AFRICA: 'Africa',
  ASIA: 'Asia',
  LATIN_AMERICA: 'South America',
  PACIFIC: 'Oceania',
}

function namesFor(dimension: EligibilityDimension, limit = 40): string[] {
  if (dimension.scope !== 'COUNTRIES' && dimension.scope !== 'REGIONS') return []
  if (dimension.countryCodes.length === 0 || dimension.countryCodes.length > limit) return []
  return dimension.countryCodes.map(countryNameFor)
}

function describeDimension(label: string, dimension: EligibilityDimension): string | null {
  if (!dimension.scope || dimension.scope === 'UNSPECIFIED') return null
  if (dimension.scope === 'ANY') return `${label}: any country${dimension.regionCodes.includes('ONLINE') ? ' (online)' : ''}`
  const regions = dimension.regionCodes.filter((code) => code !== 'ONLINE')
  const names = dimension.countryCodes.map(countryNameFor)
  const shown = names.slice(0, 8).join(', ')
  const more = names.length > 8 ? ` and ${names.length - 8} more` : ''
  const regionText = regions.length > 0 ? `${regions.join(', ')}${names.length > 0 ? ' — ' : ''}` : ''
  return `${label}: ${regionText}${shown}${more}`
}

export function mapScientifyGrant(
  record: Json,
  context: { crosswalks: ScientifyCrosswalks; funderById: Map<string, NormalizedExternalFunder>; today: string }
): NormalizedExternalCall {
  const { crosswalks } = context
  const unmapped: Array<{ vocabulary: string; label: string }> = []
  const title = cleanInline(record.title)
  const otherFields = record.other_detail_fields && typeof record.other_detail_fields === 'object' ? Object.keys(record.other_detail_fields) : []
  const sourceClosed = otherFields.some((key) => CLOSED_MARKER.test(key))
  const isRolling = otherFields.some((key) => ROLLING_MARKER.test(key))
  const detailMissing = !record.fetched_at

  // Funders: the detail page's list, else the single funder fields.
  const fundersList: Array<{ id: string; name: string }> = Array.isArray(record.funders) && record.funders.length > 0
    ? record.funders.map((f: Json) => ({ id: String(f.id), name: cleanInline(f.name) }))
    : record.funder_id
      ? [{ id: String(record.funder_id), name: cleanInline(record.funder_name) }]
      : []
  const primaryFunder = fundersList[0] ? context.funderById.get(fundersList[0].id) : undefined

  const location = resolveCountryList(taxonomy(record, 'location'))
  const funderCountryCode = primaryFunder?.countryCode || (location.codes.length === 1 ? location.codes[0] : null)
  const funderRegionCode = primaryFunder?.regionCode || (location.tokens.includes('EU') ? 'EU' : null)

  const regionCodeForTag = (tag: string) => {
    const row = lookup(crosswalks.regions, tag)
    if (!row) {
      unmapped.push({ vocabulary: 'region', label: tag })
      return null
    }
    return row.region_code === 'ANY' ? 'ANY' : row.region_code || null
  }
  const residence = buildDimension({ groupTags: taxonomy(record, 'mul'), countryValues: taxonomy(record, 'my-primary-locations'), regionCodeForTag })
  const citizenship = buildDimension({ groupTags: taxonomy(record, 'multi-citizenship'), countryValues: taxonomy(record, 'recipient-citizenship'), regionCodeForTag })
  const host = buildDimension({ groupTags: taxonomy(record, 'multi-location'), countryValues: taxonomy(record, 'host-location'), regionCodeForTag })
  const unknownCountryValues = uniqueStrings([...residence.unknownValues, ...citizenship.unknownValues, ...host.unknownValues, ...location.unknown])

  const lifecycle = deriveLifecycle({
    deadlines: Array.isArray(record.deadlines) ? record.deadlines : [],
    isRolling,
    sourceClosed,
    funderCountryCode,
    funderRegionCode,
    today: context.today,
  })

  // Vocabularies.
  const fundingKinds = new Set<string>()
  for (const label of taxonomy(record, 'grant-type')) {
    const row = lookup(crosswalks.grantTypes, label)
    if (!row) unmapped.push({ vocabulary: 'grant-type', label })
    else splitList(row.funding_kinds).forEach((kind) => fundingKinds.add(kind))
  }
  const careerStages = new Set<string>()
  const institutionTypes = new Set<string>()
  for (const label of taxonomy(record, 'career-stage')) {
    const row = lookup(crosswalks.careerStages, label)
    if (!row) unmapped.push({ vocabulary: 'career-stage', label })
    else {
      splitList(row.career_stages).forEach((stage) => careerStages.add(stage))
      splitList(row.institution_types).forEach((type) => institutionTypes.add(type))
    }
  }
  let sponsorType: string | null = null
  const funderTypeVotes: string[] = []
  for (const label of taxonomy(record, 'funding-sources')) {
    const row = lookup(crosswalks.fundingSources, label)
    if (!row) unmapped.push({ vocabulary: 'funding-sources', label })
    else {
      sponsorType = sponsorType || row.sponsor_type || null
      if (row.funder_type) funderTypeVotes.push(row.funder_type)
    }
  }
  const disciplines = taxonomy(record, 'discipline')
  const areaCodes = new Set<string>()
  for (const label of disciplines) {
    const row = lookup(crosswalks.disciplines, label)
    if (!row) unmapped.push({ vocabulary: 'discipline', label })
    else splitList(row.research_area_codes).forEach((code) => areaCodes.add(code))
  }
  if (areaCodes.size === 0) {
    // Broad subject only when no specific discipline mapped.
    for (const label of taxonomy(record, 'my-subject')) {
      const row = lookup(crosswalks.subjects, label)
      if (!row) unmapped.push({ vocabulary: 'my-subject', label })
      else splitList(row.research_area_codes).forEach((code) => areaCodes.add(code))
    }
  }

  const challenges = taxonomy(record, 'challenge')
  const sdgGoals = Array.from(new Set(challenges.map((c) => /^SDG\s?(\d{1,2})\b/i.exec(c)).filter(Boolean).map((m) => Number(m![1])).filter((n) => n >= 1 && n <= 17))).sort((a, b) => a - b)

  const indirect = taxonomy(record, 'indirect-cost')[0]
  const indirectCostPolicy = indirect ? INDIRECT_COST[matchKey(indirect)] || 'UNSPECIFIED' : null
  const workRights = taxonomy(record, 'legal-working-rights')
  const nomination = taxonomy(record, 'nomination')
  const requiresNomination = nomination.length > 0 ? true : null
  const nominationNote = nomination.length > 0 ? nomination.join('; ') : null

  const amount = parseAmount(record.amount_raw, { funderCountryCode })
  const duration = parseDurationMonths(record.duration_raw)
  const horizon = taxonomy(record, 'horizon')

  const geographyScope = residence.dimension.scope === 'ANY' && citizenship.dimension.scope === 'ANY'
    ? 'Global'
    : residence.dimension.scope === 'REGIONS'
      ? 'Regional'
      : residence.dimension.scope === 'COUNTRIES' && residence.dimension.countryCodes.length === 1 && residence.dimension.countryCodes[0] === funderCountryCode
        ? 'National'
        : 'International'

  const eligibilityText = [
    describeDimension('Applicants based in', residence.dimension),
    describeDimension('Citizenship', citizenship.dimension),
    describeDimension('Work carried out in', host.dimension),
  ].filter(Boolean).join('\n') || null

  return {
    sourceKey: 'scientify',
    externalId: String(record.id),
    slug: record.slug ? String(record.slug) : null,
    sourceUrl: safeUrl(record.url),
    sourcePublishedAt: toDate(record.published_gmt),
    sourceModifiedAt: toDate(record.modified_gmt),
    fetchedAt: toDate(record.fetched_at),
    sourceUnavailable: Boolean(record.detail_error),
    sourceError: record.detail_error ? String(record.detail_error) : null,
    detailMissing,
    title,
    titleNative: splitBilingualTitle(title).native,
    description: cleanText(record.description) || null,
    summary: cleanInline(record.seo_description) || null,
    applyUrl: safeUrl(record.apply_url),
    funderExternalIds: fundersList.map((f) => f.id),
    funderNames: fundersList.map((f) => context.funderById.get(f.id)?.name || f.name).filter(Boolean),
    funderCountryCode,
    funderRegionCode,
    amount,
    durationText: duration.text,
    durationMinMonths: duration.min,
    durationMaxMonths: duration.max,
    lifecycle,
    residence: residence.dimension,
    citizenship: citizenship.dimension,
    host: host.dimension,
    regionsVersion: SCIENTIFY_REGIONS_VERSION,
    unknownCountryValues,
    eligibilityText,
    geographyScope,
    eligibleCountryNames: namesFor(residence.dimension),
    hostCountryNames: namesFor(host.dimension),
    eligibleRegions: uniqueStrings(
      [...residence.dimension.regionCodes, ...host.dimension.regionCodes].map((code) => ELIGIBLE_REGION_FOR_CODE[code]).filter(Boolean)
    ),
    citizenshipRequirements:
      citizenship.dimension.scope === 'COUNTRIES' && citizenship.dimension.countryCodes.length <= 40
        ? [`Citizens of: ${citizenship.dimension.countryCodes.map(countryNameFor).join(', ')}`]
        : [],
    funderCountryName: funderCountryCode ? countryNameFor(funderCountryCode) : funderRegionCode === 'EU' ? 'European Union' : null,
    fundingKinds: Array.from(fundingKinds),
    careerStages: Array.from(careerStages),
    institutionTypes: Array.from(institutionTypes),
    sponsorType,
    funderTypeVotes,
    disciplines,
    researchAreaCodes: Array.from(areaCodes).sort(),
    sdgGoals,
    challengeTags: challenges,
    indirectCostPolicy,
    workRightsRequired: workRights.some((w) => /required or implied/i.test(w)) ? true : null,
    requiresNomination,
    nominationNote,
    requiredQualifications: taxonomy(record, 'recipient-qualification').filter((q) => !/^not specified$/i.test(q)),
    targetGroups: taxonomy(record, 'diversities'),
    membershipRequirements: taxonomy(record, 'society-memberships').filter((m) => /members only/i.test(m)).map(() => 'Society membership required'),
    additionalBenefits: taxonomy(record, 'additional-benefit').filter((b) => !/not specified|not applicable/i.test(b)),
    programmeFramework: horizon.length > 0 ? `Horizon Europe › ${horizon.join(' › ')}` : null,
    contentLanguage: 'en',
    sourceFacets: {
      career_stage: taxonomy(record, 'career-stage'),
      grant_type: taxonomy(record, 'grant-type'),
      funding_sources: taxonomy(record, 'funding-sources'),
      subject: taxonomy(record, 'my-subject'),
      mobility: taxonomy(record, 'my-requirement'),
      legal_working_rights: workRights,
    },
    unmappedLabels: unmapped,
    rawPayload: record,
  }
}
