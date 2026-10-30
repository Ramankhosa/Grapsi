import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/prisma-generated'

import { pipelinePaused } from './pipelineSwitch'
import { NOW_UTC, msInterval, utc } from './sqlTime'

/**
 * Source Watch's durable queue, which is also its outbox.
 *
 * Operation keys are defined PER KIND (see `operationKeys`), because the same
 * rule cannot serve both recurring and deterministic work:
 * - a check is one scheduled occurrence: two unchanged checks of a page are two
 *   occurrences and must both run, so the key carries a generation counter;
 * - a stage computation is keyed by its input fingerprint, so identical input
 *   runs once and is reused;
 * - a handoff is one review revision's intended action;
 * - a notification is one event × recipient × channel.
 * An ordinary retry reuses its key. A deliberate new occurrence gets a new one.
 *
 * Every claim increments `lease_generation`. Effects are written through
 * `withFence`, which re-checks generation, RUNNING state and lease expiry
 * under a row lock in the same transaction, so a worker whose lease was
 * reclaimed cannot commit anything — not domain rows, not downstream tasks,
 * not a handoff record. Completed keys are tombstoned so pruning task rows can
 * never let an effect run twice.
 */

export type TaskKind =
  | 'CHECK_SOURCE'
  | 'REVISIT'
  | 'DISCOVER_SITE'
  | 'PARSE'
  | 'TRIAGE'
  | 'EXTRACT'
  | 'EMBED'
  | 'HANDOFF'
  | 'NOTIFY'
  | 'REFRESH_URL_INDEX'
  | 'HOUSEKEEPING'

export type TaskStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED_PERMANENT'
  | 'DEAD'
  | 'DEFERRED_BUDGET'
  | 'PAUSED_PROVIDER'
  | 'CANCELED'

export const operationKeys = {
  check: (sourceId: string, generation: number) => `check:${sourceId}:${generation}`,
  revisit: (resourceId: string, generation: number) => `revisit:${resourceId}:${generation}`,
  discover: (siteId: string, generation: number) => `discover:${siteId}:${generation}`,
  stage: (stage: 'PARSE' | 'TRIAGE' | 'EXTRACT' | 'EMBED', inputFingerprint: string) =>
    `${stage.toLowerCase()}:${inputFingerprint}`,
  handoff: (opportunityId: string, reviewRevision: number, action: 'DRAFT' | 'UPDATE') =>
    `handoff:${opportunityId}:${reviewRevision}:${action}`,
  notify: (eventId: string, recipientUserId: string, channel: 'IN_APP' | 'EMAIL') =>
    `notify:${eventId}:${recipientUserId}:${channel}`,
  urlIndex: (slot: string) => `url-index:${slot}`,
  housekeeping: (day: string) => `housekeeping:${day}`,
}

/**
 * Priorities: lower runs first. A task waiting more than 6 hours is treated as
 * 30 at most, so a backlog runs oldest-first. EXTRACT sits below that line: it
 * is the step that turns a found call into a draft, and behind an aged backlog
 * of screening it barely ran (3 in a day on 30 Oct 2026, 193 waiting).
 */
export const PRIORITY = { URGENT: 10, CHECK_NOW: 20, EXTRACT: 25, NORMAL: 100, BACKGROUND: 200 } as const

export const DEFAULT_LEASE_MS = 2 * 60 * 1000

export type Db = Prisma.TransactionClient | typeof prisma

export interface Lease {
  taskId: string
  generation: number
  owner: string
  kind: TaskKind
  operationKey: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
  siteId: string | null
  sourceId: string | null
  resourceId: string | null
}

export class LeaseLostError extends Error {
  constructor(taskId: string, generation: number) {
    super(`Lease on task ${taskId} (generation ${generation}) is no longer held`)
    this.name = 'LeaseLostError'
  }
}

export interface EnqueueInput {
  kind: TaskKind
  operationKey: string
  payload: Record<string, unknown>
  priority?: number
  siteId?: string | null
  sourceId?: string | null
  resourceId?: string | null
  opportunityId?: string | null
  availableAt?: Date
  maxAttempts?: number
}

/**
 * Insert a task unless its key already exists or was already completed. Safe
 * inside a fenced transaction, which is how downstream work is enqueued
 * atomically with the writes that justify it.
 */
export async function enqueueTask(db: Db, input: EnqueueInput): Promise<{ id: string | null; created: boolean }> {
  const tombstone = await db.monitorOperationTombstone.findUnique({ where: { operation_key: input.operationKey } })
  if (tombstone) return { id: tombstone.task_id, created: false }

  const id = randomUUID()
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "monitor_tasks"
      ("id", "kind", "operation_key", "payload", "priority", "site_id", "source_id", "resource_id",
       "opportunity_id", "available_at", "max_attempts", "created_at", "updated_at")
    VALUES
      (${id}, ${input.kind}, ${input.operationKey}, ${JSON.stringify(input.payload)}::jsonb,
       ${input.priority ?? PRIORITY.NORMAL}, ${input.siteId ?? null}, ${input.sourceId ?? null},
       ${input.resourceId ?? null}, ${input.opportunityId ?? null},
       ${input.availableAt ? utc(input.availableAt) : NOW_UTC},
       ${input.maxAttempts ?? 5}, ${NOW_UTC}, ${NOW_UTC})
    ON CONFLICT ("operation_key") DO NOTHING
    RETURNING "id"
  `
  if (rows.length > 0) return { id: rows[0].id, created: true }
  const existing = await db.monitorTask.findUnique({ where: { operation_key: input.operationKey }, select: { id: true } })
  return { id: existing?.id ?? null, created: false }
}

type ClaimedRow = {
  id: string
  kind: string
  operation_key: string
  payload: unknown
  attempts: number
  max_attempts: number
  lease_generation: number
  site_id: string | null
  source_id: string | null
  resource_id: string | null
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string }; message?: string }
  return e?.meta?.code === '23505' || e?.code === '23505' || /23505|unique constraint/i.test(e?.message ?? '')
}

/**
 * Claim the next runnable task. One running task per site at a time — that
 * is both politeness and fairness: a large portal can never occupy every
 * worker slot. The partial unique index `monitor_tasks_one_running_per_site`
 * enforces it; the query below only avoids colliding in the common case, and
 * a collision under a race is retried as "that site is busy". Tasks for sites
 * that are not ACTIVE wait; their executor cancels them if the site stays off.
 */
export async function claimNextTask(options: {
  owner: string
  kinds?: TaskKind[]
  leaseMs?: number
}): Promise<Lease | null> {
  // The master switch is off: idle, keeping every queued task for later.
  if (await pipelinePaused()) return null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await claimOnce(options)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Another claimer took this site's slot between our check and update.
    }
  }
  return null
}

async function claimOnce(options: { owner: string; kinds?: TaskKind[]; leaseMs?: number }): Promise<Lease | null> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const kinds = options.kinds ?? null

  // Expired leases that have used their attempts go to the dead letters
  // instead of being reclaimed forever.
  await prisma.$executeRaw`
    UPDATE "monitor_tasks"
    SET "status" = 'DEAD', "terminal_reason" = 'lease expired after the last attempt',
        "finished_at" = ${NOW_UTC}, "updated_at" = ${NOW_UTC}
    WHERE "status" = 'RUNNING' AND "lease_until" < ${NOW_UTC} AND "attempts" >= "max_attempts"
  `

  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    WITH candidate AS (
      SELECT t."id"
      FROM "monitor_tasks" t
      LEFT JOIN "monitor_sites" s ON s."id" = t."site_id"
      WHERE (
          (t."status" IN ('QUEUED', 'DEFERRED_BUDGET', 'PAUSED_PROVIDER') AND t."available_at" <= ${NOW_UTC})
          OR (t."status" = 'RUNNING' AND t."lease_until" < ${NOW_UTC})
        )
        AND (${kinds}::text[] IS NULL OR t."kind" = ANY(${kinds}::text[]))
        AND (t."site_id" IS NULL OR s."status" = 'ACTIVE')
        -- A site with any other RUNNING task is busy, even if that task's
        -- lease expired: it is reclaimed itself rather than run beside.
        AND (
          t."site_id" IS NULL OR NOT EXISTS (
            SELECT 1 FROM "monitor_tasks" r
            WHERE r."site_id" = t."site_id" AND r."status" = 'RUNNING' AND r."id" <> t."id"
          )
        )
      ORDER BY CASE WHEN t."created_at" < ${NOW_UTC} - interval '6 hours' THEN LEAST(t."priority",30) ELSE t."priority" END ASC, t."available_at" ASC
      LIMIT 1
      FOR UPDATE OF t SKIP LOCKED
    )
    UPDATE "monitor_tasks" t
    SET "status" = 'RUNNING',
        "lease_generation" = t."lease_generation" + 1,
        "lease_owner" = ${options.owner},
        "lease_until" = ${NOW_UTC} + ${msInterval(leaseMs)},
        "heartbeat_at" = ${NOW_UTC},
        "attempts" = t."attempts" + 1,
        "started_at" = COALESCE(t."started_at", ${NOW_UTC}),
        "updated_at" = ${NOW_UTC}
    FROM candidate
    WHERE t."id" = candidate."id"
    RETURNING t."id", t."kind", t."operation_key", t."payload", t."attempts", t."max_attempts",
              t."lease_generation", t."site_id", t."source_id", t."resource_id"
  `
  const row = rows[0]
  if (!row) return null
  return {
    taskId: row.id,
    generation: row.lease_generation,
    owner: options.owner,
    kind: row.kind as TaskKind,
    operationKey: row.operation_key,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    siteId: row.site_id,
    sourceId: row.source_id,
    resourceId: row.resource_id,
  }
}

/**
 * Run `fn` in a transaction that first proves this lease is still held. If the
 * task was reclaimed (generation moved, lease expired, state changed), nothing
 * in `fn` commits.
 */
export async function withFence<T>(lease: Lease, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const held = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "monitor_tasks"
        WHERE "id" = ${lease.taskId}
          AND "lease_generation" = ${lease.generation}
          AND "status" = 'RUNNING'
          AND "lease_until" > ${NOW_UTC}
        FOR UPDATE
      `
      if (held.length === 0) throw new LeaseLostError(lease.taskId, lease.generation)
      return fn(tx)
    },
    { timeout: 60_000, maxWait: 15_000 }
  )
}

/** Extend the lease; false means it was lost and in-flight work must stop. */
export async function heartbeat(lease: Lease, leaseMs = DEFAULT_LEASE_MS): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE "monitor_tasks"
    SET "lease_until" = ${NOW_UTC} + ${msInterval(leaseMs)}, "heartbeat_at" = ${NOW_UTC}, "updated_at" = ${NOW_UTC}
    WHERE "id" = ${lease.taskId} AND "lease_generation" = ${lease.generation} AND "status" = 'RUNNING'
      AND "lease_until" > ${NOW_UTC}
  `
  return updated > 0
}

/** Mark DONE and tombstone the key — call inside the final fenced transaction. */
export async function completeTaskInTx(tx: Prisma.TransactionClient, lease: Lease, result: unknown): Promise<void> {
  await tx.monitorTask.update({
    where: { id: lease.taskId },
    data: {
      status: 'DONE',
      result: (result ?? {}) as object,
      finished_at: new Date(),
      lease_until: null,
      last_error: null,
    },
  })
  await tx.monitorOperationTombstone.upsert({
    where: { operation_key: lease.operationKey },
    create: { operation_key: lease.operationKey, kind: lease.kind, task_id: lease.taskId },
    update: {},
  })
}

export async function completeTask(lease: Lease, result: unknown): Promise<void> {
  await withFence(lease, (tx) => completeTaskInTx(tx, lease, result))
}

const BACKOFF_BASE_MS = 60_000
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000

export function backoffMs(attempts: number, random = Math.random): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1))
  return Math.round(exp * (0.8 + random() * 0.4))
}

export interface TaskFailure {
  message: string
  retryable: boolean
  retryAt?: Date
}

/**
 * Record a failure: retry with backoff, or DEAD after the last attempt, or
 * FAILED_PERMANENT. `alsoInTx` writes the domain side (failure counters, the
 * check run) under the same fence.
 */
export async function failTask(
  lease: Lease,
  failure: TaskFailure,
  alsoInTx?: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<TaskStatus> {
  return withFence(lease, async (tx) => {
    if (alsoInTx) await alsoInTx(tx)
    const message = failure.message.slice(0, 1000)
    if (failure.retryable && lease.attempts < lease.maxAttempts) {
      await tx.monitorTask.update({
        where: { id: lease.taskId },
        data: {
          status: 'QUEUED',
          available_at: failure.retryAt ?? new Date(Date.now() + backoffMs(lease.attempts)),
          lease_until: null,
          last_error: message,
        },
      })
      return 'QUEUED'
    }
    const status: TaskStatus = failure.retryable ? 'DEAD' : 'FAILED_PERMANENT'
    await tx.monitorTask.update({
      where: { id: lease.taskId },
      data: {
        status,
        terminal_reason: failure.retryable ? 'retries exhausted' : 'permanent failure',
        finished_at: new Date(),
        lease_until: null,
        last_error: message,
      },
    })
    return status
  })
}

/**
 * Put the task back without spending an attempt: the host asked us to wait,
 * the budget is exhausted, or the provider is paused. A deferral is never a
 * failure.
 */
export async function deferTask(
  lease: Lease,
  until: Date,
  reason: string,
  status: Extract<TaskStatus, 'QUEUED' | 'DEFERRED_BUDGET' | 'PAUSED_PROVIDER'> = 'QUEUED',
  alsoInTx?: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> {
  await withFence(lease, async (tx) => {
    if (alsoInTx) await alsoInTx(tx)
    await tx.monitorTask.update({
      where: { id: lease.taskId },
      data: {
        status,
        available_at: until,
        attempts: { decrement: 1 },
        lease_until: null,
        last_error: reason.slice(0, 1000),
      },
    })
  })
}

export async function cancelTask(
  lease: Lease,
  reason: string,
  alsoInTx?: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> {
  await withFence(lease, async (tx) => {
    if (alsoInTx) await alsoInTx(tx)
    await tx.monitorTask.update({
      where: { id: lease.taskId },
      data: { status: 'CANCELED', terminal_reason: reason.slice(0, 500), finished_at: new Date(), lease_until: null },
    })
  })
}

/**
 * Deliberate re-run, distinct from a retry:
 * - a DONE task gets a NEW row keyed `<key>:replay:<n>` (its effect already
 *   happened once; the replay is a recorded, separate occurrence);
 * - a DEAD or FAILED_PERMANENT task is reset in place, attempts cleared.
 */
export async function replayTask(taskId: string, reason: string): Promise<{ taskId: string; mode: 'new-row' | 'reset' }> {
  const task = await prisma.monitorTask.findUnique({ where: { id: taskId } })
  if (!task) throw new Error('Task not found')
  if (task.status === 'DONE') {
    const replays = await prisma.monitorTask.count({ where: { replay_of: task.id } })
    const created = await enqueueTask(prisma, {
      kind: task.kind as TaskKind,
      operationKey: `${task.operation_key}:replay:${replays + 1}`,
      payload: (task.payload ?? {}) as Record<string, unknown>,
      priority: task.priority,
      siteId: task.site_id,
      sourceId: task.source_id,
      resourceId: task.resource_id,
      opportunityId: task.opportunity_id,
      maxAttempts: task.max_attempts,
    })
    if (!created.id) throw new Error('Replay could not be queued')
    await prisma.monitorTask.update({ where: { id: created.id }, data: { replay_of: task.id, replay_reason: reason } })
    return { taskId: created.id, mode: 'new-row' }
  }
  if (task.status === 'DEAD' || task.status === 'FAILED_PERMANENT' || task.status === 'CANCELED') {
    await prisma.monitorTask.update({
      where: { id: task.id },
      data: {
        status: 'QUEUED',
        attempts: 0,
        available_at: new Date(),
        terminal_reason: null,
        last_error: null,
        finished_at: null,
        replay_reason: reason,
      },
    })
    return { taskId: task.id, mode: 'reset' }
  }
  throw new Error(`A ${task.status} task cannot be replayed`)
}
