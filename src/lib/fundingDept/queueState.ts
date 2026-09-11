import { Prisma } from '@/lib/prisma-generated'

/**
 * Where one call stands for one school — the four states of the queue.
 *
 * A precedence ladder, not four independent tests. The first version of the
 * queue defined `pending` and `shortlisted` separately, so a shortlisted call
 * with nobody on it satisfied both, appeared under two tabs, and the counts did
 * not add up to the total. Each predicate below excludes everything above it,
 * so a call lands in exactly one state and the counts partition the open set.
 *
 *   dismissed   the school said "not ours"
 *   assigned    someone in the school is on it (any live assignment)
 *   shortlisted the school flagged it but nobody is on it yet
 *   pending     open, relevant, untouched — the number to drive to zero
 *
 * Creating an assignment needs no triage write: `assigned` outranks
 * `shortlisted` by construction.
 *
 * Shared by the queue endpoint and the school funnel so a head's "pending"
 * count for a school and the officer's own tab can never disagree.
 */

export const QUEUE_STATES = ['pending', 'shortlisted', 'assigned', 'dismissed'] as const
export type QueueState = (typeof QUEUE_STATES)[number]

export interface QueueStateSql {
  pending: Prisma.Sql
  shortlisted: Prisma.Sql
  assigned: Prisma.Sql
  dismissed: Prisma.Sql
}

/**
 * @param liveAssignments  a scalar subquery yielding the count of live
 *                         assignments for the call inside the school's subtree
 * @param triageAlias      alias of the LEFT-JOINed call_school_triage row
 */
export function queueStateSql(liveAssignments: Prisma.Sql, triageAlias = 'tri'): QueueStateSql {
  const status = Prisma.raw(`COALESCE(${triageAlias}.status, 'NEW')`)

  const dismissed = Prisma.sql`${status} = 'NOT_RELEVANT'`
  const assigned = Prisma.sql`(${status} <> 'NOT_RELEVANT' AND ${liveAssignments} > 0)`
  const shortlisted = Prisma.sql`(${status} = 'SHORTLISTED' AND ${liveAssignments} = 0)`
  const pending = Prisma.sql`(${status} NOT IN ('NOT_RELEVANT', 'SHORTLISTED') AND ${liveAssignments} = 0)`

  return { pending, shortlisted, assigned, dismissed }
}

/**
 * The same ladder evaluated in TypeScript, for callers that already hold the
 * two facts and for the unit test that proves the SQL and this agree.
 */
export function queueStateFor(triageStatus: string | null | undefined, liveAssignments: number): QueueState {
  const status = triageStatus || 'NEW'
  if (status === 'NOT_RELEVANT') return 'dismissed'
  if (liveAssignments > 0) return 'assigned'
  if (status === 'SHORTLISTED') return 'shortlisted'
  return 'pending'
}

/* -------------------------------------------------------------------------- */
/* Untouched: pending for long enough that nobody can call it new             */
/* -------------------------------------------------------------------------- */

/**
 * Whether a relevant call has been sitting in a school with nobody on it and
 * nobody looking at it.
 *
 * This lived in two places with two different definitions. The funnel asked
 * "has anyone logged contact", ignoring triage entirely; the ledger asked "does
 * a triage row exist", ignoring its contents. A call marked IN_REVIEW with no
 * note counted as untouched in one number and not the other, and a head read
 * both on adjacent screens.
 *
 * The agreed definition, and the reason for each clause:
 *
 *   pending            somebody already on it, shortlisted or dismissed is not
 *                      a pendency — the ladder above decides which
 *   no triage DECISION `decided_at IS NULL`, never row existence. The pendency
 *                      sweep creates rows to hold its escalation stamp, and a
 *                      stamp is not a decision. Testing existence would have let
 *                      the sweep erase the backlog it exists to report
 *   no contact         a call-level note against the school counts, which is
 *                      exactly the early chasing that happens before anyone is
 *                      assigned
 *   old enough         published this morning is not neglect
 */
export interface UntouchedInput {
  queueState: QueueState
  /** When a human recorded a triage decision, not when the row appeared. */
  triageDecidedAt: Date | string | null | undefined
  /** Most recent follow-up on this call in this school, of any kind. */
  lastActionAt: Date | string | null | undefined
  /** Whole days since the call entered the system. Null when that is unknown. */
  daysSinceEntered: number | null
  untouchedDays: number
}

export function isCallUntouched(input: UntouchedInput): boolean {
  if (input.queueState !== 'pending') return false
  if (input.triageDecidedAt) return false
  if (input.lastActionAt) return false
  return (input.daysSinceEntered ?? 0) >= input.untouchedDays
}

/**
 * The same predicate in SQL.
 *
 * `contactExists` is supplied by the caller because the join differs: the funnel
 * matches follow-ups on (call, unit subtree), while a ledger also reaches them
 * through the assignment. Everything else is fixed here so the four clauses
 * cannot drift apart again.
 */
export function untouchedSql(options: {
  /** The `pending` fragment from `queueStateSql`. */
  pending: Prisma.Sql
  /** Alias of the LEFT-JOINed call_school_triage row. */
  triageAlias?: string
  /** Expression yielding when the call entered the system. */
  enteredAt: Prisma.Sql
  /** Correlated EXISTS(...) for any follow-up on this call in this school. */
  contactExists: Prisma.Sql
  untouchedDays: number
}): Prisma.Sql {
  const alias = options.triageAlias || 'tri'
  // An interval literal cannot be parameterised, and a bound integer arrives as
  // bigint which make_interval() rejects. This value reaches us from tenant
  // settings, so it is forced to a bounded integer before interpolation rather
  // than trusted to have been validated upstream.
  const days = Math.min(Math.max(Math.round(Number(options.untouchedDays) || 0), 0), 3650)
  return Prisma.sql`(
    ${options.pending}
    AND ${Prisma.raw(alias)}.decided_at IS NULL
    AND ${options.enteredAt} < now() - ${Prisma.raw(`INTERVAL '${days} days'`)}
    AND NOT ${options.contactExists}
  )`
}
