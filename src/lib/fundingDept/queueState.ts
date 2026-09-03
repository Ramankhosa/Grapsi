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
