import { Prisma } from '@prisma/client';

import prisma from '../prisma';
import {
  normalizeApplicationLanguageList,
  normalizeCareerStageList,
  normalizeCountryInput,
  normalizeCountryList,
  normalizeInstitutionTypeList,
  normalizeWhitespace,
} from '../recommendations/utils';
import { EmbeddingService } from './embeddingService';
import { voyageRerankService } from './voyageRerankService';

const embeddingService = new EmbeddingService();

const QUERY_EMBEDDING_TASK_TYPE = 'RETRIEVAL_QUERY' as const;
const VECTOR_BRANCH_LIMIT = 80;
const TEXT_BRANCH_LIMIT = 80;
const MERGED_LIMIT = 100;
const RERANK_LIMIT = 40;
const FUNDING_PUBLICATION_TAG = 'my-publication';
const EVIDENCE_SNIPPET_LENGTH = 280;
const SHARED_TERM_LIMIT = 8;

/**
 * Relevance gating.
 *
 * Vector kNN always returns the nearest rows no matter how far away they are,
 * so without gates every embedded researcher shows up in every search. Three
 * mechanisms keep only genuine matches:
 *  1. A minimum cosine-similarity floor inside each vector branch (cheap,
 *     coarse; calibrated per embedding provider since their scales differ).
 *  2. When the Voyage reranker is available, its relevance score replaces the
 *     retrieval score and results below RESEARCHER_MATCH_RERANK_GATE are
 *     dropped — rerank scores are far better calibrated than raw cosine.
 *  3. Without a reranker, results more than RESEARCHER_MATCH_VECTOR_GAP below
 *     the best score are dropped (cosine scores compress into a narrow band,
 *     so a relative gap works better than a second absolute threshold).
 */
const RERANK_GATE_DEFAULT = 0.35;
const RERANK_STRONG_TIER = 0.65;
const RERANK_MODERATE_TIER = 0.5;
const VECTOR_FLOOR_VOYAGE_DEFAULT = 0.3;
const VECTOR_FLOOR_DEFAULT = 0.45;
const VECTOR_GAP_DEFAULT = 0.15;
const VECTOR_GAP_STRONG_TIER = 0.04;
const VECTOR_GAP_MODERATE_TIER = 0.1;

const TS_HEADLINE_OPTIONS =
  'StartSel=**, StopSel=**, MaxWords=25, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "';

const SHARED_TERM_STOPWORDS = new Set([
  'about', 'across', 'analysis', 'application', 'applications', 'approach', 'approaches',
  'based', 'between', 'context', 'development', 'their', 'method', 'methods', 'model',
  'models', 'novel', 'research', 'science', 'studies', 'study', 'system', 'systems',
  'technique', 'techniques', 'technology', 'technologies', 'through', 'towards', 'using',
  'within',
]);

export type ResearcherMatchSource = 'profile' | 'research_area' | 'publication' | 'text';
export type ResearcherMatchTier = 'strong' | 'moderate' | 'weak';
export type ResearcherScoreBasis = 'rerank' | 'vector';

export interface ResearcherSearchFilters {
  countries?: string[];
  institutionTypes?: string[];
  careerStages?: string[];
  applicationLanguages?: string[];
  /** Department org-unit ids. A School selection expands to its departments. */
  orgUnitIds?: string[];
  /** Free-text discipline/topic terms matched against research areas + keywords. */
  researchAreas?: string[];
  /**
   * Keep candidates that fall below the relevance gate (still tiered). Lets an
   * admin explore weak matches when nothing strong exists.
   */
  includeBelowThreshold?: boolean;
  tenantOnly?: boolean;
  includeSelf?: boolean;
}

export interface ResearcherSearchRequest {
  query?: string | null;
  fundingCallId?: string | null;
  filters?: ResearcherSearchFilters | null;
  limit?: number | null;
  requesterUserId?: string | null;
  requesterTenantId?: string | null;
}

export interface ResearcherMatchEvidence {
  source: ResearcherMatchSource;
  /** Cosine similarity for vector sources; ts_rank for the text source. */
  similarity: number;
  /** Matched text excerpt. Text-branch snippets carry **term** highlights. */
  snippet: string | null;
  /** Publication title or saved research-area label, when the source has one. */
  title: string | null;
  /** Extra context, e.g. publication year and venue. */
  detail: string | null;
}

export interface ResearcherSearchResult {
  userId: string;
  displayName: string;
  countryOfResidence: string | null;
  institutionName: string | null;
  institutionType: string | null;
  department: string | null;
  careerStage: string | null;
  researchSummary: string | null;
  researchAreas: string[];
  keywords: string[];
  score: number;
  rerankScore: number | null;
  matchTier: ResearcherMatchTier;
  semanticSimilarity: number;
  textRank: number;
  matchedSources: string[];
  matchReason: string;
  evidence: ResearcherMatchEvidence[];
  sharedTerms: string[];
}

export interface ResearcherSearchResponse {
  query: string;
  fundingCallId: string | null;
  totalResults: number;
  /** Candidates retrieved before relevance gating — lets the UI say "screened N". */
  totalCandidates: number;
  scoreBasis: ResearcherScoreBasis;
  results: ResearcherSearchResult[];
  degradedMode: 'text_only' | null;
}

type ResearcherCandidateRow = {
  userId: string;
  displayName: string | null;
  countryOfResidence: string | null;
  institutionName: string | null;
  institutionType: string | null;
  department: string | null;
  careerStage: string | null;
  researchSummary: string | null;
  researchAreas: string[];
  keywords: string[];
  matchedText: string | null;
  matchedTitle: string | null;
  matchedDetail: string | null;
  source: string;
  semanticSimilarity: number;
  textRank: number;
};

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback;
}

function sqlLowerTextArray(values: string[]) {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value.toLowerCase()}`))}]::text[]`;
}

function combineConditions(conditions: Prisma.Sql[]) {
  return conditions.reduce((combined, condition, index) => {
    if (index === 0) {
      return condition;
    }
    return Prisma.sql`${combined} AND ${condition}`;
  }, Prisma.sql`TRUE`);
}

function normalizeFilterValues(values: string[] | null | undefined) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeWhitespace(value).toLowerCase())
        .filter(Boolean)
    )
  );
}

function buildArrayOverlapCondition(columnName: string, values: string[]) {
  const lowered = sqlLowerTextArray(values);
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM unnest(${Prisma.raw(columnName)}) AS value
      WHERE LOWER(value) = ANY(${lowered})
    )
  `;
}

/**
 * Substring variant of the overlap check. Discipline filters are typed or
 * picked as broad labels ("machine learning"), so they rarely equal a stored
 * tag exactly — match on containment instead.
 */
function buildArrayContainsCondition(columnName: string, values: string[]) {
  const patterns = Prisma.sql`ARRAY[${Prisma.join(
    values.map((value) => Prisma.sql`${`%${value}%`}`)
  )}]::text[]`;
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM unnest(${Prisma.raw(columnName)}) AS value
      WHERE LOWER(value) LIKE ANY(${patterns})
    )
  `;
}

function buildHardFilterConditions(input: ResearcherSearchRequest) {
  const filters = input.filters || {};
  const conditions: Prisma.Sql[] = [];

  if (!filters.includeSelf && input.requesterUserId) {
    conditions.push(Prisma.sql`rp.user_id <> ${input.requesterUserId}`);
  }

  if (filters.tenantOnly && input.requesterTenantId) {
    conditions.push(Prisma.sql`u."tenantId" = ${input.requesterTenantId}`);
  }

  const countries =
    normalizeCountryList(filters.countries || []) ||
    normalizeFilterValues(filters.countries).map((value) => normalizeCountryInput(value) || value);
  if (countries.length > 0) {
    conditions.push(Prisma.sql`LOWER(COALESCE(rp.country_of_residence, '')) = ANY(${sqlLowerTextArray(countries)})`);
  }

  const institutionTypes =
    normalizeInstitutionTypeList(filters.institutionTypes || []) || normalizeFilterValues(filters.institutionTypes);
  if (institutionTypes.length > 0) {
    conditions.push(Prisma.sql`LOWER(COALESCE(rp.institution_type, '')) = ANY(${sqlLowerTextArray(institutionTypes)})`);
  }

  const careerStages =
    normalizeCareerStageList(filters.careerStages || []) || normalizeFilterValues(filters.careerStages);
  if (careerStages.length > 0) {
    conditions.push(Prisma.sql`LOWER(COALESCE(rp.career_stage, '')) = ANY(${sqlLowerTextArray(careerStages)})`);
  }

  const applicationLanguages =
    normalizeApplicationLanguageList(filters.applicationLanguages || []) || normalizeFilterValues(filters.applicationLanguages);
  if (applicationLanguages.length > 0) {
    conditions.push(buildArrayOverlapCondition('rp.application_languages', applicationLanguages));
  }

  const orgUnitIds = Array.from(
    new Set((filters.orgUnitIds || []).map((value) => normalizeWhitespace(value)).filter(Boolean))
  );
  if (orgUnitIds.length > 0) {
    conditions.push(
      Prisma.sql`rp.org_unit_id = ANY(ARRAY[${Prisma.join(
        orgUnitIds.map((value) => Prisma.sql`${value}`)
      )}]::text[])`
    );
  }

  const researchAreas = normalizeFilterValues(filters.researchAreas);
  if (researchAreas.length > 0) {
    conditions.push(Prisma.sql`(
      ${buildArrayContainsCondition('rp.research_areas', researchAreas)}
      OR ${buildArrayContainsCondition('rp.keywords', researchAreas)}
    )`);
  }

  return combineConditions(conditions);
}

function profileCandidateColumns(
  source: string,
  matchedTextSql: Prisma.Sql,
  semanticSql: Prisma.Sql,
  textRankSql: Prisma.Sql,
  matchedTitleSql: Prisma.Sql = Prisma.sql`NULL::text`,
  matchedDetailSql: Prisma.Sql = Prisma.sql`NULL::text`
) {
  return Prisma.sql`
    u.id AS "userId",
    COALESCE(rp.display_name, u.name, 'Researcher') AS "displayName",
    rp.country_of_residence AS "countryOfResidence",
    rp.institution_name AS "institutionName",
    rp.institution_type AS "institutionType",
    rp.department,
    rp.career_stage AS "careerStage",
    rp.research_summary AS "researchSummary",
    COALESCE(rp.research_areas, ARRAY[]::text[]) AS "researchAreas",
    COALESCE(rp.keywords, ARRAY[]::text[]) AS keywords,
    ${matchedTextSql} AS "matchedText",
    ${matchedTitleSql} AS "matchedTitle",
    ${matchedDetailSql} AS "matchedDetail",
    ${source}::text AS source,
    ${semanticSql}::float AS "semanticSimilarity",
    ${textRankSql}::float AS "textRank"
  `;
}

function vectorLiteralFromEmbedding(embedding: number[]) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }
  if (embedding.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return `[${embedding.join(',')}]`;
}

function getProfileEmbeddingColumn() {
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE });
  return health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'embedding_voyage_1024'
    : 'embedding';
}

function getPublicationEmbeddingColumn() {
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE });
  return health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'funding_embedding_voyage_1024'
    : 'funding_embedding';
}

function profileEmbeddingColumnSql() {
  return Prisma.raw(getProfileEmbeddingColumn());
}

function savedAreaEmbeddingColumnSql() {
  return Prisma.raw(getProfileEmbeddingColumn());
}

function publicationEmbeddingColumnSql() {
  return Prisma.raw(getPublicationEmbeddingColumn());
}

/** Minimum cosine similarity a vector candidate must reach. Provider scales differ. */
function getVectorSimilarityFloor() {
  const override = Number(process.env.RESEARCHER_MATCH_MIN_SIMILARITY);
  if (Number.isFinite(override) && override > 0 && override < 1) {
    return override;
  }
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE });
  return health.provider === 'voyage' ? VECTOR_FLOOR_VOYAGE_DEFAULT : VECTOR_FLOOR_DEFAULT;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function roundScore(value: number) {
  return Number(value.toFixed(4));
}

function truncateSnippet(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value || '');
  if (!normalized) {
    return null;
  }
  if (normalized.length <= EVIDENCE_SNIPPET_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, EVIDENCE_SNIPPET_LENGTH).trimEnd()}…`;
}

function evidenceFromRow(
  row: ResearcherCandidateRow,
  semanticSimilarity: number,
  textRank: number
): ResearcherMatchEvidence {
  return {
    source: row.source as ResearcherMatchSource,
    similarity: row.source === 'text' ? textRank : semanticSimilarity,
    snippet: truncateSnippet(row.matchedText),
    title: normalizeWhitespace(row.matchedTitle || '') || null,
    detail: normalizeWhitespace(row.matchedDetail || '') || null,
  };
}

/** Semantic evidence first (strongest similarity on top), lexical evidence last. */
function sortEvidence(evidence: ResearcherMatchEvidence[]) {
  return [...evidence].sort((left, right) => {
    const leftText = left.source === 'text' ? 1 : 0;
    const rightText = right.source === 'text' ? 1 : 0;
    if (leftText !== rightText) {
      return leftText - rightText;
    }
    return right.similarity - left.similarity;
  });
}

function buildMatchReason(result: ResearcherSearchResult) {
  const top = result.evidence[0];
  if (!top) {
    return 'Matched researcher profile';
  }
  switch (top.source) {
    case 'publication':
      return top.title
        ? `Strongest signal: publication "${top.title}"`
        : 'Strongest signal: a key publication';
    case 'research_area':
      return top.title
        ? `Strongest signal: saved research area "${top.title}"`
        : 'Strongest signal: a saved research area';
    case 'text':
      return 'Strongest signal: keyword/text match';
    default:
      return 'Strongest signal: overall profile similarity';
  }
}

/** Researcher keywords/areas that overlap the query — cheap, fully explainable chips. */
function extractSharedTerms(query: string, phrases: string[]) {
  const queryLower = query.toLowerCase();
  const queryWords = new Set(
    queryLower
      .split(/[^a-z0-9+#-]+/)
      .filter((word) => word.length >= 5 && !SHARED_TERM_STOPWORDS.has(word))
  );

  const shared: string[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    const label = normalizeWhitespace(phrase);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) {
      continue;
    }
    const words = key
      .split(/[^a-z0-9+#-]+/)
      .filter((word) => word.length >= 5 && !SHARED_TERM_STOPWORDS.has(word));
    const matches =
      (key.length >= 4 && queryLower.includes(key)) ||
      words.some((word) => queryWords.has(word));
    if (matches) {
      seen.add(key);
      shared.push(label);
      if (shared.length >= SHARED_TERM_LIMIT) {
        break;
      }
    }
  }
  return shared;
}

function mergeCandidates(rows: ResearcherCandidateRow[], limit: number) {
  const merged = new Map<string, ResearcherSearchResult>();

  rows.forEach((row) => {
    const semanticSimilarity = clampScore(Number(row.semanticSimilarity || 0));
    const textRank = clampScore(Number(row.textRank || 0));
    const baseScore = Math.max(semanticSimilarity, textRank);
    const evidence = evidenceFromRow(row, semanticSimilarity, textRank);

    const existing = merged.get(row.userId);
    if (!existing) {
      merged.set(row.userId, {
        userId: row.userId,
        displayName: normalizeWhitespace(row.displayName || '') || 'Researcher',
        countryOfResidence: normalizeWhitespace(row.countryOfResidence || '') || null,
        institutionName: normalizeWhitespace(row.institutionName || '') || null,
        institutionType: normalizeWhitespace(row.institutionType || '') || null,
        department: normalizeWhitespace(row.department || '') || null,
        careerStage: normalizeWhitespace(row.careerStage || '') || null,
        researchSummary: normalizeWhitespace(row.researchSummary || '') || null,
        researchAreas: row.researchAreas || [],
        keywords: row.keywords || [],
        score: baseScore,
        rerankScore: null,
        matchTier: 'weak',
        semanticSimilarity,
        textRank,
        matchedSources: [row.source],
        matchReason: '',
        evidence: [evidence],
        sharedTerms: [],
      });
      return;
    }

    existing.semanticSimilarity = Math.max(existing.semanticSimilarity, semanticSimilarity);
    existing.textRank = Math.max(existing.textRank, textRank);
    existing.score = Math.max(existing.score, baseScore);
    if (!existing.matchedSources.includes(row.source)) {
      existing.matchedSources.push(row.source);
    }
    const priorIndex = existing.evidence.findIndex((entry) => entry.source === evidence.source);
    if (priorIndex === -1) {
      existing.evidence.push(evidence);
    } else if (evidence.similarity > existing.evidence[priorIndex].similarity) {
      existing.evidence[priorIndex] = evidence;
    }
  });

  return Array.from(merged.values())
    .map((result) => {
      result.evidence = sortEvidence(result.evidence);
      result.matchReason = buildMatchReason(result);
      return result;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

/**
 * Drop candidates that only made the list because kNN had nothing closer, and
 * assign display tiers. With rerank scores the gate is absolute (they are well
 * calibrated); with raw vector scores it is relative to the best result.
 */
function applyRelevanceGate(
  results: ResearcherSearchResult[],
  basis: ResearcherScoreBasis,
  relax = false
): ResearcherSearchResult[] {
  if (results.length === 0) {
    return results;
  }

  if (basis === 'rerank') {
    const gate = envNumber('RESEARCHER_MATCH_RERANK_GATE', RERANK_GATE_DEFAULT);
    return results
      .filter((result) => relax || (result.rerankScore !== null && result.rerankScore >= gate))
      .map((result) => {
        // Relaxed searches can include rows past the rerank window, which have
        // no rerank score — treat those as weak rather than crashing.
        const rerankScore = result.rerankScore ?? 0;
        const matchTier: ResearcherMatchTier =
          rerankScore >= RERANK_STRONG_TIER
            ? 'strong'
            : rerankScore >= RERANK_MODERATE_TIER
              ? 'moderate'
              : 'weak';
        return { ...result, matchTier };
      });
  }

  const gap = envNumber('RESEARCHER_MATCH_VECTOR_GAP', VECTOR_GAP_DEFAULT);
  const topScore = results[0].score;
  return results
    .filter((result) => relax || result.score >= topScore - gap)
    .map((result) => {
      const matchTier: ResearcherMatchTier =
        result.score >= topScore - VECTOR_GAP_STRONG_TIER
          ? 'strong'
          : result.score >= topScore - VECTOR_GAP_MODERATE_TIER
            ? 'moderate'
            : 'weak';
      return { ...result, matchTier };
    });
}

function buildRerankDocument(result: ResearcherSearchResult) {
  return normalizeWhitespace([
    result.displayName ? `Researcher: ${result.displayName}` : '',
    result.researchSummary ? `Summary: ${result.researchSummary}` : '',
    result.researchAreas.length ? `Research areas: ${result.researchAreas.join(', ')}` : '',
    result.keywords.length ? `Keywords: ${result.keywords.join(', ')}` : '',
    result.department ? `Department: ${result.department}` : '',
    result.institutionName ? `Institution: ${result.institutionName}` : '',
    result.careerStage ? `Career stage: ${result.careerStage}` : '',
  ].filter(Boolean).join('\n')).slice(0, 5000);
}

async function buildFundingCallQuery(fundingCallId: string) {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    title: string | null;
    agencyName: string | null;
    schemeTitle: string | null;
    description: string | null;
    eligibilityText: string | null;
    disciplines: string[];
    fundingKinds: string[];
  }>>(Prisma.sql`
    SELECT
      id,
      title,
      agency_name AS "agencyName",
      scheme_title AS "schemeTitle",
      description,
      eligibility_text AS "eligibilityText",
      COALESCE(disciplines, ARRAY[]::text[]) AS disciplines,
      COALESCE(funding_kinds, ARRAY[]::text[]) AS "fundingKinds"
    FROM funding_calls
    WHERE id = ${fundingCallId}
    LIMIT 1
  `);

  const call = rows[0];
  if (!call) {
    throw new Error('Funding call not found');
  }

  return normalizeWhitespace([
    call.schemeTitle || call.title || '',
    call.agencyName ? `agency: ${call.agencyName}` : '',
    call.description || '',
    call.disciplines.length ? `research areas: ${call.disciplines.join(', ')}` : '',
    call.fundingKinds.length ? `funding types: ${call.fundingKinds.join(', ')}` : '',
    call.eligibilityText ? `eligibility context: ${call.eligibilityText}` : '',
  ].filter(Boolean).join(' | '));
}

export class ResearcherSearchService {
  private async resolveSearchText(input: ResearcherSearchRequest) {
    const directQuery = normalizeWhitespace(input.query || '');
    if (directQuery) {
      return directQuery;
    }
    if (input.fundingCallId) {
      return buildFundingCallQuery(input.fundingCallId);
    }
    throw new Error('A query or fundingCallId is required');
  }

  private async buildQueryVectorLiteral(query: string) {
    const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE });
    const response = await embeddingService.generateEmbedding(query, undefined, {
      taskType: QUERY_EMBEDDING_TASK_TYPE,
      outputDimensionality: health.outputDimensionality,
    });
    return vectorLiteralFromEmbedding(response.embedding);
  }

  private async searchProfileVectors(queryVectorLiteral: string, hardConditions: Prisma.Sql) {
    const floor = getVectorSimilarityFloor();
    return prisma.$queryRaw<ResearcherCandidateRow[]>(Prisma.sql`
      SELECT
        ${profileCandidateColumns(
          'profile',
          // The card already displays the research summary, so the profile
          // branch carries no separate snippet.
          Prisma.sql`NULL::text`,
          Prisma.sql`1 - (${profileEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector))`,
          Prisma.sql`0`
        )}
      FROM researcher_profiles rp
      JOIN users u ON u.id = rp.user_id
      WHERE ${profileEmbeddingColumnSql()} IS NOT NULL
        AND 1 - (${profileEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector)) >= ${floor}
        AND ${hardConditions}
      ORDER BY ${profileEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector) ASC
      LIMIT ${VECTOR_BRANCH_LIMIT}
    `);
  }

  private async searchSavedAreaVectors(queryVectorLiteral: string, hardConditions: Prisma.Sql) {
    const floor = getVectorSimilarityFloor();
    return prisma.$queryRaw<ResearcherCandidateRow[]>(Prisma.sql`
      SELECT DISTINCT ON (u.id)
        ${profileCandidateColumns(
          'research_area',
          Prisma.sql`area.normalized_text`,
          Prisma.sql`1 - (area.${savedAreaEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector))`,
          Prisma.sql`0`,
          Prisma.sql`area.label`
        )}
      FROM researcher_saved_research_areas area
      JOIN users u ON u.id = area.user_id
      JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE area.${savedAreaEmbeddingColumnSql()} IS NOT NULL
        AND area.use_for_alerts = true
        AND 1 - (area.${savedAreaEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector)) >= ${floor}
        AND ${hardConditions}
      ORDER BY u.id, area.${savedAreaEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector) ASC
      LIMIT ${VECTOR_BRANCH_LIMIT}
    `);
  }

  private async searchPublicationVectors(queryVectorLiteral: string, hardConditions: Prisma.Sql) {
    const floor = getVectorSimilarityFloor();
    return prisma.$queryRaw<ResearcherCandidateRow[]>(Prisma.sql`
      SELECT DISTINCT ON (u.id)
        ${profileCandidateColumns(
          'publication',
          Prisma.sql`ref.funding_match_text`,
          Prisma.sql`1 - (ref.${publicationEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector))`,
          Prisma.sql`0`,
          Prisma.sql`ref.title`,
          Prisma.sql`NULLIF(CONCAT_WS(' · ', ref.year::text, ref.venue), '')`
        )}
      FROM reference_library ref
      JOIN users u ON u.id = ref.user_id
      JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE ref.${publicationEmbeddingColumnSql()} IS NOT NULL
        AND ref."isActive" = true
        AND ${FUNDING_PUBLICATION_TAG} = ANY(ref.tags)
        AND 1 - (ref.${publicationEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector)) >= ${floor}
        AND ${hardConditions}
      ORDER BY u.id, ref.${publicationEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector) ASC
      LIMIT ${VECTOR_BRANCH_LIMIT}
    `);
  }

  private async searchText(query: string, hardConditions: Prisma.Sql) {
    return prisma.$queryRaw<ResearcherCandidateRow[]>(Prisma.sql`
      SELECT
        ${profileCandidateColumns(
          'text',
          Prisma.sql`ts_headline(
            'english',
            CONCAT_WS(
              ' ',
              rp.research_summary,
              array_to_string(rp.research_areas, ' '),
              array_to_string(rp.keywords, ' ')
            ),
            websearch_to_tsquery('english', ${query}),
            ${TS_HEADLINE_OPTIONS}
          )`,
          Prisma.sql`0`,
          Prisma.sql`ts_rank_cd(
            to_tsvector(
              'english',
              CONCAT_WS(
                ' ',
                rp.normalized_text,
                rp.research_summary,
                array_to_string(rp.research_areas, ' '),
                array_to_string(rp.keywords, ' ')
              )
            ),
            websearch_to_tsquery('english', ${query})
          )`
        )}
      FROM researcher_profiles rp
      JOIN users u ON u.id = rp.user_id
      WHERE to_tsvector(
          'english',
          CONCAT_WS(
            ' ',
            rp.normalized_text,
            rp.research_summary,
            array_to_string(rp.research_areas, ' '),
            array_to_string(rp.keywords, ' ')
          )
        ) @@ websearch_to_tsquery('english', ${query})
        AND ${hardConditions}
      ORDER BY "textRank" DESC
      LIMIT ${TEXT_BRANCH_LIMIT}
    `);
  }

  private async rerank(
    query: string,
    results: ResearcherSearchResult[]
  ): Promise<{ ranked: ResearcherSearchResult[]; basis: ResearcherScoreBasis }> {
    if (!voyageRerankService.isConfigured() || results.length <= 1) {
      return { ranked: results, basis: 'vector' };
    }

    const rerankWindow = results.slice(0, RERANK_LIMIT);
    const remaining = results.slice(RERANK_LIMIT);

    try {
      const reranked = await voyageRerankService.rerank({
        query,
        documents: rerankWindow.map(buildRerankDocument),
        topK: rerankWindow.length,
      });
      if (reranked.length === 0) {
        return { ranked: results, basis: 'vector' };
      }

      const seen = new Set<number>();
      const ordered: ResearcherSearchResult[] = reranked
        .filter((item) => item.index >= 0 && item.index < rerankWindow.length)
        .map((item) => {
          seen.add(item.index);
          const result = rerankWindow[item.index];
          const rerankScore = clampScore(item.relevanceScore);
          // The reranker is far better calibrated than raw cosine similarity,
          // so its relevance score replaces the retrieval score outright.
          return { ...result, rerankScore, score: rerankScore };
        })
        .sort((left, right) => right.score - left.score);

      rerankWindow.forEach((result, index) => {
        if (!seen.has(index)) {
          ordered.push(result);
        }
      });

      return { ranked: [...ordered, ...remaining], basis: 'rerank' };
    } catch (error) {
      console.warn('Voyage researcher rerank failed; using first-stage researcher results.', error instanceof Error ? error.message : String(error));
      return { ranked: results, basis: 'vector' };
    }
  }

  async search(input: ResearcherSearchRequest): Promise<ResearcherSearchResponse> {
    const query = await this.resolveSearchText(input);
    const limit = Math.max(1, Math.min(Number(input.limit || 20), 50));
    const hardConditions = buildHardFilterConditions(input);
    const vectorLiteral = await this.buildQueryVectorLiteral(query).catch(() => null);

    const vectorBranches = vectorLiteral
      ? await Promise.allSettled([
          this.searchProfileVectors(vectorLiteral, hardConditions),
          this.searchSavedAreaVectors(vectorLiteral, hardConditions),
          this.searchPublicationVectors(vectorLiteral, hardConditions),
        ])
      : [];

    const vectorRows = vectorBranches.flatMap((branch) => branch.status === 'fulfilled' ? branch.value : []);
    const degradedMode = vectorLiteral && vectorBranches.every((branch) => branch.status === 'rejected')
      ? 'text_only'
      : vectorLiteral
        ? null
        : 'text_only';
    const textRows = await this.searchText(query, hardConditions).catch(() => []);
    const merged = mergeCandidates([...vectorRows, ...textRows], MERGED_LIMIT);
    const { ranked, basis } = await this.rerank(query, merged);
    const gated = applyRelevanceGate(ranked, basis, Boolean(input.filters?.includeBelowThreshold));
    const results = gated.slice(0, limit).map((result) => ({
      ...result,
      sharedTerms: extractSharedTerms(query, [...result.keywords, ...result.researchAreas]),
      score: roundScore(result.score),
      rerankScore: result.rerankScore === null ? null : roundScore(result.rerankScore),
      semanticSimilarity: roundScore(result.semanticSimilarity),
      textRank: roundScore(result.textRank),
      evidence: result.evidence.map((entry) => ({
        ...entry,
        similarity: roundScore(entry.similarity),
      })),
    }));

    return {
      query,
      fundingCallId: input.fundingCallId || null,
      totalResults: results.length,
      totalCandidates: merged.length,
      scoreBasis: basis,
      results,
      degradedMode,
    };
  }
}

export const researcherSearchService = new ResearcherSearchService();
