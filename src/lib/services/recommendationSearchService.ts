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
  RecommendationProfileMatch,
  RecommendationProfileSnapshot,
  RecommendationPublicationSnapshot,
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

function normalizeTopicToken(token: string) {
  const normalized = normalizeKey(token);
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

function tokenizeTopicText(input: string, maxTokens = 40) {
  const tokens = normalizeKey(input)
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
  profileMatch: RecommendationProfileMatch | null = null
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

function sortCandidates<T extends { candidate: RecommendationCandidate; score: number }>(
  candidates: T[],
  normalized: NormalizedRecommendationSearchRequest
): T[] {
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
      normalized
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

    let rawResults = filteredScored.map(({ candidate, score, profileMatch }) =>
      toPublicResult(candidate, score, normalized, profileMatch)
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
        results: rawResults.map(({ fullDescription, description, amountMin, amountMax, currency, eligibilityText, contactInfo, geographyScope, funderCountry, citizenshipRequirements, residencyRequirements, applicationLanguages, semanticSimilarity, textRank, ...publicFields }) => publicFields),
        rawResults,
        totalResults: rawResults.length,
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

    const rows = await prisma.$queryRaw<RecommendationCandidate[]>(
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

    const scoredRows = rows.map((candidate) => {
      const profileMatch = buildProfileMatch(candidate, profileContext);
      const score = hasQuery || profileMatch ? scoreCandidate(candidate, normalized, profileMatch) : 0;
      return { candidate, score, profileMatch };
    });
    const orderedRows = normalized.filters.sort === 'best_match'
      ? sortCandidates(scoredRows, normalized)
      : scoredRows;
    const results = orderedRows.map(({ candidate, score, profileMatch }) => {
      const mapped = toPublicResult(candidate, score, normalized, profileMatch);
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
