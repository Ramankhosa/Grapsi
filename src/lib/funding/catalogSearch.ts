import { Prisma } from '@prisma/client'

import prisma from '../prisma'

/**
 * Admin catalogue search (29 Oct 2026): where each call came from, whether a
 * person approved it, and filters over the whole catalogue, not one page.
 *
 * Origin, from the call's intake trail:
 *   SOURCE_WATCH  drafted by the Source Watch pipeline (handoff batch)
 *   BATCH         a bulk upload (ZIP/CSV or several sources at once)
 *   MANUAL        one call entered through intake by a person
 *   IMPORT        an external catalogue import (e.g. Scientify)
 *   OTHER         seeded or legacy rows with no intake record
 * AUTO_PUBLISHED marks calls the retired bulk "publish automatically" option
 * published with no one approving each (30 Jul and 7 Sep 2026).
 */
export const CATALOG_ORIGINS = ['MANUAL', 'BATCH', 'SOURCE_WATCH', 'IMPORT', 'OTHER'] as const
export type CatalogOrigin = (typeof CATALOG_ORIGINS)[number]
export const CATALOG_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'REJECTED'] as const
export const CATALOG_DEADLINES = ['OPEN', 'CLOSED', 'ROLLING', 'NONE'] as const
export const CATALOG_APPROVALS = ['PERSON', 'AUTO', 'UNPUBLISHED'] as const
export const CATALOG_SORTS = ['UPDATED', 'DEADLINE', 'PUBLISHED', 'CREATED'] as const

export interface CatalogSearch {
  q: string
  status: (typeof CATALOG_STATUSES)[number] | null
  origin: CatalogOrigin | null
  approval: (typeof CATALOG_APPROVALS)[number] | null
  deadline: (typeof CATALOG_DEADLINES)[number] | null
  kind: string | null
  sort: (typeof CATALOG_SORTS)[number]
  page: number
  pageSize: number
}

function pick<T extends readonly string[]>(value: string | null, allowed: T): T[number] | null {
  const upper = (value ?? '').trim().toUpperCase()
  return (allowed as readonly string[]).includes(upper) ? (upper as T[number]) : null
}

export function parseCatalogSearch(params: URLSearchParams): CatalogSearch {
  return {
    q: (params.get('q') ?? '').trim().slice(0, 200),
    status: pick(params.get('status'), CATALOG_STATUSES),
    origin: pick(params.get('origin'), CATALOG_ORIGINS),
    approval: pick(params.get('approval'), CATALOG_APPROVALS),
    deadline: pick(params.get('deadline'), CATALOG_DEADLINES),
    kind: (params.get('kind') ?? '').trim().slice(0, 80) || null,
    sort: pick(params.get('sort'), CATALOG_SORTS) ?? 'UPDATED',
    page: Math.max(1, Math.floor(Number(params.get('page')) || 1)),
    pageSize: 50,
  }
}

const ORIGIN_SQL = Prisma.sql`CASE
  WHEN c.import_run_id IS NOT NULL OR c.source LIKE 'catalog-import%' THEN 'IMPORT'
  WHEN j.fetch_metadata_json->>'origin' = 'source_watch' OR b.handoff_key IS NOT NULL THEN 'SOURCE_WATCH'
  WHEN j.batch_id IS NOT NULL THEN 'BATCH'
  WHEN j.id IS NOT NULL THEN 'MANUAL'
  ELSE 'OTHER' END`
const AUTO_SQL = Prisma.sql`EXISTS (SELECT 1 FROM funding_intake_job_events e WHERE e.job_id = c.intake_job_id AND e.event_type = 'auto_publish_completed')`
const TODAY_SQL = Prisma.sql`(now() at time zone 'utc')::date`
const FROM_SQL = Prisma.sql`FROM funding_calls c
  LEFT JOIN funding_intake_jobs j ON j.id = c.intake_job_id
  LEFT JOIN funding_intake_batches b ON b.id = j.batch_id`

function conditions(search: CatalogSearch, withOrigin = true): Prisma.Sql {
  // The imported external catalogue (GLOBAL_CATALOG) has its own review screen.
  const parts: Prisma.Sql[] = [Prisma.sql`c.visibility <> 'GLOBAL_CATALOG'`]
  if (search.q) {
    const like = `%${search.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    parts.push(Prisma.sql`(c.title ILIKE ${like} OR c.scheme_title ILIKE ${like} OR c.agency_name ILIKE ${like} OR c.source_url ILIKE ${like} OR c.uploaded_by ILIKE ${like})`)
  }
  if (search.status) parts.push(Prisma.sql`c.catalog_status::text = ${search.status}`)
  if (withOrigin && search.origin) parts.push(Prisma.sql`(${ORIGIN_SQL}) = ${search.origin}`)
  if (search.approval === 'AUTO') parts.push(Prisma.sql`c.catalog_status = 'PUBLISHED' AND ${AUTO_SQL}`)
  if (search.approval === 'PERSON') parts.push(Prisma.sql`c.catalog_status = 'PUBLISHED' AND NOT ${AUTO_SQL}`)
  if (search.approval === 'UNPUBLISHED') parts.push(Prisma.sql`c.catalog_status IS DISTINCT FROM 'PUBLISHED'`)
  if (search.deadline === 'OPEN') parts.push(Prisma.sql`(coalesce(c.is_rolling, false) OR c.close_date::date >= ${TODAY_SQL})`)
  if (search.deadline === 'CLOSED') parts.push(Prisma.sql`(NOT coalesce(c.is_rolling, false) AND c.close_date::date < ${TODAY_SQL})`)
  if (search.deadline === 'ROLLING') parts.push(Prisma.sql`coalesce(c.is_rolling, false)`)
  if (search.deadline === 'NONE') parts.push(Prisma.sql`(NOT coalesce(c.is_rolling, false) AND c.close_date IS NULL)`)
  if (search.kind) parts.push(Prisma.sql`${search.kind} = ANY(c.funding_kinds)`)
  return Prisma.join(parts, ' AND ')
}

function orderBy(sort: CatalogSearch['sort']): Prisma.Sql {
  if (sort === 'DEADLINE') return Prisma.sql`c.close_date ASC NULLS LAST, c."updatedAt" DESC`
  if (sort === 'PUBLISHED') return Prisma.sql`c."publishedAt" DESC NULLS LAST, c."updatedAt" DESC`
  if (sort === 'CREATED') return Prisma.sql`c."createdAt" DESC`
  return Prisma.sql`c."updatedAt" DESC, c."createdAt" DESC`
}

export interface CatalogOriginRow { id: string; origin: CatalogOrigin; auto_published: boolean; entered_by: string | null }

/** One page of matching call ids (in order), their origin, and the total. */
export async function searchCatalogIds(search: CatalogSearch) {
  const where = conditions(search)
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<CatalogOriginRow[]>(Prisma.sql`SELECT c.id, ${ORIGIN_SQL} AS origin, ${AUTO_SQL} AS auto_published, c.uploaded_by AS entered_by
      ${FROM_SQL} WHERE ${where} ORDER BY ${orderBy(search.sort)} LIMIT ${search.pageSize} OFFSET ${(search.page - 1) * search.pageSize}`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n ${FROM_SQL} WHERE ${where}`),
  ])
  return { rows, total: count[0]?.n ?? 0 }
}

/** Counts for the filter options: origins under the other filters, plus the funding kinds in use. */
export async function catalogFacets(search: CatalogSearch) {
  const [origins, kinds, auto] = await Promise.all([
    prisma.$queryRaw<Array<{ origin: CatalogOrigin; n: number }>>(Prisma.sql`SELECT ${ORIGIN_SQL} AS origin, count(*)::int AS n ${FROM_SQL} WHERE ${conditions(search, false)} GROUP BY 1`),
    prisma.$queryRaw<Array<{ kind: string; n: number }>>(Prisma.sql`SELECT k AS kind, count(*)::int AS n FROM funding_calls c, unnest(c.funding_kinds) k WHERE c.visibility <> 'GLOBAL_CATALOG' GROUP BY 1 ORDER BY 2 DESC LIMIT 30`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM funding_calls c WHERE c.visibility <> 'GLOBAL_CATALOG' AND c.catalog_status = 'PUBLISHED' AND ${AUTO_SQL}`),
  ])
  return {
    origins: Object.fromEntries(CATALOG_ORIGINS.map((o) => [o, origins.find((r) => r.origin === o)?.n ?? 0])) as Record<CatalogOrigin, number>,
    kinds,
    autoPublished: auto[0]?.n ?? 0,
  }
}
