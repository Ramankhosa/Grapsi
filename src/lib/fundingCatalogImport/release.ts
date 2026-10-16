/**
 * Releasing staged imported calls to researcher discovery, silently.
 *
 * A release flips STAGED → PUBLISHED (both status columns) and activates the
 * call. It keeps visibility GLOBAL_CATALOG, so funding-department queues,
 * census, backlog and reminders still ignore it, and it never calls
 * publishFundingCall: no embedding, no LLM classification, no school mapping,
 * no officer notices, no alerts. The notification policy stays SUPPRESSED.
 *
 * Only calls whose review is CLEAR are released, in batches; every flip is
 * logged so `unreleaseImportedCalls` can put them back.
 */
import type { PrismaClient } from '@/lib/prisma-generated'

import { NOTIFICATION_POLICY_SUPPRESSED, RELEASE_BATCH_SIZE, REVIEW_STATUS } from './constants'
import { refreshReviewStatus } from './service'

export async function releaseImportedCalls(input: {
  db: PrismaClient
  runId: string
  dryRun: boolean
  limit?: number
  log?: (m: string) => void
}): Promise<{ eligible: number; released: number; blocked: number }> {
  const { db } = input
  const log = input.log || (() => {})
  const run = await db.fundingImportRun.findUnique({ where: { id: input.runId } })
  if (!run || run.mode !== 'APPLY' || run.status !== 'COMPLETED') throw new Error(`Run ${input.runId} is not a completed APPLY run.`)
  const staged = await db.fundingCall.findMany({ where: { import_run_id: input.runId, catalog_status: 'STAGED' }, select: { id: true } })
  await refreshReviewStatus(db, input.runId, staged.map((c) => c.id))
  const eligible = await db.fundingCall.findMany({
    where: { import_run_id: input.runId, catalog_status: 'STAGED', review_status: REVIEW_STATUS.CLEAR },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: input.limit,
  })
  const blocked = staged.length - (await db.fundingCall.count({ where: { import_run_id: input.runId, catalog_status: 'STAGED', review_status: REVIEW_STATUS.CLEAR } }))
  log(`${staged.length} staged; ${eligible.length} releasable now; ${blocked} held for review.`)
  if (input.dryRun) return { eligible: eligible.length, released: 0, blocked }

  const releaseRun = await db.fundingImportRun.create({
    data: { source_key: run.source_key, mode: 'RELEASE', status: 'RUNNING', importer_version: run.importer_version, report: { parent_run_id: run.id } as any },
  })
  let released = 0
  try {
    for (let i = 0; i < eligible.length; i += RELEASE_BATCH_SIZE) {
      const ids = eligible.slice(i, i + RELEASE_BATCH_SIZE).map((c) => c.id)
      const now = new Date()
      await db.$transaction(async (tx) => {
        // Raw SQL: only rows this import created, still STAGED, still clear,
        // still suppressed. Anything a person changed meanwhile is skipped.
        const flipped = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE funding_calls
             SET catalog_status = 'PUBLISHED', status = 'PUBLISHED', is_active = true,
                 "publishedAt" = COALESCE("publishedAt", $2), "updatedAt" = $2
           WHERE id = ANY($1::text[]) AND import_run_id IS NOT NULL
             AND catalog_status::text = 'STAGED' AND review_status = '${REVIEW_STATUS.CLEAR}'
             AND notification_policy = '${NOTIFICATION_POLICY_SUPPRESSED}'
             AND visibility::text = 'GLOBAL_CATALOG'
           RETURNING id`,
          ids,
          now
        )
        if (flipped.length > 0) {
          await tx.fundingImportChange.createMany({
            data: flipped.map((row) => ({
              run_id: releaseRun.id,
              entity_table: 'funding_calls',
              entity_id: row.id,
              operation: 'UPDATE',
              field: 'catalog_status',
              before_value: 'STAGED' as any,
              after_value: 'PUBLISHED' as any,
            })),
          })
        }
        released += flipped.length
      }, { timeout: 120_000 })
      log(`  released ${released}/${eligible.length}`)
    }
    await db.fundingImportRun.update({ where: { id: releaseRun.id }, data: { status: 'COMPLETED', finished_at: new Date(), counts: { released, blocked } as any } })
  } catch (error) {
    await db.fundingImportRun.update({ where: { id: releaseRun.id }, data: { status: 'FAILED', finished_at: new Date(), error: String(error) } })
    throw error
  }
  return { eligible: eligible.length, released, blocked }
}
