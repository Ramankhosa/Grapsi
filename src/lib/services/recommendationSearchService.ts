import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { EmbeddingService } from './embeddingService';
import { generateFromGemini } from '../geminiService';
import { extractJsonObject } from '../recommendations/conversationUtils';
import { sanitizeExternalUrls } from '../urlSafety';
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
  RecommendationCandidate,
  RecommendationSearchFilters,
  RecommendationSearchRequest,
  RecommendationSearchResponse,
  RecommendationSearchResultItem,
  RecommendationStrictFilterRecovery,
} from '../recommendations/types';
import {
  buildCountryMatchKeys,
  createRequestHash,
  formatFundingAmount,
  normalizeKey,
  normalizeRecommendationSearchRequest,
  normalizeWhitespace,
} from '../recommendations/utils';

const embeddingService = new EmbeddingService();

const VECTOR_CANDIDATE_LIMIT = 60;
const FULLTEXT_CANDIDATE_LIMIT = 60;
const MERGED_CANDIDATE_LIMIT = 100;
const NO_RESULT_SCORE_THRESHOLD = 0.2;
const LOW_CONFIDENCE_THRESHOLD = 0.35;
const RESEARCH_AREA_ENRICHMENT_MODEL = 'gemini-2.0-flash-lite';
const QUERY_ENRICHMENT_CACHE_VERSION = 'v1';
const STRICT_FILTER_RECOVERY_LADDER: Array<Array<keyof RecommendationSearchFilters>> = [
  ['taxonomyAreaIds'],
  ['careerStages', 'institutionTypes', 'sponsorTypes', 'citizenshipRequirements', 'residencyRequirements', 'applicationLanguages'],
  ['hostCountries', 'eligibleRegions', 'geographyScope', 'funderCountries'],
  ['eligibleCountries'],
  ['fundingKinds'],
  ['deadlineFrom', 'deadlineTo', 'rollingOnly', 'amountMin', 'amountMax'],
];

type SearchExecutionResult = {
  candidates: RecommendationCandidate[];
  degradedMode: 'full_text_only' | null;
};

type ScoredCandidate = {
  candidate: RecommendationCandidate;
  score: number;
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

function buildArrayAnyCondition(columnName: string, values: string[]) {
  const lowered = sqlLowerTextArray(values.map((value) => normalizeKey(value)));
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM unnest(${Prisma.raw(columnName)}) AS value
      WHERE LOWER(value) = ANY(${lowered})
    )
  `;
}

function buildScalarAnyCondition(columnName: string, values: string[]) {
  const lowered = sqlLowerTextArray(values.map((value) => normalizeKey(value)));
  return Prisma.sql`LOWER(COALESCE(${Prisma.raw(columnName)}, '')) = ANY(${lowered})`;
}

function buildTaxonomyAreaCondition(areaIds: string[]) {
  const ids = sqlTextArray(areaIds);
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM funding_call_research_area_taxonomies taxonomy_filter
      WHERE taxonomy_filter.funding_call_id = funding_calls.id
        AND taxonomy_filter.taxonomy_area_id = ANY(${ids})
    )
  `;
}

function buildFundingCallTextSearchCondition(fullTextQuery: string) {
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

function buildAccessCondition(access?: RecommendationAccessScope) {
  if (access?.isSuperAdmin) {
    return Prisma.sql`TRUE`;
  }

  if (access?.tenantId) {
    return Prisma.sql`(
      visibility = 'GLOBAL_PUBLISHED' OR
      (visibility = 'TENANT_PRIVATE' AND "tenantId" = ${access.tenantId})
    )`;
  }

  return Prisma.sql`visibility = 'GLOBAL_PUBLISHED'`;
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
    conditions.push(
      Prisma.sql`COALESCE(amount_max, amount_min) IS NOT NULL AND COALESCE(amount_max, amount_min) >= ${filters.amountMin}`
    );
  }

  if (filters.amountMax !== null) {
    conditions.push(
      Prisma.sql`COALESCE(amount_min, amount_max) IS NOT NULL AND COALESCE(amount_min, amount_max) <= ${filters.amountMax}`
    );
  }

  if (filters.geographyScope.length > 0) {
    conditions.push(buildScalarAnyCondition('geography_scope', filters.geographyScope));
  }

  if (filters.fundingKinds.length > 0) {
    conditions.push(buildArrayAnyCondition('funding_kinds', filters.fundingKinds));
  }

  if (filters.institutionTypes.length > 0) {
    conditions.push(buildArrayAnyCondition('institution_types', filters.institutionTypes));
  }

  if (filters.careerStages.length > 0) {
    conditions.push(buildArrayAnyCondition('career_stages', filters.careerStages));
  }

  if (filters.sponsorTypes.length > 0) {
    conditions.push(buildScalarAnyCondition('sponsor_type', filters.sponsorTypes));
  }

  if (filters.taxonomyAreaIds.length > 0) {
    conditions.push(buildTaxonomyAreaCondition(filters.taxonomyAreaIds));
  }

  if (filters.applicationLanguages.length > 0) {
    conditions.push(buildArrayAnyCondition('application_languages', filters.applicationLanguages));
  }

  if (filters.eligibleRegions.length > 0) {
    conditions.push(buildArrayAnyCondition('eligible_regions', filters.eligibleRegions));
  }

  if (filters.eligibleCountries.length > 0) {
    conditions.push(buildArrayAnyCondition('eligible_countries', buildCountryMatchKeys(filters.eligibleCountries)));
  }

  if (filters.hostCountries.length > 0) {
    conditions.push(buildArrayAnyCondition('host_countries', buildCountryMatchKeys(filters.hostCountries)));
  }

  if (filters.funderCountries.length > 0) {
    conditions.push(buildScalarAnyCondition('funder_country', buildCountryMatchKeys(filters.funderCountries)));
  }

  if (filters.citizenshipRequirements.length > 0) {
    conditions.push(buildArrayAnyCondition('citizenship_requirements', filters.citizenshipRequirements));
  }

  if (filters.residencyRequirements.length > 0) {
    conditions.push(buildArrayAnyCondition('residency_requirements', filters.residencyRequirements));
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
    COALESCE(application_languages, ARRAY[]::text[]) AS "applicationLanguages"
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

function buildMatchReasons(candidate: RecommendationCandidate, normalized: NormalizedRecommendationSearchRequest) {
  const reasons: string[] = [];
  const disciplineHits = candidate.disciplines.filter((value) =>
    normalized.normalizedQuery.researchTags.map((item) => normalizeKey(item)).includes(normalizeKey(value))
  );

  if (disciplineHits.length > 0) {
    reasons.push(`Matched discipline: ${disciplineHits.slice(0, 2).join(', ')}`);
  } else if (candidate.semanticSimilarity >= 0.45) {
    reasons.push('High semantic match to the query text');
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
  normalized: NormalizedRecommendationSearchRequest
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
      filters[key] = [] as never;
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

function scoreCandidate(candidate: RecommendationCandidate, normalized: NormalizedRecommendationSearchRequest) {
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

  if (!hasSemanticSignal) {
    return (
      textRank * 0.5 +
      disciplineOverlap * 0.22 +
      fundingKindOverlap * 0.08 +
      geographyFit * 0.06 +
      institutionFit * 0.04 +
      careerFit * 0.03 +
      eligibilityFit * 0.02 +
      deadlineFreshness * 0.05
    );
  }

  return (
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
}

function sortCandidates(
  candidates: Array<{ candidate: RecommendationCandidate; score: number }>,
  normalized: NormalizedRecommendationSearchRequest
) {
  if (normalized.filters.sort === 'deadline_soonest') {
    const allRolling = candidates.every((item) => item.candidate.isRolling || !item.candidate.closeDate);
    return candidates.sort((left, right) => {
      const leftDate = parseDateValue(left.candidate.closeDate);
      const rightDate = parseDateValue(right.candidate.closeDate);

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

  return candidates.sort((left, right) => right.score - left.score || left.candidate.schemeTitle.localeCompare(right.candidate.schemeTitle));
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

export class RecommendationSearchService {
  private rankExecution(
    normalized: NormalizedRecommendationSearchRequest,
    execution: SearchExecutionResult
  ): RankedExecution {
    const hasSemanticCandidates = execution.candidates.some((candidate) => candidate.semanticSimilarity >= 0.08);
    const scoreThreshold = hasSemanticCandidates ? NO_RESULT_SCORE_THRESHOLD : 0.08;
    const lowConfidenceThreshold = hasSemanticCandidates ? LOW_CONFIDENCE_THRESHOLD : 0.2;
    const scored = sortCandidates(
      execution.candidates.map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, normalized),
      })),
      normalized
    );

    const topScore = scored[0]?.score || 0;
    const lowConfidence = topScore >= scoreThreshold && topScore < lowConfidenceThreshold;
    const filteredScored = scored.filter((item) => item.score >= scoreThreshold).slice(0, normalized.filters.limit);

    return {
      filteredScored,
      topScore,
      lowConfidence,
    };
  }

  private async buildStrictFilterRecovery(
    normalized: NormalizedRecommendationSearchRequest,
    access?: RecommendationAccessScope
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
      const relaxedExecution = await this.executeSearch(relaxedNormalized, false, access);
      const relaxedRanking = this.rankExecution(relaxedNormalized, relaxedExecution);
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
    normalized: NormalizedRecommendationSearchRequest
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
      const rawResponse = await generateFromGemini(prompt, RESEARCH_AREA_ENRICHMENT_MODEL);
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
    access?: RecommendationAccessScope
  ): Promise<{ response: InternalRecommendationSearchResponse; topScore: number }> {
    const ranked = this.rankExecution(normalized, execution);
    const { filteredScored, lowConfidence, topScore } = ranked;

    let noResultsReason: RecommendationSearchResponse['noResultsReason'] = null;
    let relaxationSuggestions: string[] = [];
    let strictFilterRecovery: RecommendationStrictFilterRecovery | null = null;

    if (filteredScored.length === 0) {
      strictFilterRecovery = hasActiveUserFilters(normalized.filters)
        ? await this.buildStrictFilterRecovery(normalized, access)
        : null;
      noResultsReason = strictFilterRecovery
        ? 'filters_too_strict'
        : normalized.normalizedQuery.queryStrength === 'weak'
          ? 'query_too_weak'
          : 'no_match';
      relaxationSuggestions = buildRelaxationSuggestions(normalized, noResultsReason);
    }

    const rawResults = filteredScored.map(({ candidate, score }) => toPublicResult(candidate, score, normalized));

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
        results: rawResults.map(({ fullDescription, description, amountMin, amountMax, currency, eligibilityText, contactInfo, geographyScope, funderCountry, citizenshipRequirements, residencyRequirements, applicationLanguages, semanticSimilarity, textRank, ...publicFields }) => publicFields),
        rawResults,
        totalResults: rawResults.length,
      },
    };
  }

  private async searchByVector(
    normalized: NormalizedRecommendationSearchRequest,
    ignoreUserFilters = false,
    access?: RecommendationAccessScope
  ): Promise<SearchExecutionResult> {
    const baseConditions = buildBaseConditions(normalized, ignoreUserFilters, access);
    const vectorText = `[${(await embeddingService.generateEmbedding(normalized.normalizedQuery.semanticDocument)).embedding.join(',')}]`;
    const vectorLiteral = vectorText === '[]' ? null : vectorText;

    if (!vectorLiteral) {
      throw new Error('Embedding generation failed');
    }

    const rows = await prisma.$queryRaw<RecommendationCandidate[]>(
      Prisma.sql`
        SELECT
          ${selectCandidateColumns()},
          (1 - (embedding <=> CAST(${vectorLiteral} AS vector))) AS "semanticSimilarity",
          0::float AS "textRank"
        FROM funding_calls
        WHERE embedding IS NOT NULL
          AND ${combineConditions(baseConditions)}
        ORDER BY embedding <=> CAST(${vectorLiteral} AS vector) ASC
        LIMIT ${VECTOR_CANDIDATE_LIMIT}
      `
    );

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

  private async executeSearch(
    normalized: NormalizedRecommendationSearchRequest,
    ignoreUserFilters = false,
    access?: RecommendationAccessScope
  ): Promise<SearchExecutionResult> {
    const [vectorResult, fullTextResult] = await Promise.allSettled([
      this.searchByVector(normalized, ignoreUserFilters, access),
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
      candidates: this.mergeCandidates(vectorCandidates, fullTextCandidates),
      degradedMode,
    };
  }

  async search(request: RecommendationSearchRequest): Promise<InternalRecommendationSearchResponse> {
    const normalized = normalizeRecommendationSearchRequest(request);
    const execution = await this.executeSearch(normalized, false, request.access);
    let best = await this.buildResponseFromExecution(normalized, execution, request.access);

    if ((best.response.totalResults === 0 || best.response.lowConfidence) && normalized.inputMode === 'research_area') {
      const enriched = await this.enrichResearchAreaRequest(normalized);
      if (enriched) {
        const enrichedExecution = await this.executeSearch(enriched, false, request.access);
        const enrichedResult = await this.buildResponseFromExecution(enriched, enrichedExecution, request.access);

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
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: normalizeWhitespace(request.query || '') || 'funding opportunities' },
      filters: request.filters,
    });
    const baseConditions = buildBaseConditions(normalized, false, request.access);
    const hasQuery = Boolean(request.query?.trim()) && Boolean(normalized.normalizedQuery.fullTextQuery);
    const where = combineConditions([
      ...baseConditions,
      hasQuery ? buildFundingCallTextSearchCondition(normalized.normalizedQuery.fullTextQuery) : Prisma.sql`TRUE`,
    ]);

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

    const [totalRow, facetRows] = await Promise.all([
      prisma.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS count
          FROM funding_calls
          WHERE ${where}
        `
      ),
      prisma.$queryRaw<FacetRow[]>(Prisma.sql`
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
            COUNT(*)::int AS count
          FROM funding_calls
          INNER JOIN funding_call_research_area_taxonomies taxonomy
            ON taxonomy.funding_call_id = funding_calls.id
          WHERE ${where}
          GROUP BY taxonomy.taxonomy_area_id, taxonomy.taxonomy_level1_code, taxonomy.taxonomy_level1_name,
                   taxonomy.taxonomy_level2_code, taxonomy.taxonomy_level2_name
          ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) tx
        UNION ALL
        SELECT * FROM (
          SELECT 'researchArea' AS dimension, val AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls, unnest(disciplines) AS val
          WHERE ${where}
          GROUP BY val ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) ra
        UNION ALL
        SELECT * FROM (
          SELECT 'country' AS dimension, val AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls, unnest(eligible_countries) AS val
          WHERE ${where}
          GROUP BY val ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) co
        UNION ALL
        SELECT * FROM (
          SELECT 'fundingKind' AS dimension, val AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls, unnest(funding_kinds) AS val
          WHERE ${where}
          GROUP BY val ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) fk
        UNION ALL
        SELECT * FROM (
          SELECT 'careerStage' AS dimension, val AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls, unnest(career_stages) AS val
          WHERE ${where}
          GROUP BY val ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) cs
        UNION ALL
        SELECT * FROM (
          SELECT 'discipline' AS dimension, val AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls, unnest(disciplines) AS val
          WHERE ${where}
          GROUP BY val ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) ds
        UNION ALL
        SELECT * FROM (
          SELECT 'sponsorType' AS dimension, sponsor_type AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls
          WHERE sponsor_type IS NOT NULL AND ${where}
          GROUP BY sponsor_type ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) sp
        UNION ALL
        SELECT * FROM (
          SELECT 'region' AS dimension, val AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls, unnest(eligible_regions) AS val
          WHERE ${where}
          GROUP BY val ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) rg
        UNION ALL
        SELECT * FROM (
          SELECT 'institutionType' AS dimension, val AS value, NULL::text AS label, NULL::text AS "level1Code",
                 NULL::text AS "level1Name", NULL::text AS "level2Code", NULL::text AS "level2Name", COUNT(*)::int AS count
          FROM funding_calls, unnest(institution_types) AS val
          WHERE ${where}
          GROUP BY val ORDER BY count DESC LIMIT ${FACET_LIMIT}
        ) it
      `),
    ]);

    const facets: Record<DirectoryFacetDimension, DirectoryFacetItem[]> = {
      taxonomyArea: [],
      researchArea: [],
      country: [],
      fundingKind: [],
      careerStage: [],
      discipline: [],
      sponsorType: [],
      region: [],
      institutionType: [],
    };

    for (const row of facetRows) {
      const dim = row.dimension as DirectoryFacetDimension;
      if (facets[dim] && row.value) {
        facets[dim].push({
          value: row.value,
          label: row.label || undefined,
          level1Code: row.level1Code || undefined,
          level1Name: row.level1Name || undefined,
          level2Code: row.level2Code || undefined,
          level2Name: row.level2Name || undefined,
          count: row.count,
        });
      }
    }

    return {
      totalPublished: totalRow[0]?.count || 0,
      facets,
    };
  }

  async browseDirectory(request: RecommendationDirectoryRequest): Promise<RecommendationDirectoryResponse> {
    const rawQuery = normalizeWhitespace(request.query || '');
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: rawQuery || 'funding opportunities' },
      filters: request.filters,
    });
    const baseConditions = buildBaseConditions(normalized, false, request.access);
    const hasQuery = Boolean(rawQuery) && Boolean(normalized.normalizedQuery.fullTextQuery);
    const where = combineConditions([
      ...baseConditions,
      hasQuery ? buildFundingCallTextSearchCondition(normalized.normalizedQuery.fullTextQuery) : Prisma.sql`TRUE`,
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
              ts_rank_cd(ts_document, websearch_to_tsquery('english', ${normalized.normalizedQuery.fullTextQuery})) AS "textRank"
            FROM funding_calls
            WHERE ${where}
            ORDER BY ${
              normalized.filters.sort === 'deadline_soonest'
                ? Prisma.sql`COALESCE(close_date, expiration_date) ASC NULLS LAST, "textRank" DESC, scheme_title ASC`
                : Prisma.sql`"textRank" DESC, COALESCE(close_date, expiration_date) ASC NULLS LAST, scheme_title ASC`
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
                ? Prisma.sql`COALESCE(close_date, expiration_date) ASC NULLS LAST, "updatedAt" DESC NULLS LAST, scheme_title ASC`
                : Prisma.sql`"updatedAt" DESC NULLS LAST, COALESCE(close_date, expiration_date) ASC NULLS LAST, scheme_title ASC`
            }
            LIMIT ${pageSize}
            OFFSET ${safeOffset}
          `
        );

    const results = rows.map((candidate) => {
      const score = hasQuery ? normalizeTextRank(candidate.textRank) : 0;
      const mapped = toPublicResult(candidate, score, normalized);
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
