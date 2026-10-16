/**
 * Releasing staged imported calls to researcher discovery, silently — and
 * putting them back.
 *
 * Release flips STAGED → PUBLISHED (both status columns), activates the call
 * and stamps publishedAt. It keeps visibility GLOBAL_CATALOG, so funding-
 * department queues, census, backlog and reminders still ignore it, and it
 * never calls publishFundingCall: no embedding, no LLM classification, no
 * school mapping, no officer notices, no alerts. updatedAt is not touched, so
 * the finder's "recently updated" browse order is not flooded by a release.
 *
 * Release is scoped by SOURCE, not by import run: a crashed run's calls are
 * picked up by the next release just like a completed run's. Every column a
 * release changes is logged, so unrelease (and rollback) restore all of them.
 */
import type { PrismaClient } from '@/lib/prisma-generated'

import { NOTIFICATION_POLICY_SUPPRESSED, RELEASE_BATCH_SIZE, REVIEW_STATUS, importSourceLabel } from './constants'
import { callsWithAttachedWork } from './rollback'
import { refreshReviewStatus } from './service'

type Log = (message: string) => void

export interface ReleaseResult {
  staged: number
  eligible: number
  released: number
  blocked: number
  releaseRunId: string | null
}

async function stagedIdsForSource(db: PrismaClient, sourceKey: string, ids?: string[]) {
  const rows = await db.fundingCall.findMany({
    where: {
      import_run_id: { not: null },
      source: importSourceLabel(sourceKey),
      catalog_status: 'STAGED',
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  return rows.map((row) => row.id)
}

export async function releaseImportedCalls(input: {
  db: PrismaClient
  sourceKey: string
  dryRun: boolean
  ids?: string[]
  limit?: number
  log?: Log
}): Promise<ReleaseResult> {
  const { db } = input
  const log = input.log || (() => {})
  const staged = await stagedIdsForSource(db, input.sourceKey, input.ids)
  await refreshReviewStatus(db, null, staged)
  const clear = await db.fundingCall.findMany({
    where: { id: { in: staged }, review_status: REVIEW_STATUS.CLEAR },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const eligible = clear.map((row) => row.id)
  const target = input.limit ? eligible.slice(0, input.limit) : eligible
  const blocked = staged.length - eligible.length
  log(`${staged.length} staged; ${eligible.length} clear; releasing ${input.dryRun ? 0 : target.length}; ${blocked} held for review.`)
  if (input.dryRun || target.length === 0) {
    return { staged: staged.length, eligible: eligible.length, released: 0, blocked, releaseRunId: null }
  }

  const releaseRun = await db.fundingImportRun.create({
    data: { source_key: input.sourceKey, mode: 'RELEASE', status: 'RUNNING', importer_version: 'release-2' },
  })
  let released = 0
  try {
    for (let i = 0; i < target.length; i += RELEASE_BATCH_SIZE) {
      const ids = target.slice(i, i + RELEASE_BATCH_SIZE)
      const now = new Date()
      await db.$transaction(async (tx) => {
        // Only rows an import created, still STAGED, still clear and still
        // suppressed. The previous values come back with the update so every
        // changed column can be logged and restored.
        const flipped = await tx.$queryRawUnsafe<Array<{ id: string; old_status: string; old_active: boolean | null; old_published: Date | null }>>(
          `WITH old AS (
             SELECT id, status::text AS old_status, is_active AS old_active, "publishedAt" AS old_published
             FROM funding_calls
             WHERE id = ANY($1::text[]) AND import_run_id IS NOT NULL
               AND catalog_status::text = 'STAGED' AND review_status = '${REVIEW_STATUS.CLEAR}'
               AND notification_policy = '${NOTIFICATION_POLICY_SUPPRESSED}'
               AND visibility::text = 'GLOBAL_CATALOG'
             FOR UPDATE
           )
           UPDATE funding_calls fc
              SET catalog_status = 'PUBLISHED', status = 'PUBLISHED', is_active = true,
                  "publishedAt" = COALESCE(fc."publishedAt", $2)
             FROM old
            WHERE fc.id = old.id
        RETURNING fc.id, old.old_status, old.old_active, old.old_published`,
          ids,
          now
        )
        if (flipped.length > 0) {
          const changes = flipped.flatMap((row) => [
            { field: 'catalog_status', before_value: 'STAGED', after_value: 'PUBLISHED' },
            { field: 'status', before_value: row.old_status, after_value: 'PUBLISHED' },
            { field: 'is_active', before_value: row.old_active, after_value: true },
            { field: 'publishedAt', before_value: row.old_published ? row.old_published.toISOString() : null, after_value: row.old_published ? row.old_published.toISOString() : now.toISOString() },
          ].map((change) => ({
            run_id: releaseRun.id,
            entity_table: 'funding_calls',
            entity_id: row.id,
            operation: 'UPDATE',
            field: change.field,
            before_value: change.before_value as any,
            after_value: change.after_value as any,
          })))
          await tx.fundingImportChange.createMany({ data: changes })
        }
        released += flipped.length
      }, { timeout: 120_000 })
      log(`  released ${released}/${target.length}`)
    }
    await db.fundingImportRun.update({ where: { id: releaseRun.id }, data: { status: 'COMPLETED', finished_at: new Date(), counts: { released, blocked } as any } })
  } catch (error) {
    await db.fundingImportRun.update({ where: { id: releaseRun.id }, data: { status: 'FAILED', finished_at: new Date(), error: String(error) } })
    throw error
  }
  return { staged: staged.length, eligible: eligible.length, released, blocked, releaseRunId: releaseRun.id }
}

/**
 * Takes released imported calls back out of discovery. A call nothing has
 * attached to returns to STAGED with every column a release changed restored;
 * a call with attached work (a grant session, an assignment…) is archived
 * instead, so that work keeps pointing at a real row.
 */
export async function unreleaseImportedCalls(input: {
  db: PrismaClient
  sourceKey: string
  dryRun: boolean
  ids?: string[]
  log?: Log
}) {
  const { db } = input
  const log = input.log || (() => {})
  const published = await db.fundingCall.findMany({
    where: {
      import_run_id: { not: null },
      source: importSourceLabel(input.sourceKey),
      visibility: 'GLOBAL_CATALOG',
      catalog_status: 'PUBLISHED',
      ...(input.ids && input.ids.length > 0 ? { id: { in: input.ids } } : {}),
    },
    select: { id: true },
  })
  const ids = published.map((row) => row.id)
  const attached = await callsWithAttachedWork(db, ids)
  const restore = ids.filter((id) => !attached.has(id))
  const archive = ids.filter((id) => attached.has(id))
  log(`${ids.length} released imported calls in scope: ${restore.length} back to STAGED, ${archive.length} archived (attached work).`)
  if (input.dryRun || ids.length === 0) return { restored: 0, archived: 0, inScope: ids.length }

  const run = await db.fundingImportRun.create({
    data: { source_key: input.sourceKey, mode: 'ROLLBACK', status: 'RUNNING', importer_version: 'unrelease-1' },
  })
  let restored = 0
  for (let i = 0; i < restore.length; i += RELEASE_BATCH_SIZE) {
    const batch = restore.slice(i, i + RELEASE_BATCH_SIZE)
    restored += Number(await db.$executeRawUnsafe(
      `UPDATE funding_calls SET catalog_status = 'STAGED', status = 'READY_FOR_REVIEW', is_active = false, "publishedAt" = NULL
        WHERE id = ANY($1::text[]) AND import_run_id IS NOT NULL AND visibility::text = 'GLOBAL_CATALOG'`,
      batch
    ))
    await db.fundingImportChange.createMany({
      data: batch.map((id) => ({ run_id: run.id, entity_table: 'funding_calls', entity_id: id, operation: 'UPDATE', field: 'catalog_status', before_value: 'PUBLISHED' as any, after_value: 'STAGED' as any })),
    })
  }
  let archived = 0
  if (archive.length > 0) {
    archived = Number(await db.$executeRawUnsafe(
      `UPDATE funding_calls SET catalog_status = 'ARCHIVED', status = 'ARCHIVED', is_active = false, "archivedAt" = now()
        WHERE id = ANY($1::text[]) AND import_run_id IS NOT NULL AND visibility::text = 'GLOBAL_CATALOG'`,
      archive
    ))
  }
  await db.fundingImportRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', finished_at: new Date(), counts: { restored, archived } as any } })
  return { restored, archived, inScope: ids.length }
}
