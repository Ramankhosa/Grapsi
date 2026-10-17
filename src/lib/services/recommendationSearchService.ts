import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { isFeatureEnabled } from '../feature-flags';
import { EmbeddingService } from './embeddingService';
import { voyageRerankService } from './voyageRerankService';
import { enrichRecommendationResultsWithDocumentEvidence } from '../fundingDocuments/evidence';
import {
  FUNDING_CHAT_QUERY_ENRICHMENT_STAGE_CODE,
  FUNDING_CHAT_TASK_CODE,
  runFundingGatewayText,
} from '../funding/llmRouting';
import { extractJsonObject } from '../recommendations/conversationUtils';
import { sanitizeExternalUrls } from '../urlSafety';
import { withVectorSearchSettings } from '../vectorSearch';
import { applicantGeographyFromProfile, eligibilityVerdictForRow, type ApplicantGeography } from '../funding/eligibility';
import type {
  RecommendationDirectoryRequest,
  RecommendationDirectoryResponse,
  DirectoryFacetRequest,
  DirectoryFacetResponse,
  DirectoryFacetDimension,
  DirectoryFacetItem,
  InternalRecommendationSearchResponse,
  NormalizedRecommendationSearchRequest,
  RecommendationAccessScope,
  RecommendationAreaBreakdownItem,
  RecommendationAreaMatch,
  RecommendationCandidate,
  RecommendationProfileMatch,
  RecommendationProfileSnapshot,
  RecommendationPublicationSnapshot,
  RecommendationRawResultItem,
  RecommendationSearchFilters,
  RecommendationSearchRequest,
  RecommendationSearchResponse,
  RecommendationSearchResultItem,
  RecommendationSelectedResearchArea,
  RecommendationStrictFilterRecovery,
} from '../recommendations/types';
import {
  MAX_SELECTED_RESEARCH_AREAS,
  MULTI_AREA_MATCH_BONUS,
  MULTI_AREA_MIN_SLOTS_PER_AREA,
  SDG_GOAL_LABELS,
  MOBILITY_SOURCE_VALUES,
  PROJECT_DURATION_BUCKETS,
} from '../recommendations/constants';
import { resolveCountryList } from '../geo/countries';
import { FACET_DIMENSION_FIELD, FACET_FILTER_FIELDS, type FacetFilterField } from '../recommendations/directorySelections';
import {
  buildCountryMatchKeys,
  createRequestHash,
  formatFundingAmount,
  normalizeCareerStageList,
  normalizeFundingKindList,
  normalizeGeographyScopeList,
  normalizeInstitutionTypeList,
  normalizeKey,
  normalizeRecommendationSearchRequest,
  normalizeRegionList,
  normalizeSponsorTypeList,
  normalizeQualificationList,
  normalizeTargetGroupList,
  normalizeIndirectCostList,
  normalizeMobilityList,
  normalizeProjectDurationList,
  normalizeApplicationRouteList,
  normalizeWhitespace,
} from '../recommendations/utils';

const embeddingService = new EmbeddingService();

const VECTOR_CANDIDATE_LIMIT = 60;
const FULLTEXT_CANDIDATE_LIMIT = 60;
const MERGED_CANDIDATE_LIMIT = 100;
const RERANK_CANDIDATE_LIMIT = 50;
const NO_RESULT_SCORE_THRESHOLD = 0.2;
const LOW_CONFIDENCE_THRESHOLD = 0.35;
const TOPIC_RELEVANCE_SEMANTIC_THRESHOLD = 0.45;
const RESEARCH_AREA_ENRICHMENT_MODEL = 'gemini-2.0-flash-lite';
const QUERY_ENRICHMENT_CACHE_VERSION = 'v1';
const QUERY_EMBEDDING_CACHE_VERSION_PREFIX = 'funding-query-v1';
const QUERY_EMBEDDING_TASK_TYPE = 'RETRIEVAL_QUERY' as const;
const STRICT_FILTER_RECOVERY_LADDER: Array<Array<keyof RecommendationSearchFilters>> = [
  ['taxonomyAreaIds'],
  ['careerStages', 'institutionTypes', 'sponsorTypes', 'citizenshipRequirements', 'residencyRequirements', 'applicationLanguages', 'sdgGoals', 'programmeFrameworks',
    'qualifications', 'projectDurations', 'targetGroups', 'indirectCostPolicies', 'mobility', 'applicationRoutes', 'noMembershipNeeded'],
  ['hostCountries', 'eligibleRegions', 'geographyScope', 'funderCountries'],
  ['eligibleCountries'],
  ['fundingKinds', 'funderIds'],
  ['deadlineFrom', 'deadlineTo', 'rollingOnly', 'amountMin', 'amountMax', 'amountCurrency', 'includeUnknownAmount'],
];

type SearchExecutionResult = {
  candidates: RecommendationCandidate[];
  degradedMode: 'full_text_only' | null;
};

type SearchExecutionOptions = {
  queryVectorLiteral?: string | null;
};

type ScoredCandidate = {
  candidate: RecommendationCandidate;
  score: number;
  profileMatch: RecommendationProfileMatch | null;
};

type RankedExecution = {
  filteredScored: ScoredCandidate[];
  topScore: number;
  lowConfidence: boolean;
};

type ResearchAreaEnrichmentCacheInput = {
  requestHash: string;
  rawQuery: string;
  normalizedQuery: string;
};

function sqlLowerTextArray(values: string[]) {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value.toLowerCase()}`))}]::text[]`;
}

function sqlTextArray(values: string[]) {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}`))}]::text[]`;
}

function combineConditions(conditions: Prisma.Sql[]) {
  return conditions.reduce((combined, condition, index) => {
    if (index === 0) {
      return condition;
    }
    return Prisma.sql`${combined} AND ${condition}`;
  }, Prisma.sql`TRUE`);
}

/**
 * The forms a filter value may be stored in: as typed (lowercased) and as its
 * normalizeKey form. normalizeKey strips punctuation, so matching only on it
 * missed stored values that keep theirs ("Award / Prize", "Côte d'Ivoire").
 */
function filterMatchKeys(values: string[]) {
  return Array.from(
    new Set(values.flatMap((value) => [normalizeWhitespace(value).toLowerCase(), normalizeKey(value)]).filter(Boolean))
  );
}

function buildArrayAnyCondition(columnName: string, values: string[]) {
  const lowered = sqlLowerTextArray(filterMatchKeys(values));
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM unnest(${Prisma.raw(columnName)}) AS value
      WHERE LOWER(value) = ANY(${lowered})
    )
  `;
}

function buildScalarAnyCondition(columnName: string, values: string[]) {
  const lowered = sqlLowerTextArray(filterMatchKeys(values));
  return Prisma.sql`LOWER(COALESCE(${Prisma.raw(columnName)}, '')) = ANY(${lowered})`;
}

/**
 * One side of an amount filter. 'min': the call's largest amount must reach
 * the bound; 'max': its smallest must not exceed it.
 *
 * Without amountCurrency the call's own numbers are compared whatever its
 * currency (the original behaviour). With it, a call in that currency
 * compares its own numbers, and any other call compares its USD estimate
 * against the bound converted at the latest stored rate. A call that cannot be
 * compared (no amount, or another currency and no estimate) passes only with
 * includeUnknownAmount.
 */
function buildAmountBoundCondition(
  filters: Required<RecommendationSearchFilters>,
  side: 'min' | 'max',
  value: number
) {
  const raw = side === 'min' ? Prisma.sql`COALESCE(amount_max, amount_min)` : Prisma.sql`COALESCE(amount_min, amount_max)`;
  const usd =
    side === 'min'
      ? Prisma.sql`COALESCE(amount_max_usd_est, amount_min_usd_est)`
      : Prisma.sql`COALESCE(amount_min_usd_est, amount_max_usd_est)`;
  const op = side === 'min' ? Prisma.sql`>=` : Prisma.sql`<=`;

  if (!filters.amountCurrency) {
    const known = Prisma.sql`(${raw} IS NOT NULL AND ${raw} ${op} ${value})`;
    return filters.includeUnknownAmount ? Prisma.sql`(${raw} IS NULL OR ${known})` : known;
  }

  const code = filters.amountCurrency;
  const sameCurrency = Prisma.sql`(UPPER(COALESCE(currency_code, currency, '')) = ${code})`;
  const usdPerUnit = Prisma.sql`(SELECT usd_per_unit FROM currency_rates WHERE currency = ${code} ORDER BY as_of DESC LIMIT 1)`;
  const comparableHere = Prisma.sql`(${sameCurrency} AND ${raw} IS NOT NULL)`;
  const comparableInUsd = Prisma.sql`(NOT ${sameCurrency} AND ${usd} IS NOT NULL)`;
  const passes = Prisma.sql`(
    (${comparableHere} AND ${raw} ${op} ${value}) OR
    (${comparableInUsd} AND ${usd} ${op} ${value} * ${usdPerUnit})
  )`;
  return filters.includeUnknownAmount
    ? Prisma.sql`(${passes} OR NOT (${comparableHere} OR ${comparableInUsd}))`
    : passes;
}

/**
 * Calls of the chosen funders. Calls with no funder link (curated calls until
 * the Phase E backfill links them) match when their agency name is the
 * funder's name, acronym or an alias.
 */
function buildFunderCondition(funderIds: string[]) {
  const ids = sqlTextArray(funderIds);
  return Prisma.sql`(
    funder_id = ANY(${ids})
    OR (
      funder_id IS NULL
      AND COALESCE(NULLIF(TRIM(agency_name), ''), NULLIF(TRIM("agencyName"), '')) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM funders funder_filter
        WHERE funder_filter.id = ANY(${ids})
          AND LOWER(COALESCE(NULLIF(TRIM(agency_name), ''), TRIM("agencyName"))) IN (
            SELECT LOWER(TRIM(name_option))
            FROM unnest(ARRAY[funder_filter.name, funder_filter.acronym] || funder_filter.aliases) AS name_option
            WHERE COALESCE(TRIM(name_option), '') <> ''
          )
      )
    )
  )`;
}

function buildTaxonomyAreaCondition(areaIds: string[], callId: Prisma.Sql = Prisma.raw('funding_calls.id')) {
  const ids = sqlTextArray(areaIds);
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM funding_call_research_area_taxonomies taxonomy_filter
      WHERE taxonomy_filter.funding_call_id = ${callId}
        AND taxonomy_filter.taxonomy_area_id = ANY(${ids})
    )
  `;
}

/**
 * The taxonomy text of a call's research-area mappings, as a tsvector. Must
 * stay identical to the expression of the GIN index
 * funding_call_research_area_taxonomies_text_idx (migration
 * 20261016110000), or that index is not used.
 */
function taxonomyTextVectorSql(alias: string) {
  const column = (name: string) => Prisma.raw(`${alias}."${name}"`);
  return Prisma.sql`to_tsvector(
    'english',
    coalesce(${column('taxonomy_level1_code')}, '') || ' ' || coalesce(${column('taxonomy_level1_name')}, '') || ' ' ||
    coalesce(${column('taxonomy_level2_code')}, '') || ' ' || coalesce(${column('taxonomy_level2_name')}, '')
  )`;
}

/**
 * A call matches a text query when its own document or one of its taxonomy
 * mappings does. Written as a UNION of ids so both halves use their GIN
 * index; the OR-EXISTS form it replaces (FINDER_FTS_UNION=0) recomputed
 * to_tsvector for every mapping row of every candidate call. Same rows by
 * construction; verified with scripts/benchmark-call-text-search.ts.
 */
function buildFundingCallTextSearchCondition(fullTextQuery: string) {
  if (process.env.FINDER_FTS_UNION === '0') {
    return legacyFundingCallTextSearchCondition(fullTextQuery);
  }
  return Prisma.sql`funding_calls.id IN (
    SELECT text_call.id
    FROM funding_calls text_call
    WHERE text_call.ts_document @@ websearch_to_tsquery('english', ${fullTextQuery})
    UNION
    SELECT taxonomy_text.funding_call_id
    FROM funding_call_research_area_taxonomies taxonomy_text
    WHERE ${taxonomyTextVectorSql('taxonomy_text')} @@ websearch_to_tsquery('english', ${fullTextQuery})
  )`;
}

export function legacyFundingCallTextSearchCondition(fullTextQuery: string) {
  return Prisma.sql`(
    ts_document @@ websearch_to_tsquery('english', ${fullTextQuery})
    OR EXISTS (
      SELECT 1
      FROM funding_call_research_area_taxonomies taxonomy_text
      WHERE taxonomy_text.funding_call_id = funding_calls.id
        AND to_tsvector(
          'english',
          CONCAT_WS(
            ' ',
            taxonomy_text.taxonomy_level1_code,
            taxonomy_text.taxonomy_level1_name,
            taxonomy_text.taxonomy_level2_code,
            taxonomy_text.taxonomy_level2_name
          )
        ) @@ websearch_to_tsquery('english', ${fullTextQuery})
    )
  )`;
}

export { buildFundingCallTextSearchCondition };

function buildAccessCondition(access?: RecommendationAccessScope) {
  if (access?.isSuperAdmin) {
    return Prisma.sql`TRUE`;
  }

  // GLOBAL_CATALOG is the imported external catalogue: discoverable by every
  // researcher, but kept out of funding-department workflows (which only
  // read GLOBAL_PUBLISHED).
  if (access?.tenantId) {
    return Prisma.sql`(
      visibility = 'GLOBAL_PUBLISHED' OR visibility = 'GLOBAL_CATALOG' OR
      (visibility = 'TENANT_PRIVATE' AND "tenantId" = ${access.tenantId})
    )`;
  }

  return Prisma.sql`(visibility = 'GLOBAL_PUBLISHED' OR visibility = 'GLOBAL_CATALOG')`;
}

/**
 * Imported calls carry facts legacy calls do not: the source saying a call is
 * closed, and a letter-of-intent date after which new applicants cannot
 * enter. Both columns are NULL on every pre-existing call, so this guard can
 * only ever remove imported calls.
 */
function importedLifecycleGuard() {
  // Scoped to imported rows on purpose: a backfill may later fill
  // entry_closes_at on curated calls, and their open/closed rule must not
  // change because of it.
  return Prisma.sql`(
    import_run_id IS NULL OR (
      source_closed_at IS NULL AND
      (entry_closes_at IS NULL OR entry_closes_at >= CURRENT_DATE)
    )
  )`;
}

/**
 * Imported calls open to applicants from at least one of the countries: for
 * some requested country, every listed dimension (residence, citizenship, or
 * host) admits it. This is the eligibility badge's rule (evaluateDimension in
 * lib/funding/eligibility: anything but INELIGIBLE), so a filter and the badge
 * cannot disagree. Per country, so "India or Kenya" does not pass a call that
 * takes residents of India only if they are Kenyan citizens.
 */
export function importedDimensionCountryCondition(dimensions: Array<'residence' | 'citizenship' | 'host'>, codes: string[]) {
  const codeArray = Prisma.sql`ARRAY[${Prisma.join(codes.map((code) => Prisma.sql`${code}`))}]::text[]`;
  const admits = (dimension: 'residence' | 'citizenship' | 'host') => {
    const scope = Prisma.raw(`${dimension}_scope`);
    const list = Prisma.raw(`${dimension}_country_codes`);
    const excluded = Prisma.raw(`${dimension}_excluded_codes`);
    // A source exclusion is explicit ("worldwide except Iran"): the call does
    // not come back for Iran, or its own badge would then read "Not eligible".
    return Prisma.sql`(
      requested.code <> ALL(${excluded}) AND (
        ${scope} IS NULL OR ${scope} IN ('ANY', 'UNSPECIFIED') OR
        (${scope} = 'REGIONS' AND cardinality(${list}) = 0) OR
        requested.code = ANY(${list})
      )
    )`;
  };
  return Prisma.sql`(import_run_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(${codeArray}) AS requested(code)
    WHERE ${Prisma.join(dimensions.map(admits), ' AND ')}
  ))`;
}

/**
 * Curated calls open to applicants from one of the countries: their country
 * list names it, or their evaluated applicant dimension (the existing-call
 * backfill) makes them eligible, a worldwide call above all, which the list
 * match alone missed while its badge said "Eligible". Before the backfill the
 * dimension is NULL and only the list counts, as before.
 */
function curatedCountryCondition(names: string[], codes: string[]) {
  const listed = buildArrayAnyCondition('eligible_countries', buildCountryMatchKeys(names));
  if (codes.length === 0) return Prisma.sql`(import_run_id IS NULL AND ${listed})`;
  const codeArray = Prisma.sql`ARRAY[${Prisma.join(codes.map((code) => Prisma.sql`${code}`))}]::text[]`;
  return Prisma.sql`(import_run_id IS NULL AND (${listed} OR EXISTS (
    SELECT 1 FROM unnest(${codeArray}) AS requested(code)
    WHERE requested.code <> ALL(applicant_excluded_codes) AND (
      applicant_scope = 'ANY' OR
      (applicant_scope IN ('COUNTRIES', 'REGIONS') AND requested.code = ANY(applicant_country_codes))
    )
  )))`;
}

function countryCodesForFilter(values: string[]) {
  return resolveCountryList(values).codes;
}

/**
 * Curated calls before imported catalogue calls, for the browse listing.
 *
 * Every imported call is inserted in one run, so all ~10,000 carry that day's
 * `updatedAt` — newer than almost every curated call. Ordering the browse
 * listing by recency alone put the first curated call on page 105 of the dev
 * catalogue (2,096th of 2,104 open calls): an institution's own published
 * calls became unreachable by browsing. It is a sort key here, not a score:
 * where the listing has a stronger signal (a text rank, a nearer deadline)
 * that still decides, and this only breaks the tie.
 */
const CURATED_FIRST_SQL = Prisma.sql`(import_run_id IS NULL) DESC`;

/** The source's mobility facet of a call row (imported calls only). */
const MOBILITY_SQL = Prisma.raw(`(metadata #> '{catalog_import,source_facets,mobility}')`);

/**
 * Project length buckets: the call's stated range overlaps one. A call that
 * states only a maximum ("up to 24 months") could run from a month to it; one
 * that states only a minimum runs for exactly that long.
 */
function projectDurationCondition(buckets: string[]) {
  const low = Prisma.sql`COALESCE(project_duration_min_months, 1)`;
  const high = Prisma.sql`COALESCE(project_duration_max_months, project_duration_min_months)`;
  const parts = buckets
    .map((bucket) => PROJECT_DURATION_BUCKETS[bucket])
    .filter(Boolean)
    .map(({ months: [from, to] }) =>
      to === null ? Prisma.sql`(${high} >= ${from})` : Prisma.sql`(${low} <= ${to} AND ${high} >= ${from})`
    );
  if (parts.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`(${high} IS NOT NULL AND (${Prisma.join(parts, ' OR ')}))`;
}

/**
 * How applications reach the funder, read from the nomination note ("By
 * nomination only", "By nomination (including self-nomination)", "Limited
 * submissions", joined with "; "). No note: nothing stated.
 */
const APPLICATION_ROUTE_SQL: Record<string, Prisma.Sql> = {
  not_stated: Prisma.sql`(COALESCE(nomination_note, '') = '')`,
  self_nomination: Prisma.sql`(position('self-nomination' in lower(COALESCE(nomination_note, ''))) > 0)`,
  nomination_only: Prisma.sql`(position('by nomination only' in lower(COALESCE(nomination_note, ''))) > 0)`,
  limited_submissions: Prisma.sql`(position('limited submissions' in lower(COALESCE(nomination_note, ''))) > 0)`,
};

function mobilityCondition(values: string[], mobility: Prisma.Sql) {
  const sourceValues = values.map((value) => MOBILITY_SOURCE_VALUES[value]).filter(Boolean);
  if (sourceValues.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${mobility}) = 'array' THEN ${mobility} ELSE '[]'::jsonb END) AS mobility_value(value)
    WHERE mobility_value.value = ANY(${sqlTextArray(sourceValues)})
  )`;
}

/**
 * The condition of one facet-able filter (values are alternatives), or null
 * when nothing is chosen. Reads unqualified columns, so the directory facets
 * can apply it to their materialized row set; callId names the row's id there,
 * mobility the row's mobility facet.
 */
function facetFilterCondition(
  field: FacetFilterField,
  filters: Required<RecommendationSearchFilters>,
  callId: Prisma.Sql = Prisma.raw('funding_calls.id'),
  mobility: Prisma.Sql = MOBILITY_SQL
): Prisma.Sql | null {
  const values = filters[field];
  if (!values || values.length === 0) return null;
  switch (field) {
    case 'geographyScope':
      return buildScalarAnyCondition('geography_scope', values);
    case 'fundingKinds':
      return buildArrayAnyCondition('funding_kinds', values);
    case 'institutionTypes':
      return buildArrayAnyCondition('institution_types', values);
    case 'careerStages':
      return buildArrayAnyCondition('career_stages', values);
    case 'sponsorTypes':
      return buildScalarAnyCondition('sponsor_type', values);
    case 'eligibleRegions':
      return buildArrayAnyCondition('eligible_regions', values);
    case 'taxonomyAreaIds':
      return buildTaxonomyAreaCondition(values, callId);
    case 'funderIds':
      return buildFunderCondition(values);
    case 'sdgGoals':
      return Prisma.sql`sdg_goals && ARRAY[${Prisma.join(values.map((goal) => Prisma.sql`${Number(goal)}`))}]::int[]`;
    case 'programmeFrameworks':
      // Prefix match on the "›" path, so a programme also matches its clusters.
      return Prisma.sql`EXISTS (
        SELECT 1 FROM unnest(${sqlTextArray(values)}) AS programme
        WHERE LOWER(programme_framework) = LOWER(programme)
           OR starts_with(LOWER(programme_framework), LOWER(programme) || ' › ')
      )`;
    case 'qualifications':
      return buildArrayAnyCondition('required_qualifications', values);
    case 'targetGroups':
      return buildArrayAnyCondition('target_groups', values);
    case 'indirectCostPolicies':
      return buildScalarAnyCondition('indirect_cost_policy', values);
    case 'projectDurations':
      return projectDurationCondition(values);
    case 'mobility':
      return mobilityCondition(values, mobility);
    case 'applicationRoutes': {
      const parts = values.map((value) => APPLICATION_ROUTE_SQL[value]).filter(Boolean);
      return parts.length > 0 ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`FALSE`;
    }
  }
}

/** Members-only calls: a society membership is required to apply. */
const MEMBERSHIP_REQUIRED_SQL = Prisma.sql`(cardinality(membership_requirements) > 0)`;

/** Facets whose values come from a controlled vocabulary (normalizer per facet). */
const FACET_VOCABULARY: Partial<Record<DirectoryFacetDimension, (values: string[]) => string[] | null>> = {
  fundingKind: normalizeFundingKindList,
  careerStage: normalizeCareerStageList,
  institutionType: normalizeInstitutionTypeList,
  sponsorType: normalizeSponsorTypeList,
  region: normalizeRegionList,
  geographyScope: normalizeGeographyScopeList,
  qualification: normalizeQualificationList,
  targetGroup: normalizeTargetGroupList,
  // UNSPECIFIED is not offered: "not stated" is not a policy.
  indirectCosts: normalizeIndirectCostList,
  mobility: normalizeMobilityList,
  projectDuration: normalizeProjectDurationList,
  applicationRoute: normalizeApplicationRouteList,
};

/**
 * The directory's search box: the words as typed, in web-search syntax. All
 * words are required; `or` between words offers alternatives, `-word`
 * excludes and "quoted words" are a phrase. No synonym expansion: that is the
 * AI advisor's job, and OR-ing every word made "climate change india" return
 * anything mentioning "change". A query of stop words only filters nothing.
 */
function directoryTextCondition(rawQuery: string) {
  return Prisma.sql`(
    numnode(websearch_to_tsquery('english', ${rawQuery})) = 0 OR ${buildFundingCallTextSearchCondition(rawQuery)}
  )`;
}

function buildBaseConditions(
  normalized: NormalizedRecommendationSearchRequest,
  ignoreUserFilters = false,
  access?: RecommendationAccessScope
) {
  const { filters } = normalized;
  const conditions: Prisma.Sql[] = [
    Prisma.sql`(status = 'PUBLISHED' OR catalog_status = 'PUBLISHED')`,
    Prisma.sql`COALESCE(is_active, true) = true`,
    buildAccessCondition(access),
  ];

  if (!filters.includeExpired) {
    conditions.push(
      Prisma.sql`(
        COALESCE(is_rolling, false) = true OR
        COALESCE(close_date, expiration_date) IS NULL OR
        COALESCE(close_date, expiration_date) >= CURRENT_DATE
      )`
    );
    conditions.push(importedLifecycleGuard());
  }

  if (ignoreUserFilters) {
    return conditions;
  }

  if (filters.rollingOnly) {
    conditions.push(Prisma.sql`COALESCE(is_rolling, false) = true`);
  }

  if (filters.deadlineFrom) {
    conditions.push(Prisma.sql`COALESCE(close_date, expiration_date) >= ${filters.deadlineFrom}::date`);
  }

  if (filters.deadlineTo) {
    conditions.push(Prisma.sql`COALESCE(close_date, expiration_date) <= ${filters.deadlineTo}::date`);
  }

  if (filters.amountMin !== null) {
    conditions.push(buildAmountBoundCondition(filters, 'min', filters.amountMin));
  }

  if (filters.amountMax !== null) {
    conditions.push(buildAmountBoundCondition(filters, 'max', filters.amountMax));
  }

  for (const field of FACET_FILTER_FIELDS) {
    const condition = facetFilterCondition(field, filters);
    if (condition) conditions.push(condition);
  }

  if (filters.noMembershipNeeded) {
    conditions.push(Prisma.sql`NOT ${MEMBERSHIP_REQUIRED_SQL}`);
  }

  if (filters.applicationLanguages.length > 0) {
    // "Accepts this language, or does not say". Few calls state one (no
    // imported call does), so a plain match hid nearly the whole catalogue.
    conditions.push(
      Prisma.sql`(cardinality(application_languages) = 0 OR ${buildArrayAnyCondition('application_languages', filters.applicationLanguages)})`
    );
  }

  if (filters.eligibleCountries.length > 0) {
    const codes = countryCodesForFilter(filters.eligibleCountries);
    const curated = curatedCountryCondition(filters.eligibleCountries, codes);
    conditions.push(
      codes.length > 0
        ? Prisma.sql`(${curated} OR ${importedDimensionCountryCondition(['residence', 'citizenship'], codes)})`
        : curated
    );
  }

  if (filters.hostCountries.length > 0) {
    const legacy = buildArrayAnyCondition('host_countries', buildCountryMatchKeys(filters.hostCountries));
    const codes = countryCodesForFilter(filters.hostCountries);
    conditions.push(
      codes.length > 0
        ? Prisma.sql`((import_run_id IS NULL AND ${legacy}) OR ${importedDimensionCountryCondition(['host'], codes)})`
        : legacy
    );
  }

  if (filters.funderCountries.length > 0) {
    const legacy = buildScalarAnyCondition('funder_country', buildCountryMatchKeys(filters.funderCountries));
    const codes = countryCodesForFilter(filters.funderCountries);
    conditions.push(
      codes.length > 0
        ? Prisma.sql`((import_run_id IS NULL AND ${legacy}) OR (import_run_id IS NOT NULL AND funder_country_code = ANY(ARRAY[${Prisma.join(codes.map((code) => Prisma.sql`${code}`))}]::text[])))`
        : legacy
    );
  }

  // The applicant's citizenship and residence (countries). They only remove
  // calls that rule the applicant out; a call that does not say is kept.
  if (filters.citizenshipRequirements.length > 0) {
    const codes = countryCodesForFilter(filters.citizenshipRequirements);
    // A curated call's citizenship rule is free text that cannot be read
    // safely ("any country except India", Niger vs Nigeria), so curated
    // calls are kept; imported calls state it as a dimension.
    if (codes.length > 0) {
      conditions.push(Prisma.sql`(import_run_id IS NULL OR ${importedDimensionCountryCondition(['citizenship'], codes)})`);
    }
  }

  if (filters.residencyRequirements.length > 0) {
    const codes = countryCodesForFilter(filters.residencyRequirements);
    if (codes.length > 0) {
      // A curated call's one country list means residence or citizenship;
      // one with no country information at all is kept.
      const unstated = Prisma.sql`(import_run_id IS NULL AND cardinality(eligible_countries) = 0 AND COALESCE(applicant_scope, 'UNSPECIFIED') = 'UNSPECIFIED')`;
      conditions.push(
        Prisma.sql`(${curatedCountryCondition(filters.residencyRequirements, codes)} OR ${unstated} OR ${importedDimensionCountryCondition(['residence'], codes)})`
      );
    }
  }

  return conditions;
}

function selectCandidateColumns() {
  return Prisma.sql`
    id::text AS id,
    agency_name AS "agencyName",
    scheme_title AS "schemeTitle",
    description AS "shortDescription",
    NULL::text AS "fullDescription",
    description,
    close_date::text AS "closeDate",
    COALESCE(is_rolling, false) AS "isRolling",
    COALESCE(funding_kinds, ARRAY[]::text[]) AS "fundingKinds",
    COALESCE(disciplines, ARRAY[]::text[]) AS "disciplines",
    COALESCE(eligible_countries, ARRAY[]::text[]) AS "eligibleCountries",
    COALESCE(eligible_regions, ARRAY[]::text[]) AS "eligibleRegions",
    COALESCE(host_countries, ARRAY[]::text[]) AS "hostCountries",
    COALESCE(institution_types, ARRAY[]::text[]) AS "institutionTypes",
    COALESCE(career_stages, ARRAY[]::text[]) AS "careerStages",
    sponsor_type AS "sponsorType",
    COALESCE(official_urls, ARRAY[]::text[]) AS "officialUrls",
    amount_min AS "amountMin",
    amount_max AS "amountMax",
    currency,
    eligibility_text AS "eligibilityText",
    contact_info AS "contactInfo",
    geography_scope AS "geographyScope",
    funder_country AS "funderCountry",
    COALESCE(citizenship_requirements, ARRAY[]::text[]) AS "citizenshipRequirements",
    COALESCE(residency_requirements, ARRAY[]::text[]) AS "residencyRequirements",
    COALESCE(application_languages, ARRAY[]::text[]) AS "applicationLanguages",
    (visibility::text = 'GLOBAL_CATALOG') AS "isCatalog",
    (position('limited submissions' in lower(COALESCE(nomination_note, ''))) > 0) AS "limitedSubmissions",
    -- Imported catalogue calls carry facts only until enrichment fetches the
    -- official guidelines; authoring needs them. Grant Prep does not open
    -- catalogue calls yet (start-grant-prep reads without includeCatalog), so
    -- even an enriched one is not offered until that ships.
    (visibility::text <> 'GLOBAL_CATALOG') AS "authoringReady",
    CASE WHEN COALESCE(applicant_scope, residence_scope, citizenship_scope, host_scope) IS NULL THEN NULL
    ELSE jsonb_build_object(
      'applicant_scope', applicant_scope, 'applicant_country_codes', applicant_country_codes,
      'applicant_excluded_codes', applicant_excluded_codes, 'applicant_region_codes', applicant_region_codes,
      'residence_scope', residence_scope, 'residence_country_codes', residence_country_codes,
      'residence_excluded_codes', residence_excluded_codes, 'residence_region_codes', residence_region_codes,
      'citizenship_scope', citizenship_scope, 'citizenship_country_codes', citizenship_country_codes,
      'citizenship_excluded_codes', citizenship_excluded_codes, 'citizenship_region_codes', citizenship_region_codes,
      'host_scope', host_scope, 'host_country_codes', host_country_codes,
      'host_excluded_codes', host_excluded_codes, 'host_region_codes', host_region_codes
    ) END AS "eligibilityDimensions",
    COALESCE(
      ARRAY(
        SELECT taxonomy_tag.taxonomy_area_id
        FROM funding_call_research_area_taxonomies taxonomy_tag
        WHERE taxonomy_tag.funding_call_id = funding_calls.id
      ),
      ARRAY[]::text[]
    ) AS "taxonomyAreaIds"
  `;
}

function normalizeTextRank(value: number) {
  if (!value || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(value / 1.5, 1);
}

function parseDateValue(value: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeDeadlineFreshness(closeDate: string | null, isRolling: boolean) {
  if (isRolling) {
    return 0.25;
  }
  const parsed = parseDateValue(closeDate);
  if (!parsed) {
    return 0;
  }
  const days = Math.max(0, (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(0, 1 - Math.min(days, 365) / 365);
}

function overlapSignal(candidateValues: string[], queryValues: string[]) {
  if (queryValues.length === 0 || candidateValues.length === 0) {
    return 0;
  }
  const querySet = new Set(queryValues.map((value) => normalizeKey(value)));
  const candidateSet = new Set(candidateValues.map((value) => normalizeKey(value)));
  let hits = 0;
  candidateSet.forEach((value) => {
    if (querySet.has(value)) {
      hits += 1;
    }
  });
  return querySet.size === 0 ? 0 : hits / querySet.size;
}

function scalarSignal(candidateValue: string | null, queryValues: string[]) {
  if (!candidateValue || queryValues.length === 0) {
    return 0;
  }
  return queryValues.map((value) => normalizeKey(value)).includes(normalizeKey(candidateValue)) ? 1 : 0;
}

const TOPIC_STOP_TERMS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'to', 'of', 'on', 'in', 'with', 'from', 'by', 'at', 'as',
  'about', 'around', 'related', 'work', 'working', 'field', 'fields', 'area', 'areas', 'topic', 'topics',
  'funding', 'fund', 'funds', 'grant', 'grants', 'scheme', 'schemes', 'call', 'calls', 'opportunity',
  'opportunities', 'research', 'researcher', 'researchers', 'project', 'projects', 'program', 'programme',
  'support', 'supports', 'show', 'find', 'search', 'need', 'looking', 'give', 'option', 'options',
  'paper', 'article', 'abstract', 'title', 'study', 'studies', 'method', 'methods', 'approach', 'analysis',
  'result', 'results', 'develop', 'develops', 'development', 'evaluate', 'evaluates', 'propose', 'proposes',
  'system', 'systems', 'individual', 'individuals', 'person', 'people', 'suffering', 'centric',
]);

/**
 * normalizeKey for topic tokens: keeps letters of every script and folds
 * diacritics ("São" -> "sao", "Übergewicht" -> "ubergewicht"). normalizeKey
 * keeps only [a-z0-9], which mangled accented words and turned Hebrew, CJK or
 * Cyrillic text into no tokens at all, so the topic gate could not judge
 * non-English calls.
 */
export function normalizeTopicKey(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTopicToken(token: string) {
  const normalized = normalizeTopicKey(token);
  if (!normalized || TOPIC_STOP_TERMS.has(normalized)) {
    return '';
  }
  if (normalized.endsWith('ies') && normalized.length > 5) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('ses') && normalized.length > 5) {
    return normalized.slice(0, -2);
  }
  if (normalized.endsWith('s') && normalized.length > 4) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function tokenizeTopicText(input: string, maxTokens = 40) {
  const tokens = normalizeTopicKey(input)
    .split(/\s+/)
    .map(normalizeTopicToken)
    .filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, maxTokens);
}

function buildCandidateTopicText(candidate: RecommendationCandidate) {
  return normalizeWhitespace([
    candidate.schemeTitle,
    candidate.agencyName,
    candidate.shortDescription || '',
    candidate.fullDescription || '',
    candidate.description || '',
    candidate.disciplines.join(' '),
  ].filter(Boolean).join(' '));
}

function buildCandidateRerankDocument(candidate: RecommendationCandidate) {
  return normalizeWhitespace([
    candidate.schemeTitle ? `Scheme: ${candidate.schemeTitle}` : '',
    candidate.agencyName ? `Agency: ${candidate.agencyName}` : '',
    candidate.shortDescription || candidate.fullDescription || candidate.description
      ? `Description: ${candidate.shortDescription || candidate.fullDescription || candidate.description}`
      : '',
    candidate.disciplines.length ? `Disciplines: ${candidate.disciplines.join(', ')}` : '',
    candidate.fundingKinds.length ? `Funding types: ${candidate.fundingKinds.join(', ')}` : '',
    candidate.eligibilityText ? `Eligibility: ${candidate.eligibilityText}` : '',
  ].filter(Boolean).join('\n')).slice(0, 6000);
}

function buildQueryTopicTokens(normalized: NormalizedRecommendationSearchRequest) {
  const query = normalized.normalizedQuery;
  const topicSource = [
    query.researchArea || '',
    query.title || '',
    query.abstract || '',
    query.keywords.join(' '),
    query.researchTags.join(' '),
  ].filter(Boolean).join(' ');
  return tokenizeTopicText(topicSource, query.queryStrength === 'rich' ? 80 : 40);
}

function findCandidateTopicHits(candidate: RecommendationCandidate, normalized: NormalizedRecommendationSearchRequest) {
  const queryTokens = buildQueryTopicTokens(normalized);
  if (queryTokens.length === 0) {
    return [];
  }

  const candidateTokens = new Set(tokenizeTopicText(buildCandidateTopicText(candidate), 160));
  return queryTokens.filter((token) => candidateTokens.has(token));
}

function hasRequiredTopicRelevance(
  candidate: RecommendationCandidate,
  normalized: NormalizedRecommendationSearchRequest
) {
  const queryTokens = buildQueryTopicTokens(normalized);
  if (queryTokens.length === 0) {
    return true;
  }

  if (candidate.semanticSimilarity >= TOPIC_RELEVANCE_SEMANTIC_THRESHOLD) {
    return true;
  }

  const candidateTokens = new Set(tokenizeTopicText(buildCandidateTopicText(candidate), 160));
  const hitCount = queryTokens.filter((token) => candidateTokens.has(token)).length;
  const requiredHits =
    queryTokens.length >= 4 &&
    (normalized.inputMode === 'paper_metadata' || normalized.normalizedQuery.queryStrength === 'rich')
      ? 2
      : 1;
  return hitCount >= requiredHits;
}

function normalizeSet(values: Array<string | null | undefined>) {
  return new Set(values.map((value) => normalizeKey(normalizeWhitespace(value || ''))).filter(Boolean));
}

function findNormalizedHit(candidateValues: string[], profileValues: string[]) {
  if (candidateValues.length === 0 || profileValues.length === 0) {
    return null;
  }
  const profileSet = normalizeSet(profileValues);
  return candidateValues.find((value) => profileSet.has(normalizeKey(value))) || null;
}

function textContainsProfileTerm(candidate: RecommendationCandidate, profileTerms: string[]) {
  const terms = profileTerms.map((value) => normalizeKey(value)).filter((value) => value.length >= 3);
  if (terms.length === 0) {
    return null;
  }
  const haystack = normalizeKey(
    [
      candidate.schemeTitle,
      candidate.agencyName,
      candidate.shortDescription,
      candidate.fullDescription,
      candidate.description,
      candidate.eligibilityText,
      candidate.disciplines.join(' '),
    ].filter(Boolean).join(' ')
  );
  return terms.find((term) => haystack.includes(term)) || null;
}

function isGlobalOrInternational(candidate: RecommendationCandidate) {
  const values = [
    candidate.geographyScope,
    ...candidate.eligibleCountries,
    ...candidate.eligibleRegions,
    ...candidate.hostCountries,
  ].map((value) => normalizeKey(value || ''));
  return values.some((value) =>
    ['global', 'worldwide', 'international', 'any', 'all', 'all countries'].includes(value)
  );
}

function buildProfileResearchTerms(profile: RecommendationProfileSnapshot) {
  return Array.from(
    new Set(
      [
        ...(profile.researchAreas || []),
        ...(profile.keywords || []),
        ...(profile.savedResearchAreas || []).flatMap((area) => [
          area.label,
          area.researchArea,
          ...area.keywords,
          ...area.disciplines,
          area.taxonomyPath || '',
        ]),
      ]
        .map((value) => normalizeWhitespace(value || ''))
        .filter(Boolean)
    )
  );
}

const PUBLICATION_TERM_STOPWORDS = new Set([
  'with',
  'from',
  'using',
  'based',
  'study',
  'studies',
  'research',
  'analysis',
  'effect',
  'effects',
  'towards',
  'toward',
  'approach',
  'methods',
  'method',
  'model',
  'models',
]);

function buildTermsFromPublication(publication: RecommendationPublicationSnapshot) {
  const terms = new Set<string>();
  publication.tags.forEach((tag) => {
    const normalized = normalizeWhitespace(tag);
    if (normalized && normalized.toLowerCase() !== 'my-publication') {
      terms.add(normalized);
    }
  });

  const titleWords = normalizeWhitespace(publication.title)
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
    .filter((word) => word.length >= 5 && !PUBLICATION_TERM_STOPWORDS.has(word.toLowerCase()));
  titleWords.forEach((word) => terms.add(word));

  const abstractWords = normalizeWhitespace(publication.abstractSnippet || '')
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
    .filter((word) => word.length >= 7 && !PUBLICATION_TERM_STOPWORDS.has(word.toLowerCase()))
    .slice(0, 12);
  abstractWords.forEach((word) => terms.add(word));

  return Array.from(terms).slice(0, 18);
}

function buildPublicationResearchTerms(profile: RecommendationProfileSnapshot) {
  return Array.from(
    new Set(
      (profile.publications || [])
        .flatMap((publication) => buildTermsFromPublication(publication))
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean)
    )
  );
}

function findPublicationHit(candidate: RecommendationCandidate, publications: RecommendationPublicationSnapshot[]) {
  if (publications.length === 0) {
    return null;
  }

  const haystack = normalizeKey(
    [
      candidate.schemeTitle,
      candidate.agencyName,
      candidate.shortDescription,
      candidate.fullDescription,
      candidate.description,
      candidate.eligibilityText,
      candidate.disciplines.join(' '),
    ].filter(Boolean).join(' ')
  );

  for (const publication of publications) {
    const terms = buildTermsFromPublication(publication)
      .map((term) => normalizeKey(term))
      .filter((term) => term.length >= 4);
    const termHit = terms.find((term) => haystack.includes(term));
    if (termHit) {
      return { publication, term: termHit };
    }
  }

  return null;
}

function buildProfileMatch(
  candidate: RecommendationCandidate,
  profile: RecommendationProfileSnapshot | null | undefined
): RecommendationProfileMatch | null {
  if (!profile) {
    return null;
  }

  const reasons: string[] = [];
  const fieldsUsed = new Set<string>();
  let weightedScore = 0;
  let totalWeight = 0;

  function addSignal(field: string, weight: number, value: number, reason?: string) {
    totalWeight += weight;
    weightedScore += Math.max(0, Math.min(value, 1)) * weight;
    fieldsUsed.add(field);
    if (reason && reasons.length < 5) {
      reasons.push(reason);
    }
  }

  const researchTerms = buildProfileResearchTerms(profile);
  if (researchTerms.length > 0) {
    const disciplineHit = findNormalizedHit(candidate.disciplines, researchTerms);
    const textHit = disciplineHit ? null : textContainsProfileTerm(candidate, researchTerms);
    addSignal(
      'researchAreas',
      0.3,
      disciplineHit ? 1 : textHit ? 0.65 : 0,
      disciplineHit
        ? `Matches your research area: ${disciplineHit}`
        : textHit
          ? `Mentions your profile topic: ${textHit}`
          : undefined
    );
  }

  const publications = profile.publications || [];
  if (publications.length > 0) {
    const publicationHit = findPublicationHit(candidate, publications);
    addSignal(
      'publications',
      0.26,
      publicationHit ? 0.9 : 0,
      publicationHit
        ? `Matched your publication: ${publicationHit.publication.title}`
        : undefined
    );
  }

  if (profile.countryOfResidence) {
    const residenceHit = findNormalizedHit(candidate.eligibleCountries, [profile.countryOfResidence]);
    addSignal(
      'countryOfResidence',
      0.18,
      residenceHit ? 1 : isGlobalOrInternational(candidate) ? 0.7 : 0,
      residenceHit
        ? `Eligibility checked using residence: ${residenceHit}`
        : isGlobalOrInternational(candidate)
          ? 'Global or international opportunity'
          : undefined
    );
  }

  if (profile.citizenshipCountries.length > 0) {
    const citizenshipHit = findNormalizedHit(candidate.citizenshipRequirements, profile.citizenshipCountries);
    addSignal(
      'citizenshipCountries',
      0.12,
      candidate.citizenshipRequirements.length === 0 ? 0.25 : citizenshipHit ? 1 : 0,
      citizenshipHit ? `Eligibility checked using citizenship: ${citizenshipHit}` : undefined
    );
  }

  if (profile.institutionType) {
    const institutionHit = findNormalizedHit(candidate.institutionTypes, [profile.institutionType]);
    addSignal(
      'institutionType',
      0.14,
      institutionHit ? 1 : 0,
      institutionHit ? `Eligibility checked using institution type: ${institutionHit}` : undefined
    );
  }

  if (profile.careerStage) {
    const careerHit = findNormalizedHit(candidate.careerStages, [profile.careerStage]);
    addSignal(
      'careerStage',
      0.16,
      careerHit ? 1 : 0,
      careerHit ? `Eligibility checked using career stage: ${careerHit}` : undefined
    );
  }

  if (profile.applicationLanguages.length > 0) {
    const languageHit = findNormalizedHit(candidate.applicationLanguages, profile.applicationLanguages);
    addSignal(
      'applicationLanguages',
      0.1,
      candidate.applicationLanguages.length === 0 ? 0.2 : languageHit ? 1 : 0,
      languageHit ? `Eligibility checked using application language: ${languageHit}` : undefined
    );
  }

  if (totalWeight === 0) {
    return null;
  }

  return {
    score: Number((weightedScore / totalWeight).toFixed(4)),
    reasons,
    fieldsUsed: Array.from(fieldsUsed),
  };
}

function buildMatchReasons(candidate: RecommendationCandidate, normalized: NormalizedRecommendationSearchRequest) {
  const reasons: string[] = [];
  const disciplineHits = candidate.disciplines.filter((value) =>
    normalized.normalizedQuery.researchTags.map((item) => normalizeKey(item)).includes(normalizeKey(value))
  );

  if (disciplineHits.length > 0) {
    reasons.push(`Matched discipline: ${disciplineHits.slice(0, 2).join(', ')}`);
  } else if (candidate.semanticSimilarity >= TOPIC_RELEVANCE_SEMANTIC_THRESHOLD) {
    reasons.push('High semantic match to the query text');
  } else {
    const topicHits = findCandidateTopicHits(candidate, normalized);
    if (topicHits.length > 0) {
      reasons.push(`Topic text match: ${topicHits.slice(0, 3).join(', ')}`);
    }
  }

  if (candidate.fundingKinds.length > 0 && normalized.filters.fundingKinds.length > 0) {
    const hit = candidate.fundingKinds.find((value) =>
      normalized.filters.fundingKinds.map((item) => normalizeKey(item)).includes(normalizeKey(value))
    );
    if (hit) {
      reasons.push(`Funding type overlap: ${hit}`);
    }
  }

  if (candidate.eligibleCountries.length > 0 && normalized.filters.eligibleCountries.length > 0) {
    const hit = candidate.eligibleCountries.find((value) =>
      buildCountryMatchKeys(normalized.filters.eligibleCountries).includes(normalizeKey(value))
    );
    if (hit) {
      reasons.push(`Eligible country match: ${hit}`);
    }
  }

  if (candidate.hostCountries.length > 0 && normalized.filters.hostCountries.length > 0) {
    const hit = candidate.hostCountries.find((value) =>
      buildCountryMatchKeys(normalized.filters.hostCountries).includes(normalizeKey(value))
    );
    if (hit) {
      reasons.push(`Host country match: ${hit}`);
    }
  }

  if (candidate.institutionTypes.length > 0 && normalized.filters.institutionTypes.length > 0) {
    const hit = candidate.institutionTypes.find((value) =>
      normalized.filters.institutionTypes.map((item) => normalizeKey(item)).includes(normalizeKey(value))
    );
    if (hit) {
      reasons.push(`Institution fit: ${hit}`);
    }
  }

  if (candidate.careerStages.length > 0 && normalized.filters.careerStages.length > 0) {
    const hit = candidate.careerStages.find((value) =>
      normalized.filters.careerStages.map((item) => normalizeKey(item)).includes(normalizeKey(value))
    );
    if (hit) {
      reasons.push(`Career stage fit: ${hit}`);
    }
  }

  if (candidate.isRolling) {
    reasons.push('Rolling opportunity');
  } else if (candidate.closeDate) {
    reasons.push(`Deadline: ${new Date(candidate.closeDate).toLocaleDateString()}`);
  }

  return reasons.slice(0, 4);
}

function buildEligibilitySummary(candidate: RecommendationCandidate) {
  const summaryParts = [
    candidate.eligibleCountries.length > 0 ? `Eligible countries: ${candidate.eligibleCountries.slice(0, 3).join(', ')}` : '',
    candidate.eligibleRegions.length > 0 ? `Regions: ${candidate.eligibleRegions.slice(0, 3).join(', ')}` : '',
    candidate.institutionTypes.length > 0 ? `Institution types: ${candidate.institutionTypes.slice(0, 3).join(', ')}` : '',
    candidate.careerStages.length > 0 ? `Career stages: ${candidate.careerStages.slice(0, 3).join(', ')}` : '',
  ].filter(Boolean);

  return summaryParts.join(' | ') || 'See opportunity details for eligibility requirements.';
}

function toPublicResult(
  candidate: RecommendationCandidate,
  score: number,
  normalized: NormalizedRecommendationSearchRequest,
  profileMatch: RecommendationProfileMatch | null = null,
  applicant: ApplicantGeography | null = null
): RecommendationSearchResultItem & InternalRecommendationSearchResponse['rawResults'][number] {
  return {
    id: candidate.id,
    agencyName: candidate.agencyName,
    schemeTitle: candidate.schemeTitle,
    shortDescription: candidate.shortDescription,
    closeDate: candidate.closeDate,
    isRolling: candidate.isRolling,
    fundingKinds: candidate.fundingKinds,
    disciplines: candidate.disciplines,
    eligibleCountries: candidate.eligibleCountries,
    eligibleRegions: candidate.eligibleRegions,
    hostCountries: candidate.hostCountries,
    institutionTypes: candidate.institutionTypes,
    careerStages: candidate.careerStages,
    sponsorType: candidate.sponsorType,
    officialUrls: sanitizeExternalUrls(candidate.officialUrls),
    score: Number(score.toFixed(4)),
    matchReasons: buildMatchReasons(candidate, normalized),
    profileMatch,
    eligibilitySummary: buildEligibilitySummary(candidate),
    fullDescription: candidate.fullDescription,
    description: candidate.description,
    amountMin: candidate.amountMin,
    amountMax: candidate.amountMax,
    currency: candidate.currency,
    eligibilityText: candidate.eligibilityText,
    contactInfo: candidate.contactInfo,
    geographyScope: candidate.geographyScope,
    funderCountry: candidate.funderCountry,
    citizenshipRequirements: candidate.citizenshipRequirements,
    residencyRequirements: candidate.residencyRequirements,
    applicationLanguages: candidate.applicationLanguages,
    taxonomyAreaIds: candidate.taxonomyAreaIds || [],
    isCatalog: Boolean(candidate.isCatalog),
    limitedSubmissions: Boolean(candidate.limitedSubmissions),
    authoringReady: candidate.authoringReady !== false,
    eligibilityVerdict: eligibilityVerdictFor(candidate, applicant),
    semanticSimilarity: candidate.semanticSimilarity,
    textRank: candidate.textRank,
  };
}

function buildRelaxationSuggestions(normalized: NormalizedRecommendationSearchRequest, reason: RecommendationSearchResponse['noResultsReason']) {
  if (reason === 'query_too_weak') {
    return [
      'Add a longer abstract or more specific keywords.',
      'Use a broader research-area description with 2-4 meaningful terms.',
    ];
  }

  const suggestions: string[] = [];
  const { filters } = normalized;
  if (filters.eligibleCountries.length > 0 || filters.hostCountries.length > 0) {
    suggestions.push('Try removing country filters or replacing them with broader region filters.');
  }
  if (filters.fundingKinds.length > 0 || filters.institutionTypes.length > 0 || filters.careerStages.length > 0) {
    suggestions.push('Broaden funding type, institution type, or career stage filters.');
  }
  if (filters.deadlineFrom || filters.deadlineTo || filters.rollingOnly) {
    suggestions.push('Widen the deadline range or include non-rolling opportunities.');
  }
  if (suggestions.length === 0) {
    suggestions.push('Try a broader research description or remove some optional filters.');
  }
  return suggestions.slice(0, 3);
}

function hasActiveUserFilters(filters: Required<RecommendationSearchFilters>) {
  return Object.entries(filters).some(([key, value]) => {
    if (key === 'includeExpired' || key === 'limit' || key === 'sort') {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== null && value !== undefined && value !== false && value !== '';
  });
}

function isFilterValueActive(
  value: Required<RecommendationSearchFilters>[keyof RecommendationSearchFilters]
) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined && value !== false && value !== '';
}

function cloneFilters(filters: Required<RecommendationSearchFilters>): Required<RecommendationSearchFilters> {
  return {
    ...filters,
    geographyScope: [...filters.geographyScope],
    eligibleCountries: [...filters.eligibleCountries],
    eligibleRegions: [...filters.eligibleRegions],
    hostCountries: [...filters.hostCountries],
    funderCountries: [...filters.funderCountries],
    fundingKinds: [...filters.fundingKinds],
    institutionTypes: [...filters.institutionTypes],
    careerStages: [...filters.careerStages],
    citizenshipRequirements: [...filters.citizenshipRequirements],
    residencyRequirements: [...filters.residencyRequirements],
    applicationLanguages: [...filters.applicationLanguages],
    sponsorTypes: [...filters.sponsorTypes],
    taxonomyAreaIds: [...filters.taxonomyAreaIds],
    funderIds: [...filters.funderIds],
    sdgGoals: [...filters.sdgGoals],
    programmeFrameworks: [...filters.programmeFrameworks],
    qualifications: [...filters.qualifications],
    projectDurations: [...filters.projectDurations],
    targetGroups: [...filters.targetGroups],
    indirectCostPolicies: [...filters.indirectCostPolicies],
    mobility: [...filters.mobility],
    applicationRoutes: [...filters.applicationRoutes],
  };
}

function clearFilterKey(
  filters: Required<RecommendationSearchFilters>,
  key: keyof RecommendationSearchFilters
) {
  switch (key) {
    case 'geographyScope':
    case 'eligibleCountries':
    case 'eligibleRegions':
    case 'hostCountries':
    case 'funderCountries':
    case 'fundingKinds':
    case 'institutionTypes':
    case 'careerStages':
    case 'citizenshipRequirements':
    case 'residencyRequirements':
    case 'applicationLanguages':
    case 'sponsorTypes':
    case 'taxonomyAreaIds':
    case 'funderIds':
    case 'sdgGoals':
    case 'programmeFrameworks':
    case 'qualifications':
    case 'projectDurations':
    case 'targetGroups':
    case 'indirectCostPolicies':
    case 'mobility':
    case 'applicationRoutes':
      filters[key] = [] as never;
      break;
    case 'noMembershipNeeded':
      filters[key] = false as never;
      break;
    case 'amountCurrency':
      filters[key] = '' as never;
      break;
    case 'includeUnknownAmount':
      filters[key] = false as never;
      break;
    case 'deadlineFrom':
    case 'deadlineTo':
      filters[key] = '' as never;
      break;
    case 'rollingOnly':
      filters[key] = false as never;
      break;
    case 'amountMin':
    case 'amountMax':
      filters[key] = null as never;
      break;
  }
}

function scoreCandidate(
  candidate: RecommendationCandidate,
  normalized: NormalizedRecommendationSearchRequest,
  profileMatch: RecommendationProfileMatch | null = null
) {
  const textRank = normalizeTextRank(candidate.textRank);
  const researchTags = normalized.normalizedQuery.researchTags;
  const filters = normalized.filters;

  const disciplineOverlap = overlapSignal(candidate.disciplines, researchTags);
  const fundingKindOverlap = overlapSignal(candidate.fundingKinds, filters.fundingKinds);

  const geographySignals = [
    scalarSignal(candidate.geographyScope, filters.geographyScope),
    overlapSignal(candidate.eligibleCountries, filters.eligibleCountries),
    overlapSignal(candidate.eligibleRegions, filters.eligibleRegions),
    overlapSignal(candidate.hostCountries, filters.hostCountries),
    scalarSignal(candidate.funderCountry, filters.funderCountries),
  ];
  const geographyFit = geographySignals.filter((value) => value > 0).length > 0
    ? geographySignals.reduce((sum, value) => sum + value, 0) / geographySignals.length
    : 0;

  const institutionFit = overlapSignal(candidate.institutionTypes, filters.institutionTypes);
  const careerFit = overlapSignal(candidate.careerStages, filters.careerStages);
  const eligibilityFit = [
    overlapSignal(candidate.citizenshipRequirements, filters.citizenshipRequirements),
    overlapSignal(candidate.residencyRequirements, filters.residencyRequirements),
    overlapSignal(candidate.applicationLanguages, filters.applicationLanguages),
  ].reduce((sum, value) => sum + value, 0) / 3;

  const deadlineFreshness = computeDeadlineFreshness(candidate.closeDate, candidate.isRolling);
  const hasSemanticSignal = candidate.semanticSimilarity >= 0.08;

  const baseScore = !hasSemanticSignal
    ? (
      textRank * 0.5 +
      disciplineOverlap * 0.22 +
      fundingKindOverlap * 0.08 +
      geographyFit * 0.06 +
      institutionFit * 0.04 +
      careerFit * 0.03 +
      eligibilityFit * 0.02 +
      deadlineFreshness * 0.05
    )
    : (
      candidate.semanticSimilarity * 0.35 +
      textRank * 0.2 +
      disciplineOverlap * 0.15 +
      fundingKindOverlap * 0.1 +
      geographyFit * 0.08 +
      institutionFit * 0.04 +
      careerFit * 0.03 +
      eligibilityFit * 0.03 +
      deadlineFreshness * 0.02
    );

  if (!profileMatch) {
    return baseScore;
  }

  return Math.min(1, baseScore * 0.86 + profileMatch.score * 0.14);
}

/**
 * The user's profile countries, when the search uses the profile and the
 * profile states any. Calls are only judged against a profile the user chose
 * to apply.
 */
function applicantFromProfile(profile: RecommendationProfileSnapshot | null): ApplicantGeography | null {
  if (!profile) return null;
  const applicant = applicantGeographyFromProfile(profile);
  return applicant.residence?.length || applicant.citizenship?.length ? applicant : null;
}

function eligibilityVerdictFor(
  candidate: RecommendationCandidate,
  applicant: ApplicantGeography | null
): RecommendationSearchResultItem['eligibilityVerdict'] {
  if (!applicant || !candidate.eligibilityDimensions) return null;
  const verdict = eligibilityVerdictForRow(candidate.eligibilityDimensions, applicant);
  return verdict === 'NOT_EVALUATED' ? null : verdict;
}

const ELIGIBILITY_ORDER = { ELIGIBLE: 0, NEEDS_CHECK: 1, INELIGIBLE: 2 } as const;

/**
 * FINDER_RANK_CURATED_FIRST=1: among calls scoring within the same hundredth,
 * curated calls come before imported catalogue calls, and calls the user's
 * profile is eligible for before those to check or excluded. Off by default:
 * a tie-break only, never a reason to bury a clearly better match.
 */
function curatedFirstTieBreak<T extends { candidate: RecommendationCandidate; score: number }>(
  left: T,
  right: T,
  applicant: ApplicantGeography | null
): number {
  const band = Math.round(right.score * 100) - Math.round(left.score * 100);
  if (band !== 0) return band;
  const catalog = Number(Boolean(left.candidate.isCatalog)) - Number(Boolean(right.candidate.isCatalog));
  if (catalog !== 0) return catalog;
  const rank = (item: T) => {
    const verdict = eligibilityVerdictFor(item.candidate, applicant);
    return verdict ? ELIGIBILITY_ORDER[verdict] : ELIGIBILITY_ORDER.NEEDS_CHECK;
  };
  return rank(left) - rank(right);
}

/**
 * Calls the viewer's own profile is explicitly ruled out of go last.
 *
 * Only a stated exclusion counts (the call names its countries and none of
 * them is the viewer's) and only when the search applies the profile, which
 * the viewer turns on. On the dev catalogue an India-based profile searching
 * "cancer research" got 17 "Not eligible" calls in its top 25: without this
 * the imported catalogue pushes calls nobody at the institution can apply for
 * onto the first page. NEEDS_CHECK is never demoted — missing information is
 * not a disqualification. FINDER_DEMOTE_INELIGIBLE=0 turns it off.
 */
function ineligibleDemotion<T extends { candidate: RecommendationCandidate }>(
  item: T,
  applicant: ApplicantGeography | null
): number {
  if (!applicant || process.env.FINDER_DEMOTE_INELIGIBLE === '0') return 0;
  return eligibilityVerdictFor(item.candidate, applicant) === 'INELIGIBLE' ? 1 : 0;
}

export function sortCandidates<T extends { candidate: RecommendationCandidate; score: number }>(
  candidates: T[],
  normalized: NormalizedRecommendationSearchRequest,
  applicant: ApplicantGeography | null = null
): T[] {
  const demote = (left: T, right: T) => ineligibleDemotion(left, applicant) - ineligibleDemotion(right, applicant);
  if (normalized.filters.sort === 'deadline_soonest') {
    const allRolling = candidates.every((item) => item.candidate.isRolling || !item.candidate.closeDate);
    return candidates.sort((left, right) => {
      const leftDate = parseDateValue(left.candidate.closeDate);
      const rightDate = parseDateValue(right.candidate.closeDate);

      const demoted = demote(left, right);
      if (demoted !== 0) {
        return demoted;
      }

      if (!allRolling) {
        if (leftDate && rightDate) {
          const delta = leftDate.getTime() - rightDate.getTime();
          if (delta !== 0) {
            return delta;
          }
        }
        if (leftDate && !rightDate) {
          return -1;
        }
        if (!leftDate && rightDate) {
          return 1;
        }
      }

      return right.score - left.score || left.candidate.schemeTitle.localeCompare(right.candidate.schemeTitle);
    });
  }

  if (process.env.FINDER_RANK_CURATED_FIRST === '1') {
    return candidates.sort(
      (left, right) =>
        demote(left, right) ||
        curatedFirstTieBreak(left, right, applicant) ||
        right.score - left.score ||
        left.candidate.schemeTitle.localeCompare(right.candidate.schemeTitle)
    );
  }
  return candidates.sort(
    (left, right) =>
      demote(left, right) ||
      right.score - left.score ||
      left.candidate.schemeTitle.localeCompare(right.candidate.schemeTitle)
  );
}

function buildResearchAreaEnrichmentCacheInput(
  normalized: NormalizedRecommendationSearchRequest
): ResearchAreaEnrichmentCacheInput {
  const rawQuery = normalizeWhitespace(
    normalized.normalizedQuery.canonicalQueryText || normalized.normalizedQuery.researchArea || ''
  );
  const normalizedQuery = normalizeWhitespace(normalized.normalizedQuery.researchArea || rawQuery);
  const researchTags = Array.from(
    new Set(
      normalized.normalizedQuery.researchTags
        .map((value) => normalizeKey(normalizeWhitespace(value)))
        .filter(Boolean)
    )
  ).sort();

  return {
    requestHash: createRequestHash({
      inputMode: normalized.inputMode,
      normalizedQuery,
      researchTags,
    }),
    rawQuery,
    normalizedQuery,
  };
}

function getQueryEmbeddingIdentity() {
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE });
  return {
    provider: health.provider,
    modelName: health.modelName,
    outputDimensionality: health.outputDimensionality,
    taskType: QUERY_EMBEDDING_TASK_TYPE,
    version: `${QUERY_EMBEDDING_CACHE_VERSION_PREFIX}:${health.provider}:${health.modelName}:${QUERY_EMBEDDING_TASK_TYPE.toLowerCase()}:${health.outputDimensionality}`,
  };
}

function getQueryEmbeddingCacheColumn(cacheInput: ReturnType<typeof buildQueryEmbeddingCacheInput>) {
  return cacheInput.provider === 'voyage' && cacheInput.outputDimensionality === 1024
    ? 'embedding_voyage_1024'
    : 'embedding';
}

function getFundingCallSearchEmbeddingColumn(identity = getQueryEmbeddingIdentity()) {
  return identity.provider === 'voyage' && identity.outputDimensionality === 1024
    ? 'embedding_voyage_1024'
    : 'embedding';
}

function queryEmbeddingCacheColumnSql(cacheInput: ReturnType<typeof buildQueryEmbeddingCacheInput>) {
  return Prisma.raw(getQueryEmbeddingCacheColumn(cacheInput));
}

function fundingCallSearchEmbeddingColumnSql() {
  return Prisma.raw(getFundingCallSearchEmbeddingColumn());
}

function buildQueryEmbeddingCacheInput(normalized: NormalizedRecommendationSearchRequest) {
  const identity = getQueryEmbeddingIdentity();
  const semanticDocument = normalizeWhitespace(normalized.normalizedQuery.semanticDocument || '');
  return {
    ...identity,
    inputMode: normalized.inputMode,
    semanticDocument,
    requestHash: createRequestHash({
      inputMode: normalized.inputMode,
      semanticDocument,
      model: identity.modelName,
      taskType: identity.taskType,
      outputDimensionality: identity.outputDimensionality,
      version: identity.version,
    }),
  };
}

function vectorLiteralFromEmbedding(embedding: number[]) {
  if (!embedding.length) {
    return null;
  }
  return `[${embedding.join(',')}]`;
}

/** The typed-topic branch of a fan-out, when the message carries a topic of its own. */
const MESSAGE_BRANCH_ID = '__message__';
/** Score bonus when a call carries the same two-level taxonomy tag as the searched area. */
const TAXONOMY_TAG_BONUS = 0.06;

type SearchAreaBranch = {
  areaId: string;
  label: string;
  queryText: string;
  taxonomyAreaId: string | null;
  taxonomyPath: string | null;
  request: RecommendationSearchRequest;
};

function normalizeSelectedResearchAreas(
  selected: RecommendationSelectedResearchArea[] | undefined
): RecommendationSelectedResearchArea[] {
  if (!Array.isArray(selected)) {
    return [];
  }

  const seen = new Set<string>();
  const cleaned: RecommendationSelectedResearchArea[] = [];

  selected.forEach((area) => {
    const queryText = normalizeWhitespace(String(area?.queryText || ''));
    const id = normalizeWhitespace(String(area?.id || ''));
    if (!queryText || !id) {
      return;
    }
    const key = normalizeKey(queryText);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    cleaned.push({
      id,
      label: normalizeWhitespace(String(area?.label || '')) || queryText,
      queryText,
      taxonomyAreaId: normalizeWhitespace(String(area?.taxonomyAreaId || '')) || null,
      taxonomyPath: normalizeWhitespace(String(area?.taxonomyPath || '')) || null,
    });
  });

  return cleaned.slice(0, MAX_SELECTED_RESEARCH_AREAS);
}

/**
 * Turns one request into the independent topic branches it should be searched as.
 * Returns fewer than two branches when there is nothing to fan out over, in which case
 * the caller keeps the ordinary single-query path.
 *
 * The message's own topic stays a branch of its own rather than being folded into the
 * selection, so picking saved areas never silently swallows what the user just typed.
 */
function buildSearchAreaBranches(request: RecommendationSearchRequest): SearchAreaBranch[] {
  const selected = normalizeSelectedResearchAreas(request.selectedResearchAreas);
  if (selected.length === 0) {
    return [];
  }

  const selectedKeys = new Set(selected.map((area) => normalizeKey(area.queryText)));
  const branches: SearchAreaBranch[] = [];

  const messageTopic =
    request.inputMode === 'research_area'
      ? normalizeWhitespace((request.query as { researchArea?: string })?.researchArea || '')
      : normalizeWhitespace((request.query as { title?: string })?.title || '');

  // A paper-metadata query is already a rich, self-contained topic; keep it as its own
  // branch rather than flattening it into the research-area branches.
  const messageIsDistinct =
    Boolean(messageTopic) &&
    (request.inputMode === 'paper_metadata' || !selectedKeys.has(normalizeKey(messageTopic)));

  if (messageIsDistinct) {
    branches.push({
      areaId: MESSAGE_BRANCH_ID,
      label: request.inputMode === 'paper_metadata' ? 'Attached paper' : 'Your message',
      queryText: messageTopic,
      taxonomyAreaId: null,
      taxonomyPath: null,
      request: { ...request, selectedResearchAreas: undefined },
    });
  }

  selected.forEach((area) => {
    branches.push({
      areaId: area.id,
      label: area.label,
      queryText: area.queryText,
      taxonomyAreaId: area.taxonomyAreaId || null,
      taxonomyPath: area.taxonomyPath || null,
      request: {
        ...request,
        inputMode: 'research_area',
        query: { researchArea: area.queryText },
        selectedResearchAreas: undefined,
      },
    });
  });

  return branches.length >= 2 ? branches : [];
}

type MergedAreaResult = {
  result: RecommendationRawResultItem;
  matchedAreas: RecommendationAreaMatch[];
  bestBranchIndex: number;
  bestBranchRank: number;
  combinedScore: number;
};

/**
 * Merges per-area result lists into one ranked list.
 *
 * Score is the best score the call earned on any single area — never an average — plus a
 * deliberate bonus per additional area it matched, so cross-cutting calls rise without
 * specialists being punished for matching only the area they belong to.
 */
function mergeAreaSearchResults(
  branches: SearchAreaBranch[],
  responses: InternalRecommendationSearchResponse[],
  limit: number
): MergedAreaResult[] {
  const merged = new Map<string, MergedAreaResult>();

  responses.forEach((response, branchIndex) => {
    const branch = branches[branchIndex];
    if (!branch) {
      return;
    }

    response.rawResults.forEach((result, rank) => {
      const taxonomyHit = Boolean(
        branch.taxonomyAreaId && (result.taxonomyAreaIds || []).includes(branch.taxonomyAreaId)
      );
      const areaScore = Math.min(1, result.score + (taxonomyHit ? TAXONOMY_TAG_BONUS : 0));
      const match: RecommendationAreaMatch = {
        areaId: branch.areaId,
        label: branch.label,
        score: Number(areaScore.toFixed(4)),
      };

      const existing = merged.get(result.id);
      if (!existing) {
        merged.set(result.id, {
          result: taxonomyHit && branch.taxonomyPath
            ? { ...result, matchReasons: [...result.matchReasons, `Tagged ${branch.taxonomyPath}`] }
            : result,
          matchedAreas: [match],
          bestBranchIndex: branchIndex,
          bestBranchRank: rank,
          combinedScore: areaScore,
        });
        return;
      }

      existing.matchedAreas.push(match);
      if (areaScore > existing.combinedScore) {
        existing.combinedScore = areaScore;
        existing.bestBranchIndex = branchIndex;
        existing.bestBranchRank = rank;
      }
    });
  });

  const entries = Array.from(merged.values()).map((entry) => {
    const matchedAreas = [...entry.matchedAreas].sort((left, right) => right.score - left.score);
    return {
      ...entry,
      matchedAreas,
      combinedScore: Math.min(1, entry.combinedScore + MULTI_AREA_MATCH_BONUS * (matchedAreas.length - 1)),
    };
  });

  if (entries.length <= limit) {
    return entries.sort((left, right) => right.combinedScore - left.combinedScore);
  }

  // Membership first: guarantee every area a few slots so a strong area cannot starve the
  // others out of the list entirely. Ordering afterwards is still purely by score.
  const byBranch = new Map<number, MergedAreaResult[]>();
  entries.forEach((entry) => {
    const bucket = byBranch.get(entry.bestBranchIndex) || [];
    bucket.push(entry);
    byBranch.set(entry.bestBranchIndex, bucket);
  });
  byBranch.forEach((bucket) => bucket.sort((left, right) => left.bestBranchRank - right.bestBranchRank));

  const selectedIds = new Set<string>();
  const selectedEntries: MergedAreaResult[] = [];
  const takeEntry = (entry: MergedAreaResult) => {
    if (selectedIds.has(entry.result.id) || selectedEntries.length >= limit) {
      return;
    }
    selectedIds.add(entry.result.id);
    selectedEntries.push(entry);
  };

  for (let round = 0; round < MULTI_AREA_MIN_SLOTS_PER_AREA; round += 1) {
    branches.forEach((_branch, branchIndex) => {
      const bucket = byBranch.get(branchIndex) || [];
      const next = bucket.find((entry) => !selectedIds.has(entry.result.id));
      if (next) {
        takeEntry(next);
      }
    });
  }

  entries
    .slice()
    .sort((left, right) => right.combinedScore - left.combinedScore)
    .forEach(takeEntry);

  return selectedEntries.sort((left, right) => right.combinedScore - left.combinedScore);
}

export class RecommendationSearchService {
  private applyProfileContextToQuery(
    normalized: NormalizedRecommendationSearchRequest,
    profileContext: RecommendationProfileSnapshot | null
  ): NormalizedRecommendationSearchRequest {
    if (!profileContext) {
      return normalized;
    }

    const normalizedQueryText = normalizeKey(normalized.normalizedQuery.canonicalQueryText);
    const publicationIntent =
      normalizedQueryText.includes('publication') ||
      normalizedQueryText.includes('publications') ||
      normalizedQueryText.includes('paper') ||
      normalizedQueryText.includes('papers');
    const shouldExpand =
      normalized.normalizedQuery.queryStrength === 'weak' ||
      (publicationIntent && (profileContext.publications || []).length > 0);
    if (!shouldExpand) {
      return normalized;
    }

    const profileTerms = buildProfileResearchTerms(profileContext).slice(0, 12);
    const publicationTerms = buildPublicationResearchTerms(profileContext).slice(0, 16);
    const allTerms = Array.from(new Set([...profileTerms, ...publicationTerms]));
    if (allTerms.length === 0) {
      return normalized;
    }

    const fullTextTerms = Array.from(
      new Set([
        normalized.normalizedQuery.fullTextQuery,
        ...allTerms.map((term) => (term.includes(' ') ? `"${term}"` : term)),
      ].filter(Boolean))
    ).join(' OR ');

    const contextLines = [
      profileTerms.length > 0 ? `Profile research context: ${profileTerms.join(', ')}` : '',
      publicationTerms.length > 0 ? `Publication context: ${publicationTerms.join(', ')}` : '',
    ].filter(Boolean);

    return {
      ...normalized,
      normalizedQuery: {
        ...normalized.normalizedQuery,
        semanticDocument: [
          normalized.normalizedQuery.semanticDocument,
          ...contextLines,
        ].filter(Boolean).join('\n'),
        fullTextQuery: fullTextTerms,
        researchTags: Array.from(new Set([...normalized.normalizedQuery.researchTags, ...allTerms])),
        queryStrength: 'normal',
      },
    };
  }

  private rankExecution(
    normalized: NormalizedRecommendationSearchRequest,
    execution: SearchExecutionResult,
    profileContext: RecommendationProfileSnapshot | null = null
  ): RankedExecution {
    const hasSemanticCandidates = execution.candidates.some((candidate) => candidate.semanticSimilarity >= 0.08);
    const scoreThreshold = hasSemanticCandidates ? NO_RESULT_SCORE_THRESHOLD : 0.08;
    const lowConfidenceThreshold = hasSemanticCandidates ? LOW_CONFIDENCE_THRESHOLD : 0.2;
    const scored = sortCandidates(
      execution.candidates.map((candidate) => {
        const profileMatch = buildProfileMatch(candidate, profileContext);
        return {
          candidate,
          profileMatch,
          score: scoreCandidate(candidate, normalized, profileMatch),
        };
      }),
      normalized,
      applicantFromProfile(profileContext)
    );

    const displayableScored = scored.filter((item) => hasRequiredTopicRelevance(item.candidate, normalized));
    const topScore = displayableScored[0]?.score || 0;
    const lowConfidence = topScore >= scoreThreshold && topScore < lowConfidenceThreshold;
    const filteredScored = displayableScored
      .filter((item) => item.score >= scoreThreshold)
      .slice(0, normalized.filters.limit);

    return {
      filteredScored,
      topScore,
      lowConfidence,
    };
  }

  private async buildStrictFilterRecovery(
    normalized: NormalizedRecommendationSearchRequest,
    access?: RecommendationAccessScope,
    profileContext: RecommendationProfileSnapshot | null = null,
    options: { llmContext?: RecommendationSearchRequest['llmContext']; queryVectorLiteral?: string | null } = {}
  ): Promise<RecommendationStrictFilterRecovery | null> {
    if (!hasActiveUserFilters(normalized.filters)) {
      return null;
    }

    let retryFilters = cloneFilters(normalized.filters);
    const relaxedFilterKeys: Array<keyof RecommendationSearchFilters> = [];

    for (const tier of STRICT_FILTER_RECOVERY_LADDER) {
      const activeTierKeys = tier.filter((key) => isFilterValueActive(retryFilters[key]));
      if (activeTierKeys.length === 0) {
        continue;
      }

      activeTierKeys.forEach((key) => {
        clearFilterKey(retryFilters, key);
        if (!relaxedFilterKeys.includes(key)) {
          relaxedFilterKeys.push(key);
        }
      });

      const relaxedNormalized = {
        ...normalized,
        filters: cloneFilters(retryFilters),
      };
      const relaxedExecution = await this.executeSearch(
        relaxedNormalized,
        false,
        access,
        options.llmContext,
        { queryVectorLiteral: options.queryVectorLiteral }
      );
      const relaxedRanking = this.rankExecution(relaxedNormalized, relaxedExecution, profileContext);
      if (relaxedRanking.filteredScored.length > 0) {
        return {
          retryFilters: cloneFilters(relaxedNormalized.filters),
          relaxedFilterKeys,
        };
      }
    }

    return null;
  }

  private applyResearchAreaEnrichment(
    normalized: NormalizedRecommendationSearchRequest,
    rewrittenResearchArea: string,
    relatedTerms: string[]
  ): NormalizedRecommendationSearchRequest | null {
    const cleanedResearchArea =
      normalizeWhitespace(rewrittenResearchArea || '') || normalized.normalizedQuery.researchArea;
    const cleanedRelatedTerms = Array.from(
      new Set(
        relatedTerms
          .map((value) => normalizeWhitespace(String(value || '')))
          .filter(Boolean)
          .slice(0, 8)
      )
    );

    if (!cleanedResearchArea && cleanedRelatedTerms.length === 0) {
      return null;
    }

    const researchTags = Array.from(
      new Set([
        ...normalized.normalizedQuery.researchTags,
        cleanedResearchArea,
        ...cleanedRelatedTerms,
      ].filter(Boolean))
    );

    const fullTextQuery = Array.from(
      new Set(
        [cleanedResearchArea, ...normalized.normalizedQuery.researchTags, ...cleanedRelatedTerms]
          .filter((value): value is string => Boolean(value))
          .map((value) => normalizeWhitespace(value))
          .filter((value): value is string => Boolean(value))
      )
    )
      .map((value) => (value.includes(' ') ? `"${value}"` : value))
      .join(' OR ');

    const semanticDocument = [
      normalized.normalizedQuery.semanticDocument,
      cleanedResearchArea ? `Expanded topic: ${cleanedResearchArea}` : '',
      cleanedRelatedTerms.length > 0 ? `Expanded terms: ${cleanedRelatedTerms.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      ...normalized,
      normalizedQuery: {
        ...normalized.normalizedQuery,
        researchArea: cleanedResearchArea || '',
        canonicalQueryText: cleanedResearchArea || '',
        semanticDocument,
        fullTextQuery,
        researchTags: researchTags.filter((value): value is string => Boolean(value)),
        queryStrength: normalized.normalizedQuery.queryStrength === 'weak' ? 'normal' : normalized.normalizedQuery.queryStrength,
      },
    };
  }

  private async loadCachedResearchAreaEnrichment(
    normalized: NormalizedRecommendationSearchRequest
  ): Promise<NormalizedRecommendationSearchRequest | null> {
    const cacheInput = buildResearchAreaEnrichmentCacheInput(normalized);
    if (!cacheInput.normalizedQuery) {
      return null;
    }

    const cached = await prisma.recommendationQueryEnrichmentCache.findFirst({
      where: {
        request_hash: cacheInput.requestHash,
        model: RESEARCH_AREA_ENRICHMENT_MODEL,
        enrichment_version: QUERY_ENRICHMENT_CACHE_VERSION,
      },
    });

    if (!cached) {
      return null;
    }

    await prisma.recommendationQueryEnrichmentCache.update({
      where: { id: cached.id },
      data: {
        hit_count: { increment: 1 },
        last_used_at: new Date(),
      },
    });

    return this.applyResearchAreaEnrichment(
      normalized,
      cached.rewritten_research_area || '',
      cached.related_terms || []
    );
  }

  private async saveResearchAreaEnrichmentCache(
    normalized: NormalizedRecommendationSearchRequest,
    rewrittenResearchArea: string,
    relatedTerms: string[],
    responseJson: Prisma.JsonValue
  ) {
    const cacheInput = buildResearchAreaEnrichmentCacheInput(normalized);
    if (!cacheInput.normalizedQuery) {
      return;
    }

    const existing = await prisma.recommendationQueryEnrichmentCache.findFirst({
      where: {
        request_hash: cacheInput.requestHash,
        model: RESEARCH_AREA_ENRICHMENT_MODEL,
        enrichment_version: QUERY_ENRICHMENT_CACHE_VERSION,
      },
      select: { id: true },
    });

    const sharedData = {
      raw_query: cacheInput.rawQuery || cacheInput.normalizedQuery,
      normalized_query: cacheInput.normalizedQuery,
      rewritten_research_area: normalizeWhitespace(rewrittenResearchArea || '') || cacheInput.normalizedQuery,
      related_terms: Array.from(
        new Set(
          relatedTerms
            .map((value) => normalizeWhitespace(String(value || '')))
            .filter(Boolean)
            .slice(0, 8)
        )
      ),
      response_json: (responseJson ?? Prisma.JsonNull) as any,
      last_used_at: new Date(),
    };

    if (existing) {
      await prisma.recommendationQueryEnrichmentCache.update({
        where: { id: existing.id },
        data: {
          ...sharedData,
          hit_count: { increment: 1 },
        },
      });
      return;
    }

    await prisma.recommendationQueryEnrichmentCache.create({
      data: {
        request_hash: cacheInput.requestHash,
        input_mode: normalized.inputMode,
        model: RESEARCH_AREA_ENRICHMENT_MODEL,
        enrichment_version: QUERY_ENRICHMENT_CACHE_VERSION,
        hit_count: 1,
        ...sharedData,
      },
    });
  }

  private async enrichResearchAreaRequest(
    normalized: NormalizedRecommendationSearchRequest,
    llmContext?: RecommendationSearchRequest['llmContext']
  ): Promise<NormalizedRecommendationSearchRequest | null> {
    if (normalized.inputMode !== 'research_area' || !normalized.normalizedQuery.researchArea) {
      return null;
    }

    const cached = await this.loadCachedResearchAreaEnrichment(normalized);
    if (cached) {
      return cached;
    }

    const prompt = `You are improving a grounded funding-search query.

Original user topic:
${normalized.normalizedQuery.researchArea}

Return JSON only:
{
  "rewrittenResearchArea": "short cleaned topic",
  "relatedTerms": ["term 1", "term 2"]
}

Rules:
- Focus only on the research topic.
- Add domain synonyms and adjacent technical terms.
- Do not mention grants, funding, filters, countries, or eligibility.
- Keep rewrittenResearchArea under 120 characters.
- Keep relatedTerms to at most 8 items.`;

    try {
      const response = await runFundingGatewayText({
        taskCode: FUNDING_CHAT_TASK_CODE,
        stageCode: FUNDING_CHAT_QUERY_ENRICHMENT_STAGE_CODE,
        prompt,
        context: llmContext || null,
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxTokensOut: 800,
        metadata: {
          purpose: 'funding_chat_query_enrichment',
          fallbackModelHint: RESEARCH_AREA_ENRICHMENT_MODEL,
        },
      });
      const rawResponse = response?.rawText || '';
      const parsed = extractJsonObject(rawResponse) as {
        rewrittenResearchArea?: string;
        relatedTerms?: string[];
      };

      const rewrittenResearchArea =
        normalizeWhitespace(parsed.rewrittenResearchArea || '') || normalized.normalizedQuery.researchArea;
      const relatedTerms = Array.isArray(parsed.relatedTerms)
        ? parsed.relatedTerms.map((value) => normalizeWhitespace(String(value || ''))).filter(Boolean).slice(0, 8)
        : [];

      const enriched = this.applyResearchAreaEnrichment(normalized, rewrittenResearchArea, relatedTerms);

      if (!enriched) {
        return null;
      }

      await this.saveResearchAreaEnrichmentCache(normalized, rewrittenResearchArea, relatedTerms, {
        rewrittenResearchArea,
        relatedTerms,
      });

      return enriched;
    } catch {
      return null;
    }
  }

  private async buildResponseFromExecution(
    normalized: NormalizedRecommendationSearchRequest,
    execution: SearchExecutionResult,
    access?: RecommendationAccessScope,
    profileContext: RecommendationProfileSnapshot | null = null,
    options: { llmContext?: RecommendationSearchRequest['llmContext']; queryVectorLiteral?: string | null } = {}
  ): Promise<{ response: InternalRecommendationSearchResponse; topScore: number }> {
    const ranked = this.rankExecution(normalized, execution, profileContext);
    const { filteredScored, lowConfidence, topScore } = ranked;

    let noResultsReason: RecommendationSearchResponse['noResultsReason'] = null;
    let relaxationSuggestions: string[] = [];
    let strictFilterRecovery: RecommendationStrictFilterRecovery | null = null;

    if (filteredScored.length === 0) {
      strictFilterRecovery = hasActiveUserFilters(normalized.filters)
        ? await this.buildStrictFilterRecovery(normalized, access, profileContext, options)
        : null;
      noResultsReason = strictFilterRecovery
        ? 'filters_too_strict'
        : normalized.normalizedQuery.queryStrength === 'weak'
          ? 'query_too_weak'
          : 'no_match';
      relaxationSuggestions = buildRelaxationSuggestions(normalized, noResultsReason);
    }

    const applicant = applicantFromProfile(profileContext);
    let rawResults = filteredScored.map(({ candidate, score, profileMatch }) =>
      toPublicResult(candidate, score, normalized, profileMatch, applicant)
    );
    if (isFeatureEnabled('ENABLE_FUNDING_DOC_INTELLIGENCE')) {
      rawResults = await enrichRecommendationResultsWithDocumentEvidence(rawResults, {
        semanticDocument: normalized.normalizedQuery.semanticDocument,
        access,
        llmContext: options.llmContext || null,
        limit: 5,
      });
    }
    const searchDiagnostics = {
      strictFilterRecovery,
      profile: {
        enabled: Boolean(profileContext),
        snapshot: profileContext,
        preferences: profileContext?.preferences || {
          useEligibilityProfile: Boolean(profileContext),
          usePublicationContext: false,
        },
      },
    };

    return {
      topScore,
      response: {
        normalizedQuery: normalized.normalizedQuery,
        appliedFilters: normalized.filters,
        degradedMode: execution.degradedMode,
        lowConfidence,
        noResultsReason,
        relaxationSuggestions,
        strictFilterRecovery,
        searchDiagnostics,
        results: rawResults.map(({ fullDescription, description, amountMin, amountMax, currency, eligibilityText, contactInfo, geographyScope, funderCountry, citizenshipRequirements, residencyRequirements, applicationLanguages, taxonomyAreaIds, semanticSimilarity, textRank, ...publicFields }) => publicFields),
        rawResults,
        totalResults: rawResults.length,
        areaBreakdown: null,
      },
    };
  }

  private async loadCachedQueryVectorLiteral(
    cacheInput: ReturnType<typeof buildQueryEmbeddingCacheInput>
  ): Promise<string | null> {
    try {
      const rows = await prisma.$queryRaw<Array<{ embedding: string }>>(Prisma.sql`
        SELECT ${queryEmbeddingCacheColumnSql(cacheInput)}::text AS embedding
        FROM recommendation_query_embedding_cache
        WHERE request_hash = ${cacheInput.requestHash}
          AND model = ${cacheInput.modelName}
          AND embedding_version = ${cacheInput.version}
          AND task_type = ${cacheInput.taskType}
          AND output_dimensionality = ${cacheInput.outputDimensionality}
          AND ${queryEmbeddingCacheColumnSql(cacheInput)} IS NOT NULL
        LIMIT 1
      `);

      const cached = rows[0]?.embedding;
      if (!cached) {
        return null;
      }

      await prisma.$executeRaw(Prisma.sql`
        UPDATE recommendation_query_embedding_cache
        SET hit_count = hit_count + 1,
            last_used_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE request_hash = ${cacheInput.requestHash}
          AND model = ${cacheInput.modelName}
          AND embedding_version = ${cacheInput.version}
          AND task_type = ${cacheInput.taskType}
          AND output_dimensionality = ${cacheInput.outputDimensionality}
      `);

      return cached;
    } catch {
      return null;
    }
  }

  private async saveQueryVectorLiteral(
    cacheInput: ReturnType<typeof buildQueryEmbeddingCacheInput>,
    vectorLiteral: string
  ) {
    try {
      const cacheColumn = getQueryEmbeddingCacheColumn(cacheInput);
      const embeddingValueSql = Prisma.sql`CAST(${vectorLiteral} AS vector)`;
      const insertEmbeddingSql = cacheColumn === 'embedding_voyage_1024'
        ? Prisma.sql`NULL, ${embeddingValueSql}`
        : Prisma.sql`${embeddingValueSql}, NULL`;
      const updateEmbeddingSql = cacheColumn === 'embedding_voyage_1024'
        ? Prisma.sql`embedding_voyage_1024 = EXCLUDED.embedding_voyage_1024`
        : Prisma.sql`embedding = EXCLUDED.embedding`;

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO recommendation_query_embedding_cache (
          id,
          request_hash,
          input_mode,
          semantic_document,
          model,
          embedding_version,
          task_type,
          output_dimensionality,
          embedding,
          embedding_voyage_1024,
          hit_count,
          last_used_at,
          created_at,
          updated_at
        )
        VALUES (
          ${crypto.randomUUID()},
          ${cacheInput.requestHash},
          ${cacheInput.inputMode},
          ${cacheInput.semanticDocument},
          ${cacheInput.modelName},
          ${cacheInput.version},
          ${cacheInput.taskType},
          ${cacheInput.outputDimensionality},
          ${insertEmbeddingSql},
          1,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("request_hash", "model", "embedding_version", "task_type", "output_dimensionality")
        DO UPDATE SET
          semantic_document = EXCLUDED.semantic_document,
          ${updateEmbeddingSql},
          hit_count = recommendation_query_embedding_cache.hit_count + 1,
          last_used_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `);
    } catch {
      // Cache writes should never make search fail.
    }
  }

  private async getQueryVectorLiteral(
    normalized: NormalizedRecommendationSearchRequest,
    access?: RecommendationAccessScope,
    llmContext?: RecommendationSearchRequest['llmContext']
  ): Promise<string | null> {
    const cacheInput = buildQueryEmbeddingCacheInput(normalized);
    if (!cacheInput.semanticDocument) {
      return null;
    }

    const cached = await this.loadCachedQueryVectorLiteral(cacheInput);
    if (cached) {
      return cached;
    }

    const response = await embeddingService.generateEmbedding(
      cacheInput.semanticDocument,
      {
        tenantId: llmContext?.tenantId || access?.tenantId || null,
        userId: llmContext?.userId || null,
        taskCode: FUNDING_CHAT_TASK_CODE,
        stageCode: 'FUNDING_CHAT_EMBEDDING',
        operation: 'funding_chat_embedding',
      },
      {
        taskType: QUERY_EMBEDDING_TASK_TYPE,
        outputDimensionality: cacheInput.outputDimensionality,
      }
    );
    const vectorLiteral = vectorLiteralFromEmbedding(response.embedding);
    if (!vectorLiteral) {
      return null;
    }

    await this.saveQueryVectorLiteral(cacheInput, vectorLiteral);
    return vectorLiteral;
  }

  private async searchByVector(
    normalized: NormalizedRecommendationSearchRequest,
    ignoreUserFilters = false,
    access?: RecommendationAccessScope,
    llmContext?: RecommendationSearchRequest['llmContext'],
    options: SearchExecutionOptions = {}
  ): Promise<SearchExecutionResult> {
    const baseConditions = buildBaseConditions(normalized, ignoreUserFilters, access);
    const vectorLiteral =
      options.queryVectorLiteral !== undefined
        ? options.queryVectorLiteral
        : await this.getQueryVectorLiteral(normalized, access, llmContext);

    if (!vectorLiteral) {
      throw new Error('Embedding generation failed');
    }

    // HNSW settings (ef_search, iterative scan) so the filtered nearest-
    // neighbour scan fills all VECTOR_CANDIDATE_LIMIT slots.
    const rows = await withVectorSearchSettings(prisma.$queryRaw<RecommendationCandidate[]>(
      Prisma.sql`
        SELECT
          ${selectCandidateColumns()},
          (1 - (${fundingCallSearchEmbeddingColumnSql()} <=> CAST(${vectorLiteral} AS vector))) AS "semanticSimilarity",
          0::float AS "textRank"
        FROM funding_calls
        WHERE ${fundingCallSearchEmbeddingColumnSql()} IS NOT NULL
          AND ${combineConditions(baseConditions)}
        ORDER BY ${fundingCallSearchEmbeddingColumnSql()} <=> CAST(${vectorLiteral} AS vector) ASC
        LIMIT ${VECTOR_CANDIDATE_LIMIT}
      `
    ));

    return {
      candidates: rows,
      degradedMode: null,
    };
  }

  private async searchByFullText(
    normalized: NormalizedRecommendationSearchRequest,
    ignoreUserFilters = false,
    access?: RecommendationAccessScope
  ): Promise<RecommendationCandidate[]> {
    if (!normalized.normalizedQuery.fullTextQuery) {
      return [];
    }

    const baseConditions = buildBaseConditions(normalized, ignoreUserFilters, access);
    const queryText = normalized.normalizedQuery.fullTextQuery;

    return prisma.$queryRaw<RecommendationCandidate[]>(
      Prisma.sql`
        SELECT
          ${selectCandidateColumns()},
          0::float AS "semanticSimilarity",
          ts_rank_cd(ts_document, websearch_to_tsquery('english', ${queryText})) AS "textRank"
        FROM funding_calls
        WHERE ${buildFundingCallTextSearchCondition(queryText)}
          AND ${combineConditions(baseConditions)}
        ORDER BY "textRank" DESC
        LIMIT ${FULLTEXT_CANDIDATE_LIMIT}
      `
    );
  }

  private mergeCandidates(vectorCandidates: RecommendationCandidate[], fullTextCandidates: RecommendationCandidate[]) {
    const merged = new Map<string, RecommendationCandidate>();

    [...vectorCandidates, ...fullTextCandidates].forEach((candidate) => {
      const existing = merged.get(candidate.id);
      if (!existing) {
        merged.set(candidate.id, candidate);
        return;
      }

      merged.set(candidate.id, {
        ...candidate,
        semanticSimilarity: Math.max(existing.semanticSimilarity, candidate.semanticSimilarity),
        textRank: Math.max(existing.textRank, candidate.textRank),
      });
    });

    return Array.from(merged.values())
      .sort((left, right) => {
        const leftBase = Math.max(left.semanticSimilarity, normalizeTextRank(left.textRank));
        const rightBase = Math.max(right.semanticSimilarity, normalizeTextRank(right.textRank));
        return rightBase - leftBase;
      })
      .slice(0, MERGED_CANDIDATE_LIMIT);
  }

  private async rerankCandidates(
    normalized: NormalizedRecommendationSearchRequest,
    candidates: RecommendationCandidate[]
  ) {
    if (!voyageRerankService.isConfigured() || candidates.length <= 1) {
      return candidates;
    }

    const rerankWindow = candidates.slice(0, RERANK_CANDIDATE_LIMIT);
    const remaining = candidates.slice(RERANK_CANDIDATE_LIMIT);
    const documents = rerankWindow.map(buildCandidateRerankDocument);
    const query = normalizeWhitespace(
      normalized.normalizedQuery.semanticDocument ||
      normalized.normalizedQuery.canonicalQueryText ||
      normalized.normalizedQuery.fullTextQuery ||
      ''
    );

    try {
      const reranked = await voyageRerankService.rerank({
        query,
        documents,
        topK: rerankWindow.length,
      });
      if (reranked.length === 0) {
        return candidates;
      }

      const seen = new Set<number>();
      const ordered = reranked
        .filter((item) => item.index >= 0 && item.index < rerankWindow.length)
        .map((item) => {
          seen.add(item.index);
          const candidate = rerankWindow[item.index];
          return {
            ...candidate,
            semanticSimilarity: Math.max(candidate.semanticSimilarity, Math.max(0, Math.min(item.relevanceScore, 1))),
          };
        });

      rerankWindow.forEach((candidate, index) => {
        if (!seen.has(index)) {
          ordered.push(candidate);
        }
      });

      return [...ordered, ...remaining];
    } catch (error) {
      console.warn('Voyage rerank failed; using first-stage funding results.', error instanceof Error ? error.message : String(error));
      return candidates;
    }
  }

  private async executeSearch(
    normalized: NormalizedRecommendationSearchRequest,
    ignoreUserFilters = false,
    access?: RecommendationAccessScope,
    llmContext?: RecommendationSearchRequest['llmContext'],
    options: SearchExecutionOptions = {}
  ): Promise<SearchExecutionResult> {
    const [vectorResult, fullTextResult] = await Promise.allSettled([
      this.searchByVector(normalized, ignoreUserFilters, access, llmContext, options),
      this.searchByFullText(normalized, ignoreUserFilters, access),
    ]);

    let degradedMode: 'full_text_only' | null = null;
    let vectorCandidates: RecommendationCandidate[] = [];
    let fullTextCandidates: RecommendationCandidate[] = [];

    if (vectorResult.status === 'fulfilled') {
      vectorCandidates = vectorResult.value.candidates;
    } else {
      degradedMode = 'full_text_only';
    }

    if (fullTextResult.status === 'fulfilled') {
      fullTextCandidates = fullTextResult.value;
    } else if (vectorResult.status === 'rejected') {
      throw new Error('Both retrieval branches failed');
    }

    return {
      candidates: await this.rerankCandidates(normalized, this.mergeCandidates(vectorCandidates, fullTextCandidates)),
      degradedMode,
    };
  }

  async search(request: RecommendationSearchRequest): Promise<InternalRecommendationSearchResponse> {
    const branches = buildSearchAreaBranches(request);
    if (branches.length >= 2) {
      return this.searchAcrossAreas(request, branches);
    }
    return this.searchSingleTopic(request);
  }

  /**
   * Runs one independent search per selected area and merges the results with per-area
   * attribution. Each branch keeps its own embedding, lexical query, relevance gate and
   * reranker query — the point of the fan-out is that no branch is ever judged against
   * another branch's topic.
   */
  private async searchAcrossAreas(
    request: RecommendationSearchRequest,
    branches: SearchAreaBranch[]
  ): Promise<InternalRecommendationSearchResponse> {
    const responses = await Promise.all(branches.map((branch) => this.searchSingleTopic(branch.request)));
    const primary = responses[0];
    const limit = primary.appliedFilters.limit;
    const merged = mergeAreaSearchResults(branches, responses, limit);

    const rawResults = merged.map((entry) => ({
      ...entry.result,
      score: Number(entry.combinedScore.toFixed(4)),
      matchedAreas: entry.matchedAreas,
    }));

    const areaBreakdown: RecommendationAreaBreakdownItem[] = branches.map((branch, index) => ({
      areaId: branch.areaId,
      label: branch.label,
      queryText: branch.queryText,
      taxonomyPath: branch.taxonomyPath,
      totalResults: responses[index]?.totalResults || 0,
      topScore: Number((responses[index]?.rawResults[0]?.score || 0).toFixed(4)),
    }));

    const withResults = responses.filter((response) => response.totalResults > 0);
    const fallback = responses.find((response) => response.noResultsReason) || primary;

    return {
      normalizedQuery: {
        ...primary.normalizedQuery,
        researchArea: branches.map((branch) => branch.label).join(' | '),
        canonicalQueryText: branches.map((branch) => branch.queryText).join(' | '),
      },
      appliedFilters: primary.appliedFilters,
      degradedMode: responses.some((response) => response.degradedMode === 'full_text_only')
        ? 'full_text_only'
        : null,
      lowConfidence: withResults.length > 0
        ? withResults.every((response) => response.lowConfidence)
        : primary.lowConfidence,
      noResultsReason: rawResults.length === 0 ? fallback.noResultsReason : null,
      relaxationSuggestions: rawResults.length === 0 ? fallback.relaxationSuggestions : [],
      strictFilterRecovery:
        responses.find((response) => response.strictFilterRecovery)?.strictFilterRecovery || null,
      searchDiagnostics: primary.searchDiagnostics,
      results: rawResults.map(({ fullDescription, description, amountMin, amountMax, currency, eligibilityText, contactInfo, geographyScope, funderCountry, citizenshipRequirements, residencyRequirements, applicationLanguages, taxonomyAreaIds, semanticSimilarity, textRank, ...publicFields }) => publicFields),
      rawResults,
      totalResults: rawResults.length,
      areaBreakdown,
    };
  }

  private async searchSingleTopic(request: RecommendationSearchRequest): Promise<InternalRecommendationSearchResponse> {
    const usePersonalContext =
      request.useProfileContext === true ||
      request.useEligibilityProfile === true ||
      request.usePublicationContext === true;
    const profileContext = usePersonalContext ? request.profileContext || null : null;
    const normalized = this.applyProfileContextToQuery(normalizeRecommendationSearchRequest(request), profileContext);
    const queryVectorLiteral = await this.getQueryVectorLiteral(normalized, request.access, request.llmContext);
    const execution = await this.executeSearch(
      normalized,
      false,
      request.access,
      request.llmContext,
      { queryVectorLiteral }
    );
    let best = await this.buildResponseFromExecution(
      normalized,
      execution,
      request.access,
      profileContext,
      { llmContext: request.llmContext, queryVectorLiteral }
    );

    if ((best.response.totalResults === 0 || best.response.lowConfidence) && normalized.inputMode === 'research_area') {
      const enriched = await this.enrichResearchAreaRequest(normalized, request.llmContext);
      if (enriched) {
        const enrichedQueryVectorLiteral = await this.getQueryVectorLiteral(enriched, request.access, request.llmContext);
        const enrichedExecution = await this.executeSearch(
          enriched,
          false,
          request.access,
          request.llmContext,
          { queryVectorLiteral: enrichedQueryVectorLiteral }
        );
        const enrichedResult = await this.buildResponseFromExecution(
          enriched,
          enrichedExecution,
          request.access,
          profileContext,
          { llmContext: request.llmContext, queryVectorLiteral: enrichedQueryVectorLiteral }
        );

        if (
          enrichedResult.response.totalResults > best.response.totalResults ||
          enrichedResult.topScore > best.topScore + 0.03
        ) {
          best = enrichedResult;
        }
      }
    }

    return best.response;
  }

  async getDirectoryFacets(request: DirectoryFacetRequest): Promise<DirectoryFacetResponse> {
    const rawQuery = normalizeWhitespace(request.query || '').slice(0, 300);
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: rawQuery || 'funding opportunities' },
      filters: request.filters,
    });
    const filters = normalized.filters;

    // Every filter that is not a facet, and the search text, narrow the row
    // set once. Facet filters are then applied per facet: a facet's counts
    // use every chosen facet except its own (values inside one facet are
    // alternatives), so with "Fellowship" chosen, "Research Grant" shows the
    // calls choosing it as well would give, not the calls that are both.
    const withoutFacetFilters = {
      ...normalized,
      filters: { ...filters, ...Object.fromEntries(FACET_FILTER_FIELDS.map((field) => [field, []])), noMembershipNeeded: false },
    } as NormalizedRecommendationSearchRequest;
    const where = combineConditions([
      ...buildBaseConditions(withoutFacetFilters, false, request.access),
      rawQuery ? directoryTextCondition(rawQuery) : Prisma.sql`TRUE`,
    ]);
    const dimensions = Object.keys(FACET_DIMENSION_FIELD) as DirectoryFacetDimension[];
    type Chosen = { dimension: DirectoryFacetDimension | 'membership'; condition: Prisma.Sql };
    const chosen: Chosen[] = dimensions
      .map((dimension) => ({
        dimension,
        condition: facetFilterCondition(FACET_DIMENSION_FIELD[dimension], filters, Prisma.raw('matched.id'), Prisma.raw('matched.source_mobility')),
      }))
      .filter((entry): entry is { dimension: DirectoryFacetDimension; condition: Prisma.Sql } => entry.condition !== null);
    if (filters.noMembershipNeeded) chosen.push({ dimension: 'membership', condition: Prisma.sql`NOT ${MEMBERSHIP_REQUIRED_SQL}` });
    const exceptOwn = (dimension: Chosen['dimension']) =>
      combineConditions(chosen.filter((entry) => entry.dimension !== dimension).map((entry) => entry.condition));
    // Bucketed facets: one row per value whose condition the call meets.
    const bucketFacet = (dimension: DirectoryFacetDimension, cases: Record<string, Prisma.Sql>) => Prisma.sql`
      SELECT * FROM (
        SELECT ${tag(dimension)} AS dimension, bucket AS value, NULL::text AS label, ${noLevels}, COUNT(*)::int AS count
        FROM matched, unnest(${sqlTextArray(Object.keys(cases))}) AS bucket
        WHERE ${exceptOwn(dimension)}
          AND CASE bucket ${Prisma.join(Object.entries(cases).map(([value, condition]) => Prisma.sql`WHEN ${value} THEN ${condition}`), ' ')} ELSE FALSE END
        GROUP BY bucket
      ) ${Prisma.raw(`facet_${dimension}`)}`;

    type FacetRow = {
      dimension: string;
      value: string;
      label: string | null;
      level1Code: string | null;
      level1Name: string | null;
      level2Code: string | null;
      level2Name: string | null;
      count: number;
    };
    const FACET_LIMIT = 30;
    // All 53 research areas fit; funders beyond the top 30 come from the funder search.
    const TAXONOMY_LIMIT = 80;
    const noLevels = Prisma.sql`NULL::text AS "level1Code", NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name"`;
    const tag = (dimension: DirectoryFacetDimension) => Prisma.raw(`'${dimension}'`);
    const listFacet = (dimension: DirectoryFacetDimension, column: string) => Prisma.sql`
      SELECT * FROM (
        SELECT ${tag(dimension)} AS dimension, val AS value, NULL::text AS label, ${noLevels}, COUNT(*)::int AS count
        FROM matched, unnest(matched.${Prisma.raw(column)}) AS val
        WHERE ${exceptOwn(dimension)}
        GROUP BY val ORDER BY count DESC, value ASC LIMIT ${FACET_LIMIT}
      ) ${Prisma.raw(`facet_${dimension}`)}`;
    const scalarFacet = (dimension: DirectoryFacetDimension, column: string) => Prisma.sql`
      SELECT * FROM (
        SELECT ${tag(dimension)} AS dimension, matched.${Prisma.raw(column)} AS value, NULL::text AS label, ${noLevels}, COUNT(*)::int AS count
        FROM matched
        WHERE matched.${Prisma.raw(column)} IS NOT NULL AND ${exceptOwn(dimension)}
        GROUP BY matched.${Prisma.raw(column)} ORDER BY count DESC, value ASC LIMIT ${FACET_LIMIT}
      ) ${Prisma.raw(`facet_${dimension}`)}`;

    // One statement: the shared filter runs once into a materialized set
    // that the total and every facet read.
    const rows = await prisma.$queryRaw<FacetRow[]>(Prisma.sql`
        WITH matched AS MATERIALIZED (
          SELECT id, funding_kinds, career_stages, institution_types, sponsor_type, eligible_regions, geography_scope,
                 funder_id, agency_name, "agencyName", programme_framework, sdg_goals,
                 required_qualifications, target_groups, indirect_cost_policy, nomination_note, membership_requirements,
                 project_duration_min_months, project_duration_max_months,
                 ${MOBILITY_SQL} AS source_mobility
          FROM funding_calls
          WHERE ${where}
        )
        SELECT 'total' AS dimension, NULL::text AS value, NULL::text AS label, ${noLevels}, COUNT(*)::int AS count
        FROM matched
        WHERE ${combineConditions(chosen.map((entry) => entry.condition))}
        UNION ALL
        SELECT * FROM (
          SELECT
            'taxonomyArea' AS dimension,
            taxonomy.taxonomy_area_id AS value,
            COALESCE(
              NULLIF(CONCAT_WS(' / ', NULLIF(taxonomy.taxonomy_level1_name, ''), NULLIF(taxonomy.taxonomy_level2_name, '')), ''),
              taxonomy.taxonomy_area_id
            ) AS label,
            taxonomy.taxonomy_level1_code AS "level1Code",
            taxonomy.taxonomy_level1_name AS "level1Name",
            taxonomy.taxonomy_level2_code AS "level2Code",
            taxonomy.taxonomy_level2_name AS "level2Name",
            COUNT(DISTINCT matched.id)::int AS count
          FROM matched
          INNER JOIN funding_call_research_area_taxonomies taxonomy
            ON taxonomy.funding_call_id = matched.id
          WHERE ${exceptOwn('taxonomyArea')}
          GROUP BY taxonomy.taxonomy_area_id, taxonomy.taxonomy_level1_code, taxonomy.taxonomy_level1_name,
                   taxonomy.taxonomy_level2_code, taxonomy.taxonomy_level2_name
          ORDER BY count DESC, value ASC LIMIT ${TAXONOMY_LIMIT}
        ) facet_taxonomy
        UNION ALL ${listFacet('fundingKind', 'funding_kinds')}
        UNION ALL ${listFacet('careerStage', 'career_stages')}
        UNION ALL ${listFacet('institutionType', 'institution_types')}
        UNION ALL ${scalarFacet('sponsorType', 'sponsor_type')}
        UNION ALL ${listFacet('region', 'eligible_regions')}
        UNION ALL ${scalarFacet('geographyScope', 'geography_scope')}
        UNION ALL ${listFacet('qualification', 'required_qualifications')}
        UNION ALL ${listFacet('targetGroup', 'target_groups')}
        UNION ALL ${scalarFacet('indirectCosts', 'indirect_cost_policy')}
        UNION ALL ${bucketFacet('projectDuration', Object.fromEntries(Object.keys(PROJECT_DURATION_BUCKETS).map((bucket) => [bucket, projectDurationCondition([bucket])])))}
        UNION ALL ${bucketFacet('applicationRoute', APPLICATION_ROUTE_SQL)}
        UNION ALL ${bucketFacet('mobility', Object.fromEntries(Object.keys(MOBILITY_SOURCE_VALUES).map((value) => [value, mobilityCondition([value], Prisma.raw('matched.source_mobility'))])))}
        UNION ALL
        SELECT 'toggle:membershipRequired' AS dimension, NULL::text AS value, NULL::text AS label, ${noLevels}, COUNT(*)::int AS count
        FROM matched
        WHERE ${exceptOwn('membership')} AND ${MEMBERSHIP_REQUIRED_SQL}
        UNION ALL
        SELECT * FROM (
          SELECT 'funder' AS dimension, funder.id AS value, funder.name AS label, ${noLevels}, COUNT(*)::int AS count
          FROM matched
          INNER JOIN funders funder ON funder.id = matched.funder_id
          WHERE ${exceptOwn('funder')}
          GROUP BY funder.id, funder.name ORDER BY count DESC, value ASC LIMIT ${FACET_LIMIT}
        ) facet_funder
        UNION ALL
        SELECT * FROM (
          -- The programme and its first sub-level ("Horizon Europe",
          -- "Horizon Europe › Cluster 5"); the filter matches by prefix.
          SELECT 'programmeFramework' AS dimension, prefix AS value, NULL::text AS label, ${noLevels},
                 COUNT(DISTINCT matched.id)::int AS count
          FROM matched,
               unnest(ARRAY[
                 split_part(matched.programme_framework, ' › ', 1),
                 CASE WHEN split_part(matched.programme_framework, ' › ', 2) <> ''
                      THEN split_part(matched.programme_framework, ' › ', 1) || ' › ' || split_part(matched.programme_framework, ' › ', 2)
                 END
               ]) AS prefix
          WHERE matched.programme_framework IS NOT NULL AND COALESCE(prefix, '') <> '' AND ${exceptOwn('programmeFramework')}
          GROUP BY prefix ORDER BY count DESC, value ASC LIMIT ${FACET_LIMIT}
        ) facet_programme
        UNION ALL
        SELECT * FROM (
          SELECT 'sdgGoal' AS dimension, goal::text AS value, NULL::text AS label, ${noLevels}, COUNT(*)::int AS count
          FROM matched, unnest(matched.sdg_goals) AS goal
          WHERE ${exceptOwn('sdgGoal')}
          GROUP BY goal ORDER BY count DESC, value ASC LIMIT ${FACET_LIMIT}
        ) facet_sdg
      `);

    const facets = Object.fromEntries(dimensions.map((dimension) => [dimension, [] as DirectoryFacetItem[]])) as Record<
      DirectoryFacetDimension,
      DirectoryFacetItem[]
    >;
    let total = 0;
    let membershipRequired = 0;
    for (const row of rows) {
      if (row.dimension === 'total') {
        total = row.count;
        continue;
      }
      if (row.dimension === 'toggle:membershipRequired') {
        membershipRequired = row.count;
        continue;
      }
      const dim = row.dimension as DirectoryFacetDimension;
      if (!facets[dim] || !row.value) continue;
      // Controlled vocabularies: offer only values a filter can name. A stored
      // spelling outside the vocabulary ("Think Tank") would be refused by
      // the API, and a synonym ("Company") would filter on its canonical
      // value ("Corporate") and show another count.
      const canonical = FACET_VOCABULARY[dim];
      if (canonical && canonical([row.value])?.[0] !== row.value) continue;
      facets[dim].push({
        value: row.value,
        label:
          row.label ||
          (dim === 'sdgGoal' && SDG_GOAL_LABELS[row.value] ? `SDG ${row.value} · ${SDG_GOAL_LABELS[row.value]}` : undefined),
        level1Code: row.level1Code || undefined,
        level1Name: row.level1Name || undefined,
        level2Code: row.level2Code || undefined,
        level2Name: row.level2Name || undefined,
        count: row.count,
      });
    }

    return {
      totalPublished: total,
      facets,
      toggles: { membershipRequired },
    };
  }

  async browseDirectory(request: RecommendationDirectoryRequest): Promise<RecommendationDirectoryResponse> {
    const rawQuery = normalizeWhitespace(request.query || '');
    const usePersonalContext =
      request.useProfileContext === true ||
      request.useEligibilityProfile === true ||
      request.usePublicationContext === true;
    const profileContext = usePersonalContext ? request.profileContext || null : null;
    const normalized = this.applyProfileContextToQuery(normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: rawQuery || 'funding opportunities' },
      filters: request.filters,
    }), profileContext);
    const baseConditions = buildBaseConditions(normalized, false, request.access);
    // The search box matches the words as typed; the expanded query (and any
    // profile terms) only rank, so preferences never change what matches.
    const textQuery = rawQuery.slice(0, 300);
    const hasQuery = Boolean(textQuery);
    const where = combineConditions([
      ...baseConditions,
      hasQuery ? directoryTextCondition(textQuery) : Prisma.sql`TRUE`,
    ]);
    const page = Math.max(request.page || 1, 1);
    const pageSize = normalized.filters.limit;

    const countRows = await prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM funding_calls
        WHERE ${where}
      `
    );

    const totalResults = countRows[0]?.count || 0;
    const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
    const safePage = Math.min(page, totalPages);
    const safeOffset = (safePage - 1) * pageSize;

    const rows = hasQuery
      ? await prisma.$queryRaw<RecommendationCandidate[]>(
          Prisma.sql`
            SELECT
              ${selectCandidateColumns()},
              0::float AS "semanticSimilarity",
              ts_rank_cd(ts_document, websearch_to_tsquery('english', ${textQuery})) AS "textRank"
            FROM funding_calls
            WHERE ${where}
            ORDER BY ${
              normalized.filters.sort === 'deadline_soonest'
                ? Prisma.sql`COALESCE(close_date, expiration_date) ASC NULLS LAST, ${CURATED_FIRST_SQL}, "textRank" DESC, scheme_title ASC`
                : Prisma.sql`"textRank" DESC, ${CURATED_FIRST_SQL}, COALESCE(close_date, expiration_date) ASC NULLS LAST, scheme_title ASC`
            }
            LIMIT ${pageSize}
            OFFSET ${safeOffset}
          `
        )
      : await prisma.$queryRaw<RecommendationCandidate[]>(
          Prisma.sql`
            SELECT
              ${selectCandidateColumns()},
              0::float AS "semanticSimilarity",
              0::float AS "textRank"
            FROM funding_calls
            WHERE ${where}
            ORDER BY ${
              normalized.filters.sort === 'deadline_soonest'
                ? Prisma.sql`COALESCE(close_date, expiration_date) ASC NULLS LAST, ${CURATED_FIRST_SQL}, "updatedAt" DESC NULLS LAST, scheme_title ASC`
                : Prisma.sql`${CURATED_FIRST_SQL}, "updatedAt" DESC NULLS LAST, COALESCE(close_date, expiration_date) ASC NULLS LAST, scheme_title ASC`
            }
            LIMIT ${pageSize}
            OFFSET ${safeOffset}
          `
        );

    const scoredRows = rows.map((candidate) => {
      const profileMatch = buildProfileMatch(candidate, profileContext);
      const score = hasQuery || profileMatch ? scoreCandidate(candidate, normalized, profileMatch) : 0;
      return { candidate, score, profileMatch };
    });
    const applicant = applicantFromProfile(profileContext);
    const orderedRows = normalized.filters.sort === 'best_match'
      ? sortCandidates(scoredRows, normalized, applicant)
      : scoredRows;
    const results = orderedRows.map(({ candidate, score, profileMatch }) => {
      const mapped = toPublicResult(candidate, score, normalized, profileMatch, applicant);
      return {
        ...mapped,
        score: Number(score.toFixed(4)),
        matchReasons: hasQuery ? mapped.matchReasons : [],
      };
    });

    return {
      query: rawQuery,
      appliedFilters: normalized.filters,
      results,
      totalResults,
      page: safePage,
      pageSize,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    };
  }

  createLogSummary(request: RecommendationSearchRequest) {
    return {
      hash: createRequestHash(request as unknown as Record<string, unknown>),
      mode: request.inputMode,
      limit: request.filters?.limit || 10,
    };
  }

  toLegacyFundingCall(rawResult: InternalRecommendationSearchResponse['rawResults'][number]) {
    return {
      id: rawResult.id,
      agencyName: rawResult.agencyName,
      schemeTitle: rawResult.schemeTitle,
      description: rawResult.fullDescription || rawResult.shortDescription || rawResult.description,
      deadline: rawResult.closeDate ? new Date(rawResult.closeDate) : null,
      fundingAmount: formatFundingAmount(rawResult.amountMin, rawResult.amountMax, rawResult.currency),
      eligibility: rawResult.eligibilityText || rawResult.eligibilitySummary,
      researchAreas: rawResult.disciplines,
      urls: rawResult.officialUrls,
      contactInfo: rawResult.contactInfo || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      countryAvailability: rawResult.hostCountries,
      eligibleApplicantCountries: rawResult.eligibleCountries,
      applicantTypes: rawResult.institutionTypes,
      grantTypes: rawResult.fundingKinds,
      isActive: true,
      status: 'PUBLISHED',
      callUrl: rawResult.officialUrls[0] || null,
      attachmentFile: null,
    };
  }
}

export const recommendationSearchService = new RecommendationSearchService();
