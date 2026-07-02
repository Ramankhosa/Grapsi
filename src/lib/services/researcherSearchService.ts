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

export interface ResearcherSearchFilters {
  countries?: string[];
  institutionTypes?: string[];
  careerStages?: string[];
  applicationLanguages?: string[];
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
  semanticSimilarity: number;
  textRank: number;
  matchedSources: string[];
  matchReason: string;
}

export interface ResearcherSearchResponse {
  query: string;
  fundingCallId: string | null;
  totalResults: number;
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
  source: string;
  semanticSimilarity: number;
  textRank: number;
};

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

  return combineConditions(conditions);
}

function profileCandidateColumns(source: string, matchedTextSql: Prisma.Sql, semanticSql: Prisma.Sql, textRankSql: Prisma.Sql) {
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

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
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

function buildMatchReason(result: ResearcherSearchResult) {
  if (result.matchedSources.includes('publication')) {
    return 'Matched through key publication text';
  }
  if (result.matchedSources.includes('research_area')) {
    return 'Matched through saved research area';
  }
  if (result.semanticSimilarity >= 0.5) {
    return 'Matched through profile semantic similarity';
  }
  if (result.textRank > 0) {
    return 'Matched through text search';
  }
  return 'Matched researcher profile';
}

function mergeCandidates(rows: ResearcherCandidateRow[], limit: number) {
  const merged = new Map<string, ResearcherSearchResult>();

  rows.forEach((row) => {
    const existing = merged.get(row.userId);
    const semanticSimilarity = clampScore(Number(row.semanticSimilarity || 0));
    const textRank = clampScore(Number(row.textRank || 0));
    const baseScore = Math.max(semanticSimilarity, textRank);

    if (!existing) {
      const result: ResearcherSearchResult = {
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
        semanticSimilarity,
        textRank,
        matchedSources: [row.source],
        matchReason: '',
      };
      result.matchReason = buildMatchReason(result);
      merged.set(row.userId, result);
      return;
    }

    existing.semanticSimilarity = Math.max(existing.semanticSimilarity, semanticSimilarity);
    existing.textRank = Math.max(existing.textRank, textRank);
    existing.score = Math.max(existing.score, baseScore);
    if (!existing.matchedSources.includes(row.source)) {
      existing.matchedSources.push(row.source);
    }
    existing.matchReason = buildMatchReason(existing);
  });

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
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
    return prisma.$queryRaw<ResearcherCandidateRow[]>(Prisma.sql`
      SELECT
        ${profileCandidateColumns(
          'profile',
          Prisma.sql`rp.normalized_text`,
          Prisma.sql`1 - (${profileEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector))`,
          Prisma.sql`0`
        )}
      FROM researcher_profiles rp
      JOIN users u ON u.id = rp.user_id
      WHERE ${profileEmbeddingColumnSql()} IS NOT NULL
        AND ${hardConditions}
      ORDER BY ${profileEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector) ASC
      LIMIT ${VECTOR_BRANCH_LIMIT}
    `);
  }

  private async searchSavedAreaVectors(queryVectorLiteral: string, hardConditions: Prisma.Sql) {
    return prisma.$queryRaw<ResearcherCandidateRow[]>(Prisma.sql`
      SELECT DISTINCT ON (u.id)
        ${profileCandidateColumns(
          'research_area',
          Prisma.sql`area.normalized_text`,
          Prisma.sql`1 - (area.${savedAreaEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector))`,
          Prisma.sql`0`
        )}
      FROM researcher_saved_research_areas area
      JOIN users u ON u.id = area.user_id
      JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE area.${savedAreaEmbeddingColumnSql()} IS NOT NULL
        AND area.use_for_alerts = true
        AND ${hardConditions}
      ORDER BY u.id, area.${savedAreaEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector) ASC
      LIMIT ${VECTOR_BRANCH_LIMIT}
    `);
  }

  private async searchPublicationVectors(queryVectorLiteral: string, hardConditions: Prisma.Sql) {
    return prisma.$queryRaw<ResearcherCandidateRow[]>(Prisma.sql`
      SELECT DISTINCT ON (u.id)
        ${profileCandidateColumns(
          'publication',
          Prisma.sql`ref.funding_match_text`,
          Prisma.sql`1 - (ref.${publicationEmbeddingColumnSql()} <=> CAST(${queryVectorLiteral} AS vector))`,
          Prisma.sql`0`
        )}
      FROM reference_library ref
      JOIN users u ON u.id = ref.user_id
      JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE ref.${publicationEmbeddingColumnSql()} IS NOT NULL
        AND ref."isActive" = true
        AND ${FUNDING_PUBLICATION_TAG} = ANY(ref.tags)
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
          Prisma.sql`rp.normalized_text`,
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

  private async rerank(query: string, results: ResearcherSearchResult[]) {
    if (!voyageRerankService.isConfigured() || results.length <= 1) {
      return results;
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
        return results;
      }

      const seen = new Set<number>();
      const ordered = reranked
        .filter((item) => item.index >= 0 && item.index < rerankWindow.length)
        .map((item) => {
          seen.add(item.index);
          const result = rerankWindow[item.index];
          return {
            ...result,
            score: Math.max(result.score, clampScore(item.relevanceScore)),
          };
        });

      rerankWindow.forEach((result, index) => {
        if (!seen.has(index)) {
          ordered.push(result);
        }
      });

      return [...ordered, ...remaining];
    } catch (error) {
      console.warn('Voyage researcher rerank failed; using first-stage researcher results.', error instanceof Error ? error.message : String(error));
      return results;
    }
  }

  async search(input: ResearcherSearchRequest): Promise<ResearcherSearchResponse> {
    const query = await this.resolveSearchText(input);
    const limit = Math.max(1, Math.min(Number(input.limit || 20), 50));
    const hardConditions = buildHardFilterConditions(input);
    const vectorLiteral = await this.buildQueryVectorLiteral(query);

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
    const reranked = await this.rerank(query, merged);
    const results = reranked.slice(0, limit).map((result) => ({
      ...result,
      score: Number(result.score.toFixed(4)),
      semanticSimilarity: Number(result.semanticSimilarity.toFixed(4)),
      textRank: Number(result.textRank.toFixed(4)),
    }));

    return {
      query,
      fundingCallId: input.fundingCallId || null,
      totalResults: results.length,
      results,
      degradedMode,
    };
  }
}

export const researcherSearchService = new ResearcherSearchService();
