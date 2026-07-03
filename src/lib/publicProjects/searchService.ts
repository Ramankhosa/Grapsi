import crypto from 'node:crypto'

import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { EmbeddingService } from '@/lib/services/embeddingService'
import { voyageRerankService } from '@/lib/services/voyageRerankService'

const embeddingService = new EmbeddingService()

const VECTOR_LIMIT = 60
const FULL_TEXT_LIMIT = 60
const MERGED_LIMIT = 100
const RERANK_LIMIT = 50
const RERANK_DISPLAY_THRESHOLD = 0.42
const SEMANTIC_DISPLAY_THRESHOLD = 0.28
const TEXT_RANK_DISPLAY_THRESHOLD = 0.025
const QUERY_EMBEDDING_TASK = 'RETRIEVAL_QUERY' as const
const QUERY_CACHE_PREFIX = 'public-project-query-v1'

export type PublicProjectSearchFilters = {
  sourceKeys?: string[]
  yearFrom?: number
  yearTo?: number
  states?: string[]
  schemes?: string[]
  institutions?: string[]
  budgetMin?: number
  budgetMax?: number
  disciplines?: string[]
}

export type PublicProjectSearchRequest = {
  query?: string
  filters?: PublicProjectSearchFilters
  limit?: number
  offset?: number
  sort?: PublicProjectSearchSort
  tenantId?: string | null
  userId?: string | null
}

export type PublicProjectSearchSort = 'relevance' | 'newest' | 'largest_budget'

export type PublicProjectSearchItem = {
  id: string
  sourceKey: string
  sourceName: string
  sourceUrl: string | null
  detailUrl: string | null
  title: string
  abstractText: string | null
  executiveSummary: string | null
  primaryInvestigatorName: string | null
  primaryInstitutionName: string | null
  schemeName: string | null
  programName: string | null
  sanctionYear: number | null
  state: string | null
  budgetAmount: number | null
  budgetCurrency: string | null
  discipline: string | null
  areaName: string | null
  keywords: string[]
  semanticSimilarity: number
  textRank: number
  relevanceScore: number
}

type CandidateRow = Omit<PublicProjectSearchItem, 'relevanceScore'> & {
  semanticSimilarity: number
  textRank: number
}

type FacetRow = { value: string | number; count: number }

export type PublicProjectFacets = {
  sources: FacetRow[]
  years: FacetRow[]
  states: FacetRow[]
  schemes: FacetRow[]
  institutions: FacetRow[]
  disciplines: FacetRow[]
}

export type PublicProjectSearchResponse = {
  query: string
  results: PublicProjectSearchItem[]
  totalResults: number
  approximateTotal: number
  sort: PublicProjectSearchSort
  degradedMode: 'full_text_only' | null
  facets: PublicProjectFacets
  diagnostics: {
    semanticCandidates: number
    keywordCandidates: number
    reranked: boolean
  }
}

function normalizeText(value: unknown, maxLength = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function clampLimit(value: number | undefined) {
  return Math.min(Math.max(Number(value) || 20, 1), 50)
}

function normalizeSort(value: unknown, hasQuery: boolean): PublicProjectSearchSort {
  const sort = String(value || '').trim()
  if (sort === 'newest' || sort === 'largest_budget') return sort
  return hasQuery ? 'relevance' : 'newest'
}

function noQueryOrderBy(sort: PublicProjectSearchSort) {
  if (sort === 'largest_budget') {
    return Prisma.sql`p.budget_amount DESC NULLS LAST, p.sanction_year DESC NULLS LAST, p.id ASC`
  }
  return Prisma.sql`p.sanction_year DESC NULLS LAST, p.updated_at DESC, p.id ASC`
}

function sortDisplayableCandidates(candidates: PublicProjectSearchItem[], sort: PublicProjectSearchSort) {
  if (sort === 'newest') {
    return [...candidates].sort((left, right) =>
      (right.sanctionYear || 0) - (left.sanctionYear || 0)
      || right.relevanceScore - left.relevanceScore
      || left.id.localeCompare(right.id)
    )
  }
  if (sort === 'largest_budget') {
    return [...candidates].sort((left, right) =>
      (right.budgetAmount || 0) - (left.budgetAmount || 0)
      || right.relevanceScore - left.relevanceScore
      || left.id.localeCompare(right.id)
    )
  }
  return candidates
}

function textArray(values: string[]) {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}`))}]::text[]`
}

function combineConditions(conditions: Prisma.Sql[]) {
  return conditions.reduce(
    (combined, condition, index) => index === 0 ? condition : Prisma.sql`${combined} AND ${condition}`,
    Prisma.sql`TRUE`
  )
}

function buildFilterConditions(filters: PublicProjectSearchFilters = {}) {
  const conditions: Prisma.Sql[] = [Prisma.sql`p.record_status = 'ACTIVE'::"PublicProjectRecordStatus"`]

  if (filters.sourceKeys?.length) {
    conditions.push(Prisma.sql`p.source_key::text = ANY(${textArray(filters.sourceKeys)})`)
  }
  if (Number.isFinite(filters.yearFrom)) {
    conditions.push(Prisma.sql`p.sanction_year >= ${Math.floor(filters.yearFrom!)}`)
  }
  if (Number.isFinite(filters.yearTo)) {
    conditions.push(Prisma.sql`p.sanction_year <= ${Math.floor(filters.yearTo!)}`)
  }
  if (filters.states?.length) {
    conditions.push(Prisma.sql`LOWER(COALESCE(p.state, '')) = ANY(${textArray(filters.states.map((value) => value.toLowerCase()))})`)
  }
  if (filters.schemes?.length) {
    conditions.push(Prisma.sql`LOWER(COALESCE(p.scheme_name, '')) = ANY(${textArray(filters.schemes.map((value) => value.toLowerCase()))})`)
  }
  if (filters.institutions?.length) {
    conditions.push(Prisma.sql`LOWER(COALESCE(p.primary_institution_name, '')) = ANY(${textArray(filters.institutions.map((value) => value.toLowerCase()))})`)
  }
  if (Number.isFinite(filters.budgetMin)) {
    conditions.push(Prisma.sql`p.budget_amount >= ${filters.budgetMin!}`)
  }
  if (Number.isFinite(filters.budgetMax)) {
    conditions.push(Prisma.sql`p.budget_amount <= ${filters.budgetMax!}`)
  }
  if (filters.disciplines?.length) {
    conditions.push(Prisma.sql`LOWER(COALESCE(p.discipline, '')) = ANY(${textArray(filters.disciplines.map((value) => value.toLowerCase()))})`)
  }

  return conditions
}

function selectColumns() {
  return Prisma.sql`
    p.id,
    p.source_key::text AS "sourceKey",
    s.name AS "sourceName",
    p.source_url AS "sourceUrl",
    p.detail_url AS "detailUrl",
    p.title,
    p.abstract AS "abstractText",
    p.executive_summary AS "executiveSummary",
    p.primary_investigator_name AS "primaryInvestigatorName",
    p.primary_institution_name AS "primaryInstitutionName",
    p.scheme_name AS "schemeName",
    p.program_name AS "programName",
    p.sanction_year AS "sanctionYear",
    p.state,
    p.budget_amount::float AS "budgetAmount",
    p.budget_currency AS "budgetCurrency",
    p.discipline,
    p.area_name AS "areaName",
    p.keywords
  `
}

function getEmbeddingIdentity() {
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK })
  const column = health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'embedding_voyage_1024'
    : 'embedding'

  return {
    ...health,
    column,
    version: `${QUERY_CACHE_PREFIX}:${health.provider}:${health.modelName}:${health.outputDimensionality}`,
  }
}

function normalizeCandidate(row: CandidateRow): CandidateRow {
  return {
    ...row,
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    budgetAmount: row.budgetAmount === null ? null : Number(row.budgetAmount),
    semanticSimilarity: Math.max(0, Math.min(1, Number(row.semanticSimilarity) || 0)),
    textRank: Math.max(0, Number(row.textRank) || 0),
  }
}

function candidateDocument(candidate: CandidateRow) {
  return [
    candidate.title,
    candidate.abstractText,
    candidate.executiveSummary,
    candidate.schemeName,
    candidate.programName,
    candidate.discipline,
    candidate.areaName,
    candidate.keywords.join(', '),
    candidate.primaryInstitutionName,
  ].filter(Boolean).join('\n').slice(0, 8000)
}

function fallbackScore(candidate: CandidateRow) {
  const normalizedTextRank = candidate.textRank <= 0 ? 0 : candidate.textRank / (candidate.textRank + 0.08)
  return Math.max(candidate.semanticSimilarity, normalizedTextRank)
}

export function isPublicProjectCandidateDisplayable(
  candidate: Pick<PublicProjectSearchItem, 'relevanceScore' | 'semanticSimilarity' | 'textRank'>,
  reranked: boolean
) {
  return reranked
    ? candidate.relevanceScore >= RERANK_DISPLAY_THRESHOLD
    : candidate.semanticSimilarity >= SEMANTIC_DISPLAY_THRESHOLD || candidate.textRank >= TEXT_RANK_DISPLAY_THRESHOLD
}

function serializeProject(project: any) {
  return {
    ...project,
    budgetAmount: project.budgetAmount === null || project.budgetAmount === undefined
      ? null
      : Number(project.budgetAmount),
  }
}

export class PublicProjectSearchService {
  private async loadQueryVector(query: string, context: Pick<PublicProjectSearchRequest, 'tenantId' | 'userId'>) {
    const identity = getEmbeddingIdentity()
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({
      query,
      model: identity.modelName,
      version: identity.version,
      task: QUERY_EMBEDDING_TASK,
    })).digest('hex')
    const columnSql = Prisma.raw(identity.column)

    try {
      const cached = await prisma.$queryRaw<Array<{ embedding: string }>>(Prisma.sql`
        SELECT ${columnSql}::text AS embedding
        FROM recommendation_query_embedding_cache
        WHERE request_hash = ${requestHash}
          AND model = ${identity.modelName}
          AND embedding_version = ${identity.version}
          AND task_type = ${QUERY_EMBEDDING_TASK}
          AND output_dimensionality = ${identity.outputDimensionality}
          AND ${columnSql} IS NOT NULL
        LIMIT 1
      `)
      if (cached[0]?.embedding) {
        void prisma.$executeRaw(Prisma.sql`
          UPDATE recommendation_query_embedding_cache
          SET hit_count = hit_count + 1, last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE request_hash = ${requestHash}
            AND model = ${identity.modelName}
            AND embedding_version = ${identity.version}
            AND task_type = ${QUERY_EMBEDDING_TASK}
            AND output_dimensionality = ${identity.outputDimensionality}
        `).catch(() => undefined)
        return { vector: cached[0].embedding, identity }
      }
    } catch {
      // A cache miss or stale local schema must not prevent search.
    }

    const generated = await embeddingService.generateEmbedding(
      query,
      {
        tenantId: context.tenantId || null,
        userId: context.userId || null,
        taskCode: 'FUNDING_CHAT',
        stageCode: 'PUBLIC_PROJECT_SEARCH_EMBEDDING',
        operation: 'public_project_search_embedding',
      },
      { taskType: QUERY_EMBEDDING_TASK, outputDimensionality: identity.outputDimensionality }
    )
    if (!generated.embedding.length) {
      return { vector: null, identity }
    }

    const vector = `[${generated.embedding.join(',')}]`
    const embeddingSql = Prisma.sql`CAST(${vector} AS vector)`
    const insertValues = identity.column === 'embedding_voyage_1024'
      ? Prisma.sql`NULL, ${embeddingSql}`
      : Prisma.sql`${embeddingSql}, NULL`
    const updateValue = identity.column === 'embedding_voyage_1024'
      ? Prisma.sql`embedding_voyage_1024 = EXCLUDED.embedding_voyage_1024`
      : Prisma.sql`embedding = EXCLUDED.embedding`

    void prisma.$executeRaw(Prisma.sql`
      INSERT INTO recommendation_query_embedding_cache (
        id, request_hash, input_mode, semantic_document, model, embedding_version,
        task_type, output_dimensionality, embedding, embedding_voyage_1024,
        hit_count, last_used_at, created_at, updated_at
      ) VALUES (
        ${crypto.randomUUID()}, ${requestHash}, 'research_area', ${query}, ${identity.modelName},
        ${identity.version}, ${QUERY_EMBEDDING_TASK}, ${identity.outputDimensionality},
        ${insertValues}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (request_hash, model, embedding_version, task_type, output_dimensionality)
      DO UPDATE SET ${updateValue}, hit_count = recommendation_query_embedding_cache.hit_count + 1,
        last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    `).catch(() => undefined)

    return { vector, identity }
  }

  private mergeCandidates(vectorRows: CandidateRow[], textRows: CandidateRow[]) {
    const merged = new Map<string, CandidateRow>()
    for (const row of [...vectorRows, ...textRows]) {
      const candidate = normalizeCandidate(row)
      const existing = merged.get(candidate.id)
      if (!existing) {
        merged.set(candidate.id, candidate)
      } else {
        merged.set(candidate.id, {
          ...existing,
          semanticSimilarity: Math.max(existing.semanticSimilarity, candidate.semanticSimilarity),
          textRank: Math.max(existing.textRank, candidate.textRank),
        })
      }
    }
    return [...merged.values()].sort((a, b) => fallbackScore(b) - fallbackScore(a)).slice(0, MERGED_LIMIT)
  }

  private async rerank(query: string, candidates: CandidateRow[]) {
    if (!voyageRerankService.isConfigured() || candidates.length < 2) {
      return { candidates: candidates.map((candidate) => ({ ...candidate, relevanceScore: fallbackScore(candidate) })), reranked: false }
    }

    const window = candidates.slice(0, RERANK_LIMIT)
    try {
      const rows = await voyageRerankService.rerank({
        query,
        documents: window.map(candidateDocument),
        topK: window.length,
      })
      if (!rows.length) throw new Error('Empty rerank result')

      const scores = new Map(rows.map((row) => [row.index, Math.max(0, Math.min(1, row.relevanceScore))]))
      const ordered = rows
        .filter((row) => row.index >= 0 && row.index < window.length)
        .map((row) => ({ ...window[row.index], relevanceScore: scores.get(row.index) || fallbackScore(window[row.index]) }))
      const seen = new Set(rows.map((row) => row.index))
      window.forEach((candidate, index) => {
        if (!seen.has(index)) ordered.push({ ...candidate, relevanceScore: fallbackScore(candidate) })
      })
      candidates.slice(RERANK_LIMIT).forEach((candidate) => ordered.push({ ...candidate, relevanceScore: fallbackScore(candidate) }))
      return { candidates: ordered, reranked: true }
    } catch (error) {
      console.warn('[PublicProjectSearch] Voyage rerank unavailable:', error instanceof Error ? error.message : error)
      return { candidates: candidates.map((candidate) => ({ ...candidate, relevanceScore: fallbackScore(candidate) })), reranked: false }
    }
  }

  async getFacets(filters: PublicProjectSearchFilters = {}): Promise<PublicProjectFacets> {
    const where = combineConditions(buildFilterConditions(filters))
    const rows = await prisma.$queryRaw<Array<{ dimension: string; value: string; count: number }>>(Prisma.sql`
      WITH filtered AS (
        SELECT p.* FROM public_projects p WHERE ${where}
      )
      SELECT 'source' AS dimension, source_key::text AS value, count(*)::int AS count FROM filtered GROUP BY source_key
      UNION ALL SELECT 'year', sanction_year::text, count(*)::int FROM filtered WHERE sanction_year IS NOT NULL GROUP BY sanction_year
      UNION ALL SELECT 'state', state, count(*)::int FROM filtered WHERE state IS NOT NULL AND btrim(state) <> '' GROUP BY state
      UNION ALL SELECT 'scheme', scheme_name, count(*)::int FROM filtered WHERE scheme_name IS NOT NULL AND btrim(scheme_name) <> '' GROUP BY scheme_name
      UNION ALL SELECT 'institution', primary_institution_name, count(*)::int FROM filtered WHERE primary_institution_name IS NOT NULL AND btrim(primary_institution_name) <> '' GROUP BY primary_institution_name
      UNION ALL SELECT 'discipline', discipline, count(*)::int FROM filtered WHERE discipline IS NOT NULL AND btrim(discipline) <> '' GROUP BY discipline
    `)

    const facet = (dimension: string, limit: number, numeric = false): FacetRow[] => rows
      .filter((row) => row.dimension === dimension)
      .map((row) => ({ value: numeric ? Number(row.value) : row.value, count: Number(row.count) }))
      .sort((a, b) => numeric ? Number(b.value) - Number(a.value) : b.count - a.count || String(a.value).localeCompare(String(b.value)))
      .slice(0, limit)

    return {
      sources: facet('source', 20),
      years: facet('year', 100, true),
      states: facet('state', 50),
      schemes: facet('scheme', 80),
      institutions: facet('institution', 80),
      disciplines: facet('discipline', 50),
    }
  }

  async search(request: PublicProjectSearchRequest): Promise<PublicProjectSearchResponse> {
    const query = normalizeText(request.query, 1200)
    const filters = request.filters || {}
    const limit = clampLimit(request.limit)
    const offset = Math.max(0, Number(request.offset) || 0)
    const sort = normalizeSort(request.sort, Boolean(query))
    const where = combineConditions(buildFilterConditions(filters))
    // Keep all options visible after a selection. Query-scoped, self-excluding
    // facet counts can be added once the corpus is large enough to justify them.
    const facetsPromise = this.getFacets()

    if (!query) {
      const [rows, countRows] = await Promise.all([
        prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT ${selectColumns()}, 0::float AS "semanticSimilarity", 0::float AS "textRank"
        FROM public_projects p
        JOIN public_project_sources s ON s.id = p.source_id
        WHERE ${where}
        ORDER BY ${noQueryOrderBy(sort)}
        OFFSET ${offset} LIMIT ${limit}
      `),
        prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          SELECT count(*)::int AS count
          FROM public_projects p
          WHERE ${where}
        `),
      ])
      const approximateTotal = Number(countRows[0]?.count || rows.length)
      return {
        query,
        results: rows.map((row) => ({ ...normalizeCandidate(row), relevanceScore: 0 })),
        totalResults: rows.length,
        approximateTotal,
        sort,
        degradedMode: null,
        facets: await facetsPromise,
        diagnostics: { semanticCandidates: 0, keywordCandidates: 0, reranked: false },
      }
    }

    const vectorPromise = (async () => {
      const { vector, identity } = await this.loadQueryVector(query, request)
      if (!vector) throw new Error('Embedding generation unavailable')
      const column = Prisma.raw(`p.${identity.column}`)
      return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT ${selectColumns()},
          (1 - (${column} <=> CAST(${vector} AS vector)))::float AS "semanticSimilarity",
          0::float AS "textRank"
        FROM public_projects p
        JOIN public_project_sources s ON s.id = p.source_id
        WHERE ${column} IS NOT NULL AND ${where}
        ORDER BY ${column} <=> CAST(${vector} AS vector)
        LIMIT ${VECTOR_LIMIT}
      `)
    })()

    const textPromise = prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT ${selectColumns()}, 0::float AS "semanticSimilarity",
        ts_rank_cd(p.ts_document, websearch_to_tsquery('english', ${query}))::float AS "textRank"
      FROM public_projects p
      JOIN public_project_sources s ON s.id = p.source_id
      WHERE p.ts_document @@ websearch_to_tsquery('english', ${query}) AND ${where}
      ORDER BY "textRank" DESC
      LIMIT ${FULL_TEXT_LIMIT}
    `)

    const [vectorResult, textResult] = await Promise.allSettled([vectorPromise, textPromise])
    if (vectorResult.status === 'rejected' && textResult.status === 'rejected') {
      throw new Error('Both semantic and keyword search are unavailable')
    }

    const vectorRows = vectorResult.status === 'fulfilled' ? vectorResult.value : []
    const textRows = textResult.status === 'fulfilled' ? textResult.value : []
    const merged = this.mergeCandidates(vectorRows, textRows)
    const reranked = await this.rerank(query, merged)
    const displayable = sortDisplayableCandidates(reranked.candidates.filter((candidate) =>
      isPublicProjectCandidateDisplayable(candidate, reranked.reranked)
    ), sort)
    const results = displayable.slice(offset, offset + limit)

    return {
      query,
      results,
      totalResults: results.length,
      approximateTotal: displayable.length,
      sort,
      degradedMode: vectorResult.status === 'rejected' ? 'full_text_only' : null,
      facets: await facetsPromise,
      diagnostics: {
        semanticCandidates: vectorRows.length,
        keywordCandidates: textRows.length,
        reranked: reranked.reranked,
      },
    }
  }

  async getProject(projectId: string) {
    const project = await prisma.publicProject.findFirst({
      where: { id: projectId, recordStatus: 'ACTIVE' },
      select: {
        id: true,
        sourceKey: true,
        externalId: true,
        fileNumber: true,
        projectNumber: true,
        sourceUrl: true,
        detailUrl: true,
        statusText: true,
        programName: true,
        schemeName: true,
        category: true,
        theme: true,
        discipline: true,
        areaName: true,
        subAreaName: true,
        title: true,
        abstractText: true,
        executiveSummary: true,
        objectivesText: true,
        milestonesText: true,
        deliverablesText: true,
        outputPlannedText: true,
        outputAchievedText: true,
        keywords: true,
        primaryInvestigatorName: true,
        primaryInstitutionName: true,
        departmentName: true,
        city: true,
        state: true,
        country: true,
        sanctionYear: true,
        startDate: true,
        endDate: true,
        durationMonths: true,
        budgetAmount: true,
        budgetCurrency: true,
        budgetComponents: true,
        publications: true,
        patents: true,
        outcomes: true,
        embeddingProvider: true,
        embeddingDimension: true,
        source: { select: { name: true, baseUrl: true } },
        participants: {
          select: {
            id: true, role: true, name: true, institutionName: true,
            departmentName: true, city: true, state: true, country: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    })
    return project ? serializeProject(project) : null
  }

  async findSimilar(projectId: string, limit = 10): Promise<PublicProjectSearchItem[]> {
    const project = await prisma.publicProject.findFirst({
      where: { id: projectId, recordStatus: 'ACTIVE' },
      select: { id: true, title: true, embeddingProvider: true, embeddingDimension: true },
    })
    if (!project) return []

    const columnName = project.embeddingProvider === 'voyage' && project.embeddingDimension === 1024
      ? 'embedding_voyage_1024'
      : 'embedding'
    const column = Prisma.raw(`p.${columnName}`)
    const sourceColumn = Prisma.raw(`source.${columnName}`)

    try {
      const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT ${selectColumns()},
          (1 - (${column} <=> ${sourceColumn}))::float AS "semanticSimilarity",
          0::float AS "textRank"
        FROM public_projects p
        JOIN public_project_sources s ON s.id = p.source_id
        JOIN public_projects source ON source.id = ${projectId}
        WHERE p.id <> ${projectId}
          AND p.record_status = 'ACTIVE'::"PublicProjectRecordStatus"
          AND ${column} IS NOT NULL AND ${sourceColumn} IS NOT NULL
        ORDER BY ${column} <=> ${sourceColumn}
        LIMIT ${Math.min(Math.max(limit, 1), 20)}
      `)
      return rows.map((row) => {
        const candidate = normalizeCandidate(row)
        return { ...candidate, relevanceScore: candidate.semanticSimilarity }
      })
    } catch {
      const fallback = await this.search({ query: project.title, limit: limit + 1 })
      return fallback.results.filter((item) => item.id !== projectId).slice(0, limit)
    }
  }
}

export const publicProjectSearchService = new PublicProjectSearchService()
