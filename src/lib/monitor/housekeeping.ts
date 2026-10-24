import { completeTaskInTx, withFence, type Lease } from './queue'
import { NOW_UTC } from './sqlTime'
import fs from 'node:fs/promises'
import path from 'node:path'

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
  return withFence(lease, async (tx) => {
  const days = (n: number) => `${n} days`
  const counts: Record<string, number> = {}

  counts.tasks = await tx.$executeRaw`
    DELETE FROM "monitor_tasks"
    WHERE "status" IN ('DONE', 'CANCELED') AND "finished_at" < ${NOW_UTC} - ${days(RETENTION.finishedTasksDays)}::interval`
  // Small identity/result rows remain durable: expiring a completed stage's
  // key or cache would let unchanged input incur a second paid request.
  counts.tombstones = 0
  counts.stageCache = 0
  counts.checkRuns = await tx.$executeRaw`
    DELETE FROM "monitor_check_runs" WHERE "started_at" < ${NOW_UTC} - ${days(RETENTION.checkRunsDays)}::interval`
  counts.attempts = await tx.$executeRaw`
    DELETE FROM "monitor_llm_attempts"
    WHERE "settled_at" IS NOT NULL AND "created_at" < ${NOW_UTC} - ${days(RETENTION.attemptsDays)}::interval`
  counts.events = await tx.$executeRaw`
    DELETE FROM "monitor_events"
    WHERE "dispatched_at" IS NOT NULL AND "dispatched_at" < ${NOW_UTC} - ${days(RETENTION.dispatchedEventsDays)}::interval`
  counts.heartbeats = await tx.$executeRaw`
    DELETE FROM "monitor_worker_heartbeats" WHERE "last_beat_at" < ${NOW_UTC} - ${days(RETENTION.heartbeatsDays)}::interval`
  // Old content versions: keep the newest N per resource, the current one,
  // anything pinned by a review, and anything inside its retain_until.
  counts.versions = await tx.$executeRaw`
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

  const root = path.resolve(process.env.MONITOR_STORAGE_ROOT ?? path.join(process.cwd(), 'storage', 'source-watch'))
  let removed = 0
  const files = await fs.readdir(root).catch(() => [] as string[])
  for (const name of files.filter(n => /^[a-f0-9]{64}\.(pdf|docx)$/.test(n)).slice(0, 500)) {
    const file = path.join(root, name)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${file}, 0))`
    if (await tx.monitorResourceVersion.findFirst({ where: { file_path: file }, select: { id: true } })) continue
    const stat = await fs.stat(file).catch(() => null)
    if (stat && stat.mtimeMs < Date.now() - 7 * 86400_000) { await fs.unlink(file).catch(() => undefined); removed += 1 }
  }
  counts.orphanFiles = removed
  await completeTaskInTx(tx, lease, counts)
  return counts
  })
}
