/**
 * "Funding in my areas" — the calls that match a researcher, found the cheap way.
 *
 * The finder chatbot can already answer this, but it costs an LLM turn and a
 * quota unit and it asks the researcher to describe work the system already
 * knows about. Meanwhile the alert dispatcher does exactly this comparison for
 * every published call, in the opposite direction, and keeps the answer only as
 * a notification.
 *
 * So this runs the same comparison the other way round, against material the
 * researcher already has: **no LLM call, no embedding call, no quota spend**.
 * That is what makes it a button rather than a conversation.
 *
 * Two kinds of evidence, merged, so the page is useful whatever state the
 * corpus is in:
 *
 *   vector  the researcher's stored embeddings against the calls' stored
 *           embeddings — the same signal the alert service matches on, and the
 *           better one when both sides are indexed by the same provider
 *   terms   the researcher's own words (saved area labels, profile research
 *           areas and keywords) against the call's full-text document
 *
 * The terms branch is not a consolation prize. Call embeddings lag behind
 * whenever the embedding provider changes — the corpus has to be re-indexed,
 * and until it is, every vector branch in the product silently returns nothing.
 * A researcher pressing this button during that window should still get their
 * calls.
 */

import { EmbeddingService } from '@/lib/services/embeddingService'
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

const embeddingService = new EmbeddingService()
const QUERY_EMBEDDING_TASK_TYPE = 'RETRIEVAL_QUERY' as const

/** Papers a researcher tagged as their own; the same tag researcher matching uses. */
const FUNDING_PUBLICATION_TAG = 'my-publication'

/**
 * Gating, mirroring `researcherSearchService`.
 *
 * A vector search always returns its nearest neighbours however far away they
 * are, so without a floor every researcher matches every call. The floor is
 * absolute and provider-calibrated; the tier is relative to the best match in
 * this researcher's own results, because cosine scores compress into a narrow
 * band and a second absolute threshold reads as noise.
 */
const VECTOR_FLOOR_VOYAGE_DEFAULT = 0.3
const VECTOR_FLOOR_DEFAULT = 0.45
const TIER_STRONG_GAP = 0.04
const TIER_MODERATE_GAP = 0.1

/**
 * Text-rank tiering.
 *
 * `ts_rank_cd` is unbounded and its scale depends on how many terms the
 * researcher has, so an absolute threshold alone mislabels everyone. The tier
 * is therefore a share of this researcher's own best hit — but with an absolute
 * floor as well, because a ratio alone would crown the single weak match in an
 * otherwise empty tab as "strong".
 */
const TERMS_STRONG_RATIO = 0.5
const TERMS_MODERATE_RATIO = 0.2
const TERMS_STRONG_MIN = 0.5
const TERMS_MODERATE_MIN = 0.15

const PER_SOURCE_LIMIT = 120
const MAX_TERMS = 24
export const MY_AREAS_DEFAULT_LIMIT = 60
export const MY_AREAS_MAX_LIMIT = 200

export type MyAreasStatus = 'active' | 'expired' | 'all'
export type MyAreasSource = 'profile' | 'research_area' | 'publication' | 'terms'
export type MyAreasBasis = 'vector' | 'terms'
export type MyAreasTier = 'strong' | 'moderate' | 'weak'

export interface MyAreasCall {
  id: string
  title: string | null
  agencyName: string | null
  summary: string | null
  disciplines: string[]
  closesAt: Date | null
  publishedAt: Date | null
  /** Negative once the date has passed; null for a rolling call. */
  daysToClose: number | null
  isExpired: boolean
  score: number
  tier: MyAreasTier
  basis: MyAreasBasis
  /** Which of the researcher's own material matched. */
  source: MyAreasSource
  /** The saved area, paper or term behind the match, for "why am I seeing this?". */
  matchedOn: string | null
  /** Already alerted about this one, so the list and the inbox agree. */
  alerted: boolean
}

export interface MyAreasReadiness {
  hasProfileVector: boolean
  savedAreas: number
  taggedPublications: number
  /** Terms drawn from the researcher's own profile, used by the text branch. */
  terms: number
  /** Nothing at all to match on: the profile needs filling in first. */
  isUnprofiled: boolean
  /**
   * True when the call catalog carries no embeddings for the current provider,
   * so only the terms branch can run. Surfaced rather than hidden: it is an
   * operational gap (the corpus needs re-indexing), not a property of this
   * researcher, and it silently weakens every vector search in the product.
   */
  callVectorsMissing: boolean
}

export interface MyAreasResult {
  calls: MyAreasCall[]
  counts: { active: number; expired: number; total: number }
  readiness: MyAreasReadiness
}

interface CandidateRow {
  id: string
  title: string | null
  agency_name: string | null
  summary: string | null
  disciplines: string[] | null
  closes_at: Date | null
  published_at: Date | null
  score: number
  source: MyAreasSource
  matched_on: string | null
}

function callEmbeddingColumn() {
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE })
  return health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'embedding_voyage_1024'
    : 'embedding'
}

/** The researcher-side column pairs with the call-side one: same provider, same dimensions. */
function profileEmbeddingColumn() {
  return callEmbeddingColumn()
}

function publicationEmbeddingColumn() {
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE })
  return health.provider === 'voyage' && health.outputDimensionality === 1024
    ? 'funding_embedding_voyage_1024'
    : 'funding_embedding'
}

function vectorFloor() {
  const override = Number(process.env.RESEARCHER_MATCH_MIN_SIMILARITY)
  if (Number.isFinite(override) && override > 0 && override < 1) return override
  const health = embeddingService.getHealth({ taskType: QUERY_EMBEDDING_TASK_TYPE })
  return health.provider === 'voyage' ? VECTOR_FLOOR_VOYAGE_DEFAULT : VECTOR_FLOOR_DEFAULT
}

/**
 * Which calls this viewer may see, in SQL.
 *
 * Deliberately the same rule as `visibleFundingCallWhere` — global published
 * calls, plus this tenant's own published ones. Vector and tsvector operators
 * need raw SQL, so the predicate is restated rather than reused; keep the two
 * in step. `is_active` is "not explicitly deactivated": legacy rows carry NULL.
 */
function visibleCallSql(tenantId: string | null): Prisma.Sql {
  const published = Prisma.sql`
    (fc.status = 'PUBLISHED' OR fc.catalog_status = 'PUBLISHED')
    AND (fc.is_active IS NULL OR fc.is_active = true)
  `
  if (!tenantId) {
    return Prisma.sql`(fc.visibility = 'GLOBAL_PUBLISHED' AND ${published})`
  }
  return Prisma.sql`(
    (fc.visibility = 'GLOBAL_PUBLISHED' AND ${published})
    OR (fc.visibility = 'TENANT_PRIVATE' AND fc."tenantId" = ${tenantId} AND ${published})
  )`
}

/**
 * Open or closed.
 *
 * A call with no date is rolling, and therefore always open — never expired.
 * That asymmetry matters: dropping undated calls from "open now" would hide the
 * standing schemes researchers apply to most often.
 */
function statusSql(status: MyAreasStatus): Prisma.Sql {
  const closesAt = Prisma.sql`COALESCE(fc.close_date, fc."deadlineAt")`
  if (status === 'active') {
    return Prisma.sql`(${closesAt} IS NULL OR ${closesAt} >= now())`
  }
  if (status === 'expired') {
    return Prisma.sql`(${closesAt} IS NOT NULL AND ${closesAt} < now())`
  }
  return Prisma.sql`TRUE`
}

function candidateColumns(source: MyAreasSource, score: Prisma.Sql, matchedOn: Prisma.Sql) {
  return Prisma.sql`
    fc.id,
    COALESCE(fc.scheme_title, fc.title)        AS title,
    COALESCE(fc.agency_name, fc."agencyName")  AS agency_name,
    COALESCE(fc.summary, fc.description)       AS summary,
    fc.disciplines                             AS disciplines,
    COALESCE(fc.close_date, fc."deadlineAt")   AS closes_at,
    COALESCE(fc."publishedAt", fc."createdAt") AS published_at,
    (${score})::float                          AS score,
    ${source}::text                            AS source,
    ${matchedOn}                               AS matched_on
  `
}

/**
 * The researcher's own vocabulary, for the text branch.
 *
 * Saved area labels first — those were chosen deliberately and are the closest
 * thing to a stated interest — then the profile's research areas and keywords.
 * Quoted individually and OR-ed so a multi-word area matches as a phrase rather
 * than as loose words, which is what stops "machine learning" pulling in every
 * call that says "learning".
 */
async function researcherTerms(userId: string): Promise<string[]> {
  const [areas, profile] = await Promise.all([
    prisma.researcherSavedResearchArea.findMany({
      where: { user_id: userId, use_for_alerts: true },
      select: { label: true },
      orderBy: { created_at: 'asc' },
      take: MAX_TERMS,
    }),
    prisma.researcherProfile.findUnique({
      where: { user_id: userId },
      select: { research_areas: true, keywords: true },
    }),
  ])

  const seen = new Set<string>()
  const terms: string[] = []
  const push = (value: string | null | undefined) => {
    const cleaned = (value || '').replace(/["']/g, ' ').replace(/\s+/g, ' ').trim()
    // Single short tokens ("AI", "ML") match far too much to be useful alone.
    if (cleaned.length < 4) return
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    terms.push(cleaned)
  }

  for (const area of areas) push(area.label)
  for (const value of profile?.research_areas || []) push(value)
  for (const value of profile?.keywords || []) push(value)
  return terms.slice(0, MAX_TERMS)
}

/** `websearch_to_tsquery` input: each term as a quoted phrase, OR-ed together. */
function termsQuery(terms: string[]): string {
  return terms.map((term) => `"${term}"`).join(' OR ')
}

/**
 * The calls that match this researcher's own material.
 *
 * Ranked by strength of evidence, best per call kept: a call matching both the
 * profile and a paper is one row, credited to whichever piece of the
 * researcher's work makes the case best. The counts cover both sides of the
 * open/closed split whichever side is being shown, so the toggle can say what
 * is behind it before it is clicked.
 */
export async function findCallsInMyAreas(
  userId: string,
  tenantId: string | null,
  options: { status?: MyAreasStatus; limit?: number; now?: Date } = {}
): Promise<MyAreasResult> {
  const status = options.status ?? 'active'
  const limit = Math.min(Math.max(options.limit ?? MY_AREAS_DEFAULT_LIMIT, 1), MY_AREAS_MAX_LIMIT)
  const now = options.now ?? new Date()

  const profileColumn = Prisma.raw(profileEmbeddingColumn())
  const callColumn = Prisma.raw(callEmbeddingColumn())
  const publicationColumn = Prisma.raw(publicationEmbeddingColumn())
  const floor = vectorFloor()
  const visible = visibleCallSql(tenantId)

  // What there is to match on, and what there is to match against. Fetched
  // first so an empty result can name the reason rather than shrug.
  const [profileRow, savedAreaCount, publicationCount, callVectorRow, terms] = await Promise.all([
    prisma.$queryRaw<Array<{ has_vector: boolean }>>(Prisma.sql`
      SELECT (${profileColumn} IS NOT NULL) AS has_vector
        FROM researcher_profiles WHERE user_id = ${userId} LIMIT 1
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM researcher_saved_research_areas
       WHERE user_id = ${userId} AND use_for_alerts = true AND ${profileColumn} IS NOT NULL
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM reference_library
       WHERE user_id = ${userId} AND "isActive" = true
         AND ${FUNDING_PUBLICATION_TAG} = ANY(tags)
         AND ${publicationColumn} IS NOT NULL
    `),
    prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM funding_calls fc
       WHERE fc.${callColumn} IS NOT NULL AND ${visible}
    `),
    researcherTerms(userId),
  ])

  const hasCallVectors = (callVectorRow[0]?.count ?? 0) > 0
  // A researcher-side vector is only usable if the call side has vectors too;
  // comparing across providers is not a weaker match, it is a type error.
  const hasProfileVector = Boolean(profileRow[0]?.has_vector) && hasCallVectors
  const savedAreas = hasCallVectors ? (savedAreaCount[0]?.count ?? 0) : 0
  const taggedPublications = hasCallVectors ? (publicationCount[0]?.count ?? 0) : 0

  const readiness: MyAreasReadiness = {
    hasProfileVector,
    savedAreas,
    taggedPublications,
    terms: terms.length,
    isUnprofiled:
      !hasProfileVector && savedAreas === 0 && taggedPublications === 0 && terms.length === 0,
    callVectorsMissing: !hasCallVectors,
  }

  if (readiness.isUnprofiled) {
    return { calls: [], counts: { active: 0, expired: 0, total: 0 }, readiness }
  }

  const branches: Array<Promise<CandidateRow[]>> = []

  if (hasProfileVector) {
    branches.push(
      prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT ${candidateColumns(
          'profile',
          Prisma.sql`1 - (fc.${callColumn} <=> rp.${profileColumn})`,
          Prisma.sql`NULL::text`
        )}
          FROM funding_calls fc
          JOIN researcher_profiles rp ON rp.user_id = ${userId}
         WHERE fc.${callColumn} IS NOT NULL
           AND rp.${profileColumn} IS NOT NULL
           AND 1 - (fc.${callColumn} <=> rp.${profileColumn}) >= ${floor}
           AND ${visible}
           AND ${statusSql(status)}
         ORDER BY fc.${callColumn} <=> rp.${profileColumn} ASC
         LIMIT ${PER_SOURCE_LIMIT}
      `)
    )
  }

  if (savedAreas > 0) {
    branches.push(
      prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT DISTINCT ON (fc.id) ${candidateColumns(
          'research_area',
          Prisma.sql`1 - (fc.${callColumn} <=> area.${profileColumn})`,
          Prisma.sql`area.label`
        )}
          FROM funding_calls fc
          JOIN researcher_saved_research_areas area
            ON area.user_id = ${userId}
           AND area.use_for_alerts = true
           AND area.${profileColumn} IS NOT NULL
         WHERE fc.${callColumn} IS NOT NULL
           AND 1 - (fc.${callColumn} <=> area.${profileColumn}) >= ${floor}
           AND ${visible}
           AND ${statusSql(status)}
         ORDER BY fc.id, fc.${callColumn} <=> area.${profileColumn} ASC
         LIMIT ${PER_SOURCE_LIMIT}
      `)
    )
  }

  if (taggedPublications > 0) {
    branches.push(
      prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT DISTINCT ON (fc.id) ${candidateColumns(
          'publication',
          Prisma.sql`1 - (fc.${callColumn} <=> ref.${publicationColumn})`,
          Prisma.sql`ref.title`
        )}
          FROM funding_calls fc
          JOIN reference_library ref
            ON ref.user_id = ${userId}
           AND ref."isActive" = true
           AND ${FUNDING_PUBLICATION_TAG} = ANY(ref.tags)
           AND ref.${publicationColumn} IS NOT NULL
         WHERE fc.${callColumn} IS NOT NULL
           AND 1 - (fc.${callColumn} <=> ref.${publicationColumn}) >= ${floor}
           AND ${visible}
           AND ${statusSql(status)}
         ORDER BY fc.id, fc.${callColumn} <=> ref.${publicationColumn} ASC
         LIMIT ${PER_SOURCE_LIMIT}
      `)
    )
  }

  // The researcher's own words against the call's full-text document. Always
  // available, and the only branch that works while the corpus is between
  // embedding providers.
  const query = terms.length > 0 ? termsQuery(terms) : null
  if (query) {
    branches.push(
      prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT ${candidateColumns(
          'terms',
          Prisma.sql`ts_rank_cd(fc.ts_document, websearch_to_tsquery('english', ${query}))`,
          Prisma.sql`NULL::text`
        )}
          FROM funding_calls fc
         WHERE fc.ts_document @@ websearch_to_tsquery('english', ${query})
           AND ${visible}
           AND ${statusSql(status)}
         ORDER BY ts_rank_cd(fc.ts_document, websearch_to_tsquery('english', ${query})) DESC
         LIMIT ${PER_SOURCE_LIMIT}
      `)
    )
  }

  const [rows, counts] = await Promise.all([
    Promise.all(branches).then((results) => results.flat()),
    countBothSides(
      userId,
      tenantId,
      { hasProfileVector, savedAreas, taggedPublications, query },
      floor
    ),
  ])

  // Vector evidence outranks a term hit at equal strength: a semantic match is
  // about meaning, a term match about wording. Within a basis, score decides.
  const rank = (row: CandidateRow) => (row.source === 'terms' ? 0 : 1)
  const bestByCall = new Map<string, CandidateRow>()
  for (const row of rows) {
    const existing = bestByCall.get(row.id)
    if (
      !existing ||
      rank(row) > rank(existing) ||
      (rank(row) === rank(existing) && row.score > existing.score)
    ) {
      bestByCall.set(row.id, row)
    }
  }

  const ordered = Array.from(bestByCall.values()).sort(
    (left, right) => rank(right) - rank(left) || right.score - left.score
  )
  const topVector = ordered.find((row) => row.source !== 'terms')?.score ?? 0
  const topTerms = ordered.reduce(
    (best, row) => (row.source === 'terms' && row.score > best ? row.score : best),
    0
  )

  const calls: MyAreasCall[] = ordered.slice(0, limit).map((row) => {
    const closesAt = row.closes_at ? new Date(row.closes_at) : null
    const daysToClose = closesAt ? Math.ceil((closesAt.getTime() - now.getTime()) / 86400000) : null
    const basis: MyAreasBasis = row.source === 'terms' ? 'terms' : 'vector'
    const ratio = topTerms > 0 ? row.score / topTerms : 0
    const tier: MyAreasTier =
      basis === 'terms'
        ? ratio >= TERMS_STRONG_RATIO && row.score >= TERMS_STRONG_MIN
          ? 'strong'
          : ratio >= TERMS_MODERATE_RATIO && row.score >= TERMS_MODERATE_MIN
            ? 'moderate'
            : 'weak'
        : row.score >= topVector - TIER_STRONG_GAP
          ? 'strong'
          : row.score >= topVector - TIER_MODERATE_GAP
            ? 'moderate'
            : 'weak'

    return {
      id: row.id,
      title: row.title,
      agencyName: row.agency_name,
      summary: row.summary,
      disciplines: row.disciplines ?? [],
      closesAt,
      publishedAt: row.published_at ? new Date(row.published_at) : null,
      daysToClose,
      isExpired: Boolean(closesAt && closesAt < now),
      score: Number(row.score.toFixed(4)),
      tier,
      basis,
      source: row.source,
      matchedOn: row.matched_on,
      alerted: false,
    }
  })

  // Which of these the researcher was already told about. Cheap, and it turns
  // "have I seen this before?" from a memory test into a label.
  if (calls.length > 0) {
    const alerts = await prisma.fundingCallAlert.findMany({
      where: { user_id: userId, funding_call_id: { in: calls.map((call) => call.id) } },
      select: { funding_call_id: true },
    })
    const alerted = new Set(alerts.map((row) => row.funding_call_id))
    for (const call of calls) call.alerted = alerted.has(call.id)
  }

  return { calls, counts, readiness }
}

/**
 * How many matches sit on each side of the open/closed line.
 *
 * Counted independently of the filter so the toggle can carry both numbers
 * before either is chosen — a toggle that cannot say what is behind it is a
 * guess, and "Closed 0" saves a click.
 */
async function countBothSides(
  userId: string,
  tenantId: string | null,
  sources: {
    hasProfileVector: boolean
    savedAreas: number
    taggedPublications: number
    query: string | null
  },
  floor: number
): Promise<{ active: number; expired: number; total: number }> {
  const profileColumn = Prisma.raw(profileEmbeddingColumn())
  const callColumn = Prisma.raw(callEmbeddingColumn())
  const publicationColumn = Prisma.raw(publicationEmbeddingColumn())
  const visible = visibleCallSql(tenantId)

  const clauses: Prisma.Sql[] = []
  if (sources.hasProfileVector) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM researcher_profiles rp
       WHERE rp.user_id = ${userId} AND rp.${profileColumn} IS NOT NULL
         AND fc.${callColumn} IS NOT NULL
         AND 1 - (fc.${callColumn} <=> rp.${profileColumn}) >= ${floor}
    )`)
  }
  if (sources.savedAreas > 0) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM researcher_saved_research_areas area
       WHERE area.user_id = ${userId} AND area.use_for_alerts = true
         AND area.${profileColumn} IS NOT NULL
         AND fc.${callColumn} IS NOT NULL
         AND 1 - (fc.${callColumn} <=> area.${profileColumn}) >= ${floor}
    )`)
  }
  if (sources.taggedPublications > 0) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM reference_library ref
       WHERE ref.user_id = ${userId} AND ref."isActive" = true
         AND ${FUNDING_PUBLICATION_TAG} = ANY(ref.tags)
         AND ref.${publicationColumn} IS NOT NULL
         AND fc.${callColumn} IS NOT NULL
         AND 1 - (fc.${callColumn} <=> ref.${publicationColumn}) >= ${floor}
    )`)
  }
  if (sources.query) {
    clauses.push(
      Prisma.sql`fc.ts_document @@ websearch_to_tsquery('english', ${sources.query})`
    )
  }
  if (clauses.length === 0) return { active: 0, expired: 0, total: 0 }

  const anyMatch = clauses.reduce(
    (combined, clause, index) => (index === 0 ? clause : Prisma.sql`${combined} OR ${clause}`),
    Prisma.sql``
  )

  const [row] = await prisma.$queryRaw<Array<{ active: number; expired: number; total: number }>>(
    Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE COALESCE(fc.close_date, fc."deadlineAt") IS NULL
             OR COALESCE(fc.close_date, fc."deadlineAt") >= now()
        )::int AS active,
        COUNT(*) FILTER (
          WHERE COALESCE(fc.close_date, fc."deadlineAt") IS NOT NULL
            AND COALESCE(fc.close_date, fc."deadlineAt") < now()
        )::int AS expired,
        COUNT(*)::int AS total
      FROM funding_calls fc
      WHERE ${visible} AND (${anyMatch})
    `
  )

  return { active: row?.active ?? 0, expired: row?.expired ?? 0, total: row?.total ?? 0 }
}
