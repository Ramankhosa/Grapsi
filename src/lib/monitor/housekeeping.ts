import { prisma } from '@/lib/prisma'

import { completeTaskInTx, withFence, type Lease } from './queue'
import { NOW_UTC } from './sqlTime'

/**
 * Daily retention for Source Watch's working tables.
 *
 * Safe to prune because no effect is guarded by these rows alone: operation
 * keys outlive their task rows in tombstones, handoffs and notifications have
 * their own unique keys, and versions a review pins are never deleted.
 */
export const RETENTION = {
  finishedTasksDays: 30,
  tombstonesDays: 180,
  stageCacheDays: 180,
  checkRunsDays: 180,
  attemptsDays: 365,
  dispatchedEventsDays: 90,
  heartbeatsDays: 7,
  /** Unpinned content versions kept per resource (newest first). */
  versionsPerResource: 10,
}

export async function runHousekeeping(lease: Lease): Promise<Record<string, number>> {
  const days = (n: number) => `${n} days`
  const counts: Record<string, number> = {}

  counts.tasks = await prisma.$executeRaw`
    DELETE FROM "monitor_tasks"
    WHERE "status" IN ('DONE', 'CANCELED') AND "finished_at" < ${NOW_UTC} - ${days(RETENTION.finishedTasksDays)}::interval`
  counts.tombstones = await prisma.$executeRaw`
    DELETE FROM "monitor_operation_tombstones" WHERE "completed_at" < ${NOW_UTC} - ${days(RETENTION.tombstonesDays)}::interval`
  counts.stageCache = await prisma.$executeRaw`
    DELETE FROM "monitor_stage_cache"
    WHERE COALESCE("last_hit_at", "created_at") < ${NOW_UTC} - ${days(RETENTION.stageCacheDays)}::interval`
  counts.checkRuns = await prisma.$executeRaw`
    DELETE FROM "monitor_check_runs" WHERE "started_at" < ${NOW_UTC} - ${days(RETENTION.checkRunsDays)}::interval`
  counts.attempts = await prisma.$executeRaw`
    DELETE FROM "monitor_llm_attempts"
    WHERE "settled_at" IS NOT NULL AND "created_at" < ${NOW_UTC} - ${days(RETENTION.attemptsDays)}::interval`
  counts.events = await prisma.$executeRaw`
    DELETE FROM "monitor_events"
    WHERE "dispatched_at" IS NOT NULL AND "dispatched_at" < ${NOW_UTC} - ${days(RETENTION.dispatchedEventsDays)}::interval`
  counts.heartbeats = await prisma.$executeRaw`
    DELETE FROM "monitor_worker_heartbeats" WHERE "last_beat_at" < ${NOW_UTC} - ${days(RETENTION.heartbeatsDays)}::interval`
  // Old content versions: keep the newest N per resource, the current one,
  // anything pinned by a review, and anything inside its retain_until.
  counts.versions = await prisma.$executeRaw`
    DELETE FROM "monitor_resource_versions" v
    USING (
      SELECT "id", row_number() OVER (PARTITION BY "resource_id" ORDER BY "fetched_at" DESC) AS rn
      FROM "monitor_resource_versions"
    ) ranked
    WHERE v."id" = ranked."id"
      AND ranked.rn > ${RETENTION.versionsPerResource}
      AND v."pin_refcount" = 0
      AND (v."retain_until" IS NULL OR v."retain_until" < ${NOW_UTC})
      AND NOT EXISTS (SELECT 1 FROM "monitor_resources" r WHERE r."current_version_id" = v."id")
      AND NOT EXISTS (SELECT 1 FROM "monitor_opportunity_evidence" e WHERE e."version_id" = v."id")`

  await withFence(lease, (tx) => completeTaskInTx(tx, lease, counts))
  return counts
}
