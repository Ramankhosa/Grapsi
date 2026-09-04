/**
 * Is this funding call any of this school's business?
 *
 * The two halves of the answer already exist separately: a call carries
 * `funding_call_research_area_taxonomies` rows (written by the classifier), an
 * org unit carries `tenant_org_unit_research_areas` rows (written by an admin
 * in the structure page). Relevance is their intersection, and this module is
 * the ONE place that intersection is computed — the same discipline
 * `orgUnits/scope.ts` applies to org reach, and for the same reason: a rule
 * re-derived per route drifts per route.
 *
 * A unit's effective areas include its whole subtree. Mapping only the
 * departments still gives their school the right reach, because chasing a
 * school means chasing everyone under it — the rule `resolveManagedScope`
 * already encodes for coverage.
 */

import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

/**
 * Strongest first. `unclassified` is not a weak match — it is the absence of
 * information, deliberately surfaced rather than hidden (see UNCLASSIFIED
 * below).
 */
export type RelevanceTier = 'direct' | 'broad' | 'keyword' | 'unclassified' | 'none'

const TIER_RANK: Record<RelevanceTier, number> = {
  direct: 4,
  broad: 3,
  keyword: 2,
  unclassified: 1,
  none: 0,
}

export interface UnitAreaProfile {
  /** Units asked about, after subtree expansion contributed their areas. */
  unitIds: string[]
  /** Taxonomy area ids across the subtree. */
  areaIds: string[]
  /** Level-1 group codes across the subtree, for the `broad` tier. */
  level1Codes: string[]
  /** Free-text keywords across the subtree, matched against `disciplines[]`. */
  keywords: string[]
  /**
   * True when nothing in the subtree is mapped. Every predicate then becomes a
   * no-op and callers should tell the user to go and map the school — filtering
   * on an empty profile would hide the entire catalog, which is the one outcome
   * worse than showing too much.
   */
  isUnmapped: boolean
}

export const EMPTY_PROFILE: UnitAreaProfile = {
  unitIds: [],
  areaIds: [],
  level1Codes: [],
  keywords: [],
  isUnmapped: true,
}

function textArray(values: string[]): Prisma.Sql {
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}`))}]::text[]`
}

/**
 * The effective discipline profile of the given units, including descendants.
 *
 * One query over the materialized `path` array (GIN-indexed, maintained by
 * trigger), not a recursive CTE — the same shape `resolveManagedScope` uses for
 * subtree expansion.
 */
export async function loadUnitAreaProfile(
  tenantId: string,
  unitIds: string[]
): Promise<UnitAreaProfile> {
  const roots = Array.from(new Set((unitIds || []).filter(Boolean)))
  if (roots.length === 0) {
    return EMPTY_PROFILE
  }

  const rootArray = textArray(roots)

  const [areaRows, keywordRows] = await Promise.all([
    prisma.$queryRaw<Array<{ taxonomy_area_id: string; level1_code: string }>>(Prisma.sql`
      SELECT DISTINCT ra.taxonomy_area_id, area.level1_code
      FROM tenant_org_unit_research_areas ra
      INNER JOIN tenant_org_units unit ON unit.id = ra.org_unit_id
      INNER JOIN research_area_taxonomy_areas area ON area.id = ra.taxonomy_area_id
      INNER JOIN research_area_taxonomy_uploads upload ON upload.id = area.upload_id
      WHERE ra.tenant_id = ${tenantId}
        AND unit.is_active = true
        AND unit.path && ${rootArray}
        -- Only the live catalog counts. Replacing the catalog archives the old
        -- upload without deleting its rows, so without this a unit mapped
        -- against a superseded catalog would keep matching on codes nobody can
        -- see or edit any more.
        AND area.is_active = true
        AND upload.status = 'ACTIVE' 
    `),
    prisma.$queryRaw<Array<{ keyword: string }>>(Prisma.sql`
      SELECT DISTINCT unnest(unit.keywords) AS keyword
      FROM tenant_org_units unit
      WHERE unit.tenant_id = ${tenantId}
        AND unit.is_active = true
        AND unit.path && ${rootArray}
    `),
  ])

  const areaIds = Array.from(new Set(areaRows.map((row) => row.taxonomy_area_id)))
  const level1Codes = Array.from(new Set(areaRows.map((row) => row.level1_code).filter(Boolean)))
  const keywords = Array.from(
    new Set(keywordRows.map((row) => (row.keyword || '').trim()).filter(Boolean))
  )

  return {
    unitIds: roots,
    areaIds,
    level1Codes,
    keywords,
    isUnmapped: areaIds.length === 0 && keywords.length === 0,
  }
}

/**
 * SQL predicate selecting calls relevant to a profile, for use against a
 * `funding_calls` alias.
 *
 * Returns TRUE (a no-op) for an unmapped profile — see `isUnmapped`. Unclassified
 * calls always pass: a call nobody has classified is a gap in our data, and the
 * cost of showing it to an extra school is an officer's glance, while the cost
 * of hiding it is a missed deadline.
 */
export function relevantCallWhereSql(
  profile: UnitAreaProfile,
  alias = 'fc',
  options: {
    includeBroad?: boolean
    includeUnclassified?: boolean
    /**
     * The school whose own judgement can override the taxonomy. A call this
     * school marked RELEVANT is in its queue whatever the classifier said —
     * the escape hatch for a global call whose classification is right for
     * everyone else and wrong here. Dismissal is handled by the queue's state
     * ladder, not here, so this clause only ever ADDS.
     */
    pinnedForUnitId?: string | null
  } = {}
): Prisma.Sql {
  const { includeBroad = true, includeUnclassified = true, pinnedForUnitId = null } = options
  const callId = Prisma.raw(`${alias}.id`)

  const pinnedSql = pinnedForUnitId
    ? Prisma.sql`
      EXISTS (
        SELECT 1 FROM call_school_triage t
         WHERE t.funding_call_id = ${callId}
           AND t.org_unit_id = ${pinnedForUnitId}
           AND t.status = 'RELEVANT'
      )`
    : null

  if (profile.isUnmapped) {
    return Prisma.sql`TRUE`
  }

  const clauses: Prisma.Sql[] = []
  if (pinnedSql) clauses.push(pinnedSql)

  if (profile.areaIds.length > 0) {
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM funding_call_research_area_taxonomies m
         WHERE m.funding_call_id = ${callId}
           AND m.taxonomy_area_id = ANY(${textArray(profile.areaIds)})
      )`)
  }

  if (includeBroad && profile.level1Codes.length > 0) {
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM funding_call_research_area_taxonomies m
         WHERE m.funding_call_id = ${callId}
           AND m.taxonomy_level1_code = ANY(${textArray(profile.level1Codes)})
      )`)
  }

  if (profile.keywords.length > 0) {
    // Case-insensitive overlap against the call's free-text tags. `disciplines`
    // is the only place a call's own vocabulary survives, so this is what makes
    // a locally-worded speciality reachable at all.
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1
          FROM unnest(${Prisma.raw(`${alias}.disciplines`)}) AS d(tag)
         WHERE lower(btrim(d.tag)) = ANY(
           SELECT lower(btrim(k)) FROM unnest(${textArray(profile.keywords)}) AS k
         )
      )`)
  }

  if (includeUnclassified) {
    clauses.push(Prisma.sql`
      NOT EXISTS (
        SELECT 1 FROM funding_call_research_area_taxonomies m
         WHERE m.funding_call_id = ${callId}
      )`)
  }

  if (clauses.length === 0) {
    return Prisma.sql`TRUE`
  }

  return Prisma.sql`(${Prisma.join(clauses, ' OR ')})`
}

export interface CallRelevance {
  tier: RelevanceTier
  /** Plain-English explanation, e.g. "Pharmacy → Pharmaceutics". */
  reason: string | null
}

/** One call's stored classification, as `relevanceForCalls` reads it back. */
export interface CallMappingRow {
  taxonomy_area_id: string
  taxonomy_level1_code: string | null
  taxonomy_level1_name: string | null
  taxonomy_level2_name: string | null
}

/**
 * The tier decision for ONE call, given what it is classified as and what the
 * school works on.
 *
 * Pure and exported so the ranking rules are testable without a database — the
 * split `alertKeywordBoost` uses against `fundingAlertService`, and the reason
 * a mis-ranked call can be reproduced in a unit test rather than a fixture.
 */
export function tierForCall(
  mappings: CallMappingRow[],
  sets: { areaIds: Set<string>; level1Codes: Set<string> },
  keywordHit?: string | null
): CallRelevance {
  if (mappings.length === 0) {
    return {
      tier: 'unclassified',
      reason: 'Not yet classified — shown to every school',
    }
  }

  let best: CallRelevance = { tier: 'none', reason: null }
  const consider = (tier: RelevanceTier, reason: string) => {
    if (TIER_RANK[tier] > TIER_RANK[best.tier]) best = { tier, reason }
  }

  for (const mapping of mappings) {
    const label = mapping.taxonomy_level2_name
      ? `${mapping.taxonomy_level1_name} → ${mapping.taxonomy_level2_name}`
      : mapping.taxonomy_level1_name || ''
    if (sets.areaIds.has(mapping.taxonomy_area_id)) {
      consider('direct', label)
    } else if (mapping.taxonomy_level1_code && sets.level1Codes.has(mapping.taxonomy_level1_code)) {
      consider('broad', `${mapping.taxonomy_level1_name} (related area)`)
    }
  }

  if (keywordHit) {
    consider('keyword', `Matches your keyword "${keywordHit}"`)
  }

  return best
}

/**
 * Per-call relevance detail for a page of results.
 *
 * Kept separate from the predicate because they answer different questions —
 * the predicate decides what to fetch, this explains what came back. An officer
 * who asks "why is this in my queue" must get an answer without reading SQL.
 */
export async function relevanceForCalls(
  profile: UnitAreaProfile,
  callIds: string[]
): Promise<Map<string, CallRelevance>> {
  const result = new Map<string, CallRelevance>()
  const ids = Array.from(new Set((callIds || []).filter(Boolean)))
  if (ids.length === 0) {
    return result
  }

  if (profile.isUnmapped) {
    // Nothing is mapped, so nothing can be explained. Callers show the
    // "map this school" banner rather than a per-row reason.
    for (const id of ids) result.set(id, { tier: 'none', reason: null })
    return result
  }

  const idArray = textArray(ids)
  const areaIdSet = new Set(profile.areaIds)
  const level1Set = new Set(profile.level1Codes)
  const keywordSet = new Set(profile.keywords.map((keyword) => keyword.trim().toLowerCase()))

  const [mappingRows, tagRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        funding_call_id: string
        taxonomy_area_id: string
        taxonomy_level1_code: string | null
        taxonomy_level1_name: string | null
        taxonomy_level2_name: string | null
      }>
    >(Prisma.sql`
      SELECT funding_call_id, taxonomy_area_id, taxonomy_level1_code,
             taxonomy_level1_name, taxonomy_level2_name
        FROM funding_call_research_area_taxonomies
       WHERE funding_call_id = ANY(${idArray})
    `),
    keywordSet.size > 0
      ? prisma.$queryRaw<Array<{ id: string; disciplines: string[] }>>(Prisma.sql`
          SELECT id, disciplines FROM funding_calls WHERE id = ANY(${idArray})
        `)
      : Promise.resolve([]),
  ])

  const mappingsByCall = new Map<string, typeof mappingRows>()
  for (const row of mappingRows) {
    const list = mappingsByCall.get(row.funding_call_id) || []
    list.push(row)
    mappingsByCall.set(row.funding_call_id, list)
  }

  const keywordHitByCall = new Map<string, string>()
  for (const row of tagRows) {
    const hit = (row.disciplines || []).find((tag) =>
      keywordSet.has((tag || '').trim().toLowerCase())
    )
    if (hit) keywordHitByCall.set(row.id, hit)
  }

  for (const id of ids) {
    result.set(
      id,
      tierForCall(
        mappingsByCall.get(id) || [],
        { areaIds: areaIdSet, level1Codes: level1Set },
        keywordHitByCall.get(id)
      )
    )
  }

  return result
}
