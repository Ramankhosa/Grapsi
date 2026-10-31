import { prisma } from '@/lib/prisma'

import { completeTaskInTx, withFence, type Lease } from './queue'
import { utc } from './sqlTime'
import { identifyUrl } from './urlIdentity'

/**
 * `funding_call_url_keys`: which catalog calls and intake jobs already own a
 * URL, keyed by the same dedup key Source Watch uses for resources.
 *
 * Writers that create links in Source Watch's own transactions (handoffs,
 * reviewed updates) insert keys directly. Everything else — catalog imports,
 * manual edits — is picked up here by polling with an ordered
 * (updated_at, id) cursor, re-scanning a small overlap so tied timestamps and
 * slow commits are never skipped. Deleted calls and jobs drop their keys by
 * cascade; keys a call no longer carries are deleted when it is next seen.
 * A periodic full pass (payload.full) re-reads everything from the start.
 */

const OVERLAP_MS = 5 * 60 * 1000
const BATCH_SIZE = 500

interface Cursor {
  updatedAt: string
  id: string
}

function keysFor(urls: Array<string | null | undefined>): string[] {
  const keys = new Set<string>()
  for (const url of urls) {
    if (!url) continue
    const identity = identifyUrl(url)
    if (identity) keys.add(identity.dedupKey)
  }
  return [...keys]
}

async function readCursor(name: string, full: boolean): Promise<Cursor> {
  if (full) return { updatedAt: new Date(0).toISOString(), id: '' }
  const row = await prisma.monitorSyncCursor.findUnique({ where: { name } })
  const cursor = (row?.cursor as Cursor | null) ?? null
  if (!cursor) return { updatedAt: new Date(0).toISOString(), id: '' }
  // Start a run slightly behind the saved position: rows committed late with
  // an earlier timestamp are caught on the next pass instead of never.
  return { updatedAt: new Date(new Date(cursor.updatedAt).getTime() - OVERLAP_MS).toISOString(), id: '' }
}

type CallRow = { id: string; source_url: string | null; sourceUrl: string | null; official_urls: string[] | null; updatedAt: Date }
type JobRow = { id: string; source_url: string | null; updated_at: Date; source_urls: string[] | null }

export async function refreshUrlIndex(lease: Lease, options: { budgetMs?: number } = {}): Promise<{ calls: number; jobs: number }> {
  const started = Date.now()
  const budget = options.budgetMs ?? 90_000
  const full = lease.payload.full === true
  let calls = 0
  let jobs = 0

  // Catalog calls.
  let callCursor = await readCursor('url-keys:calls', full)
  while (Date.now() - started < budget) {
    const rows = await prisma.$queryRaw<CallRow[]>`
      SELECT "id", "source_url", "sourceUrl", "official_urls", "updatedAt"
      FROM "funding_calls"
      WHERE ("updatedAt", "id") > (${utc(new Date(callCursor.updatedAt))}, ${callCursor.id})
      ORDER BY "updatedAt" ASC, "id" ASC
      LIMIT ${BATCH_SIZE}
    `
    if (rows.length === 0) break
    const last = rows[rows.length - 1]
    callCursor = { updatedAt: last.updatedAt.toISOString(), id: last.id }
    await withFence(lease, async (tx) => {
      for (const row of rows) {
        const keys = keysFor([row.source_url, row.sourceUrl, ...(row.official_urls ?? [])])
        await tx.fundingCallUrlKey.deleteMany({
          where: { funding_call_id: row.id, source: { in: ['SOURCE_URL', 'OFFICIAL_URL'] }, dedup_key: { notIn: keys } },
        })
        if (keys.length > 0) {
          await tx.fundingCallUrlKey.createMany({
            data: keys.map((dedup_key) => ({ dedup_key, owner_key: `call:${row.id}`, funding_call_id: row.id, source: 'SOURCE_URL' })),
            skipDuplicates: true,
          })
        }
      }
      await tx.monitorSyncCursor.upsert({
        where: { name: 'url-keys:calls' },
        create: { name: 'url-keys:calls', cursor: callCursor as object },
        update: { cursor: callCursor as object },
      })
    })
    calls += rows.length
    if (rows.length < BATCH_SIZE) break
  }

  // Intake jobs (their own URL and every source URL they carry).
  let jobCursor = await readCursor('url-keys:jobs', full)
  while (Date.now() - started < budget) {
    const rows = await prisma.$queryRaw<JobRow[]>`
      SELECT j."id", j."source_url", j."updated_at",
             ARRAY(SELECT s."source_url" FROM "funding_intake_job_sources" s WHERE s."job_id" = j."id" AND s."source_url" IS NOT NULL) AS "source_urls"
      FROM "funding_intake_jobs" j
      WHERE (j."updated_at", j."id") > (${utc(new Date(jobCursor.updatedAt))}, ${jobCursor.id})
      ORDER BY j."updated_at" ASC, j."id" ASC
      LIMIT ${BATCH_SIZE}
    `
    if (rows.length === 0) break
    const last = rows[rows.length - 1]
    jobCursor = { updatedAt: last.updated_at.toISOString(), id: last.id }
    await withFence(lease, async (tx) => {
      for (const row of rows) {
        const keys = keysFor([row.source_url, ...(row.source_urls ?? [])])
        await tx.fundingCallUrlKey.deleteMany({
          where: { intake_job_id: row.id, source: 'INTAKE_SOURCE', dedup_key: { notIn: keys } },
        })
        if (keys.length > 0) {
          await tx.fundingCallUrlKey.createMany({
            data: keys.map((dedup_key) => ({ dedup_key, owner_key: `job:${row.id}`, intake_job_id: row.id, source: 'INTAKE_SOURCE' })),
            skipDuplicates: true,
          })
        }
      }
      await tx.monitorSyncCursor.upsert({
        where: { name: 'url-keys:jobs' },
        create: { name: 'url-keys:jobs', cursor: jobCursor as object },
        update: { cursor: jobCursor as object },
      })
    })
    jobs += rows.length
    if (rows.length < BATCH_SIZE) break
  }

  await withFence(lease, (tx) => completeTaskInTx(tx, lease, { calls, jobs, full }))
  return { calls, jobs }
}

/** Calls and intake jobs that already own any of these dedup keys. */
export async function findOwnersByKeys(dedupKeys: string[]) {
  if (dedupKeys.length === 0) return []
  return prisma.fundingCallUrlKey.findMany({
    where: { dedup_key: { in: dedupKeys } },
    select: { dedup_key: true, funding_call_id: true, intake_job_id: true, handoff_id: true, source: true },
  })
}
