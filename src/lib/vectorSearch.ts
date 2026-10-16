/**
 * Query-time settings for approximate vector search over funding calls.
 *
 * funding_calls vectors are indexed with HNSW
 * (20261016100000_funding_call_vector_hnsw). By default an HNSW scan yields
 * only hnsw.ef_search (40) neighbours BEFORE the WHERE clause runs, so a
 * filtered query asking for 60 candidates can come back short. pgvector 0.8
 * iterative scans keep walking the graph until the LIMIT is filled. The
 * settings are applied with SET LOCAL in the same transaction as the query,
 * so they never leak into other queries on the pooled connection.
 *
 * On a pgvector without a setting it is skipped: SET on a parameter the
 * loaded extension does not define is an error that would fail every search.
 */
import type { Prisma } from '@/lib/prisma-generated'
import prisma from '@/lib/prisma'

export const VECTOR_SEARCH_EF_SEARCH = 100

function versionAtLeast(version: string | null | undefined, major: number, minor: number): boolean {
  const [a = 0, b = 0] = String(version || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  return a > major || (a === major && b >= minor)
}

/** The SET LOCAL statements a pgvector version supports, in order. */
export function vectorSearchSettingsFor(version: string | null | undefined): string[] {
  const settings: string[] = []
  if (versionAtLeast(version, 0, 5)) settings.push(`SET LOCAL hnsw.ef_search = ${VECTOR_SEARCH_EF_SEARCH}`)
  // Callers rescore candidates by similarity, so relaxed order is enough.
  if (versionAtLeast(version, 0, 8)) settings.push(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`)
  return settings
}

let cachedSettings: Promise<string[]> | null = null

function vectorSearchSettings(): Promise<string[]> {
  if (!cachedSettings) {
    cachedSettings = prisma
      .$queryRaw<Array<{ version: string | null }>>`SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'`
      .then((rows) => vectorSearchSettingsFor(rows[0]?.version))
      .catch(() => {
        cachedSettings = null
        return []
      })
  }
  return cachedSettings
}

/** Runs one vector query with the search settings applied (SET LOCAL). */
export async function withVectorSearchSettings<T>(query: Prisma.PrismaPromise<T>): Promise<T> {
  const settings = await vectorSearchSettings()
  if (settings.length === 0) return query
  const results = await prisma.$transaction([...settings.map((statement) => prisma.$executeRawUnsafe(statement)), query])
  return results[results.length - 1] as T
}
