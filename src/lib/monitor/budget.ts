import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/prisma-generated'

import { startOfIstDay } from './schedule'
import { NOW_UTC } from './sqlTime'
import { LeaseLostError } from './queue'

function dateLiteral(day: Date): string {
  return day.toISOString().slice(0, 10)
}

/**
 * Attempt-level spend accounting (C2).
 *
 * Every paid provider attempt reserves its conservative MAXIMUM cost before
 * it is dispatched, atomically across every scope it draws on (platform-wide,
 * the site, and the bootstrap allowance when it is backlog work). If any scope
 * lacks room, nothing is reserved and the work is deferred — never dropped.
 * Settlement replaces the reservation with the actual cost, idempotently per
 * attempt. An attempt whose outcome is unknown (timeout, crash after
 * dispatch) stays reserved and is booked at its maximum after 24 hours. A
 * reservation belongs to the IST day it was made; settling it later never
 * charges a different day.
 */

const USD = 1_000_000 // micro-USD per dollar

function dollars(env: string | undefined, fallback: number): bigint {
  const value = Number(env)
  return BigInt(Math.round((Number.isFinite(value) && value >= 0 ? value : fallback) * USD))
}

export function budgetLimits() {
  return {
    platform: dollars(process.env.MONITOR_DAILY_BUDGET_USD, 2),
    site: dollars(process.env.MONITOR_SITE_DAILY_BUDGET_USD, 0.25),
    bootstrap: dollars(process.env.MONITOR_BOOTSTRAP_DAILY_BUDGET_USD, 1),
  }
}

/** The ledger day (IST calendar day) as a UTC-midnight date for @db.Date. */
export function ledgerDay(now = new Date()): Date {
  const ist = new Date(startOfIstDay(now).getTime() + 6 * 3_600_000)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()))
}

/** When today's IST budget day ends. */
export function nextBudgetDay(now = new Date()): Date {
  return new Date(startOfIstDay(now).getTime() + 24 * 3_600_000 + 60_000)
}

export class BudgetExceededError extends Error {
  readonly scope: string
  readonly retryAt: Date
  constructor(scope: string, retryAt: Date) {
    super(`Daily budget for ${scope} is used up; deferred to ${retryAt.toISOString()}`)
    this.name = 'BudgetExceededError'
    this.scope = scope
    this.retryAt = retryAt
  }
}

export function siteScope(siteId: string): string {
  return `SITE:${siteId}`
}

async function limitFor(tx: Prisma.TransactionClient, scope: string): Promise<bigint> {
  const limits = budgetLimits()
  if (scope === 'PLATFORM') return limits.platform
  if (scope === 'BOOTSTRAP') return limits.bootstrap
  if (scope.startsWith('SITE:')) {
    const site = await tx.monitorSite.findUnique({ where: { id: scope.slice(5) }, select: { daily_budget_micros: true } })
    return site?.daily_budget_micros ?? limits.site
  }
  return 0n
}

export interface PriceSnapshot {
  modelCode: string
  inputCentsPer1M: number
  outputCentsPer1M: number
}

/** Token cost in micro-USD from cents per million tokens (rounded up). */
export function tokenMicros(tokens: number, centsPer1M: number): bigint {
  if (tokens <= 0 || centsPer1M <= 0) return 0n
  return BigInt(Math.ceil((tokens * centsPer1M) / 100))
}

export async function priceFor(modelCode: string): Promise<PriceSnapshot> {
  const model = await prisma.lLMModel.findFirst({
    where: { code: modelCode },
    select: { code: true, inputCostPer1M: true, outputCostPer1M: true },
  })
  if (!model) throw new Error(`No price is recorded for model ${modelCode}`)
  return { modelCode: model.code, inputCentsPer1M: model.inputCostPer1M, outputCentsPer1M: model.outputCostPer1M }
}

export interface ReserveInput {
  operationKey: string
  attemptNo: number
  stage: string
  model: string
  provider: string
  price: PriceSnapshot
  reservedMaxMicros: bigint
  scopes: string[]
  taskId?: string | null
  leaseGeneration?: number | null
  memberKeys?: string[]
  memberAttemptLimit?: number
}
export class MemberAttemptLimitError extends Error {
  constructor() { super('This unchanged item has used its paid attempt allowance; deliberate replay is required'); this.name = 'MemberAttemptLimitError' }
}

/** Reserve one attempt's maximum across all scopes, or reserve nothing. */
export async function reserveAttempt(input: ReserveInput, now = new Date()): Promise<string> {
  if (input.reservedMaxMicros <= 0n) throw new Error('A positive priced reservation is required')
  if (!input.scopes.includes('PLATFORM')) throw new Error('Every paid attempt requires the platform budget')
  const scopes = [...new Set(input.scopes)].sort()
  const day = ledgerDay(now)
  return prisma.$transaction(async (tx) => {
    if (input.taskId) {
      const held = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "monitor_tasks"
        WHERE "id" = ${input.taskId} AND "lease_generation" = ${input.leaseGeneration}
          AND "status" = 'RUNNING' AND "lease_until" > ${NOW_UTC} FOR UPDATE`
      if (!held.length) throw new LeaseLostError(input.taskId, input.leaseGeneration ?? 0)
    }
    for (const key of [...new Set(input.memberKeys ?? [])].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`paid-member:${key}`}, 0))`
      const attempts = await tx.monitorLlmAttempt.count({ where: { price_snapshot: { path: ['memberKeys'], array_contains: [key] } } })
      if (attempts >= (input.memberAttemptLimit ?? 3)) throw new MemberAttemptLimitError()
    }
    for (const scope of scopes) {
      const limit = await limitFor(tx, scope)
      await tx.monitorBudgetLedger.upsert({
        where: { day_scope: { day, scope } },
        create: { day, scope, limit_micros: limit },
        update: { limit_micros: limit },
      })
      // Conditional increment: concurrent reservations serialise on the row,
      // and the second re-checks the limit against the first's commit.
      const updated = await tx.$executeRaw`
        UPDATE "monitor_budget_ledger"
        SET "reserved_micros" = "reserved_micros" + ${input.reservedMaxMicros}, "updated_at" = ${NOW_UTC}
        WHERE "day" = ${dateLiteral(day)}::date AND "scope" = ${scope}
          AND "reserved_micros" + "settled_micros" + ${input.reservedMaxMicros} <= "limit_micros"
      `
      if (updated === 0) throw new BudgetExceededError(scope, nextBudgetDay(now))
    }
    const attempt = await tx.monitorLlmAttempt.create({
      data: {
        operation_key: input.operationKey,
        attempt_no: input.attemptNo,
        stage: input.stage,
        model: input.model,
        provider: input.provider,
        provider_account: input.provider,
        price_snapshot: { ...input.price, memberKeys: input.memberKeys ?? [] } as unknown as Prisma.InputJsonObject,
        reserved_max_micros: input.reservedMaxMicros,
        ledger_day: day,
        ledger_scopes: scopes,
        status: 'RESERVED',
        task_id: input.taskId ?? null,
        lease_generation: input.leaseGeneration ?? null,
      },
      select: { id: true },
    })
    return attempt.id
  })
}

export async function markDispatched(attemptId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const attempt = await tx.monitorLlmAttempt.findUniqueOrThrow({ where: { id: attemptId } })
    if (attempt.status !== 'RESERVED') throw new Error('A paid attempt may only be dispatched once')
    if (attempt.task_id) {
      const held = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "monitor_tasks"
        WHERE "id" = ${attempt.task_id} AND "lease_generation" = ${attempt.lease_generation}
          AND "status" = 'RUNNING' AND "lease_until" > ${NOW_UTC} FOR UPDATE`
      if (!held.length) throw new LeaseLostError(attempt.task_id, attempt.lease_generation ?? 0)
    }
    const claimed = await tx.monitorLlmAttempt.updateMany({ where: { id: attemptId, status: 'RESERVED' }, data: { status: 'DISPATCHED', dispatched_at: new Date() } })
    if (claimed.count !== 1) throw new Error('Paid attempt already dispatched')
  })
}

export type SettledStatus = 'SUCCEEDED' | 'FAILED_BILLABLE' | 'FAILED_UNBILLED'

/**
 * Replace an attempt's reservation with its actual cost. Idempotent: an
 * attempt is settled once (settled_at), whoever gets there first.
 */
export async function settleAttempt(
  attemptId: string,
  outcome: {
    status: SettledStatus
    actualMicros: bigint
    usage?: Record<string, unknown>
    requestId?: string | null
    errorClass?: string | null
    errorMessage?: string | null
  }
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.monitorLlmAttempt.updateMany({
      where: { id: attemptId, settled_at: null },
      data: {
        status: outcome.status,
        actual_cost_micros: outcome.actualMicros,
        usage: (outcome.usage ?? undefined) as Prisma.InputJsonObject | undefined,
        request_id: outcome.requestId ?? undefined,
        error_class: outcome.errorClass ?? null,
        error_message: outcome.errorMessage?.slice(0, 1000) ?? null,
        settled_at: new Date(),
      },
    })
    if (claimed.count === 0) return false
    const attempt = await tx.monitorLlmAttempt.findUniqueOrThrow({ where: { id: attemptId } })
    for (const scope of attempt.ledger_scopes) {
      await tx.$executeRaw`
        UPDATE "monitor_budget_ledger"
        SET "reserved_micros" = GREATEST(0, "reserved_micros" - ${attempt.reserved_max_micros}),
            "settled_micros" = "settled_micros" + ${outcome.actualMicros},
            "updated_at" = ${NOW_UTC}
        WHERE "day" = ${dateLiteral(attempt.ledger_day)}::date AND "scope" = ${scope}
      `
    }
    return true
  })
}

/** The outcome is unknown (timeout after dispatch): keep the reservation. */
export async function markUncertain(attemptId: string, errorMessage: string, receipt?: {usage: Record<string,unknown>;requestId?:string}): Promise<void> {
  await prisma.monitorLlmAttempt.updateMany({
    where: { id: attemptId, settled_at: null },
    data: { status: 'UNCERTAIN', error_class: 'UNCERTAIN', error_message: errorMessage.slice(0, 1000),usage:receipt?.usage as Prisma.InputJsonObject|undefined,request_id:receipt?.requestId },
  })
}

/**
 * Crash and ambiguity recovery, run by the planner: an attempt left DISPATCHED
 * (its worker died) becomes UNCERTAIN; an UNCERTAIN attempt older than 24 h is
 * booked at its full reserved maximum — the conservative assumption.
 */
export async function recoverAttempts(now = new Date()): Promise<{ uncertain: number; booked: number }> {
  const stale = new Date(now.getTime() - 30 * 60 * 1000)
  const marked = await prisma.monitorLlmAttempt.updateMany({
    where: { status: { in: ['RESERVED', 'DISPATCHED'] }, settled_at: null, created_at: { lt: stale } },
    data: { status: 'UNCERTAIN', error_class: 'UNCERTAIN', error_message: 'worker stopped before the attempt settled' },
  })
  const old = await prisma.monitorLlmAttempt.findMany({
    where: { status: 'UNCERTAIN', settled_at: null, created_at: { lt: new Date(now.getTime() - 24 * 3_600_000) } },
    select: { id: true, reserved_max_micros: true },
    take: 500,
  })
  let booked = 0
  for (const attempt of old) {
    const done = await settleAttempt(attempt.id, {
      status: 'FAILED_BILLABLE',
      actualMicros: attempt.reserved_max_micros,
      errorClass: 'UNCERTAIN',
      errorMessage: 'outcome never confirmed; booked at the reserved maximum',
    })
    if (done) booked += 1
  }
  return { uncertain: marked.count, booked }
}
