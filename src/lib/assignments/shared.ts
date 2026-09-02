/**
 * Shared shapes for the funding call assignment routes.
 *
 * These live outside the route files because Next.js App Router only permits
 * HTTP handlers and a fixed set of config exports from a `route.ts`.
 */
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'

/** Listed in lifecycle order, matching the Postgres enum's declaration order. */
export const ASSIGNMENT_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'DECLINED',
] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/** Statuses that still represent work in hand, for buckets and reminders. */
export const OPEN_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
]

type TransitionActor = 'assignee' | 'manager' | 'either'

/**
 * Who may move an assignment from one status to another.
 *
 * Accepting and declining are the faculty member's answer to a request, so no
 * amount of managerial authority can supply them — a department that could
 * accept on someone's behalf would be recording agreement that never happened.
 * Everything a manager does instead (cancel, re-request, re-open) leaves the
 * answer visibly theirs.
 */
const TRANSITIONS: Record<AssignmentStatus, Partial<Record<AssignmentStatus, TransitionActor>>> = {
  ASSIGNED: {
    ACCEPTED: 'assignee',
    DECLINED: 'assignee',
    // Starting work without clicking accept is an implicit acceptance.
    IN_PROGRESS: 'either',
    COMPLETED: 'either',
    CANCELLED: 'manager',
  },
  ACCEPTED: {
    IN_PROGRESS: 'either',
    COMPLETED: 'either',
    DECLINED: 'assignee',
    CANCELLED: 'manager',
    // Same reset a manager has from IN_PROGRESS: put the request back to
    // unanswered, e.g. after the scope of the call changed.
    ASSIGNED: 'manager',
  },
  IN_PROGRESS: {
    COMPLETED: 'either',
    CANCELLED: 'manager',
    ASSIGNED: 'manager',
  },
  COMPLETED: {
    // Re-opening a submission that turned out to be wrong.
    IN_PROGRESS: 'either',
    ASSIGNED: 'manager',
    CANCELLED: 'manager',
  },
  CANCELLED: {
    ASSIGNED: 'manager',
  },
  DECLINED: {
    // Re-request: asking the same person again after a conversation.
    ASSIGNED: 'manager',
    CANCELLED: 'manager',
  },
}

export interface TransitionCheck {
  allowed: boolean
  reason?: string
}

export function validateStatusTransition(input: {
  from: AssignmentStatus
  to: AssignmentStatus
  isAssignee: boolean
  canManage: boolean
}): TransitionCheck {
  const { from, to, isAssignee, canManage } = input
  if (from === to) {
    return { allowed: true }
  }

  const actor = TRANSITIONS[from]?.[to]
  if (!actor) {
    return {
      allowed: false,
      reason: `An assignment cannot go from ${humanStatus(from)} to ${humanStatus(to)}.`,
    }
  }
  if (actor === 'assignee' && !isAssignee) {
    return {
      allowed: false,
      reason: 'Only the assigned faculty member can respond to this assignment.',
    }
  }
  if (actor === 'manager' && !canManage) {
    return { allowed: false, reason: 'Only an administrator can make that change.' }
  }
  if (actor === 'either' && !isAssignee && !canManage) {
    return { allowed: false, reason: 'You do not have permission to make that change.' }
  }
  return { allowed: true }
}

export function humanStatus(status: string) {
  return String(status).toLowerCase().replace(/_/g, ' ')
}

/**
 * Calls a tenant may see — the canonical published-only predicate. Assignment
 * deliberately has no draft carve-out: a call must be published before it is
 * assigned, because the assignee's own read path only shows published calls.
 */
export function tenantVisibleCallWhere(tenantId: string) {
  return visibleFundingCallWhere(tenantId)
}

export function parseDate(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const assignmentInclude = {
  funding_call: {
    select: {
      id: true,
      title: true,
      scheme_title: true,
      agencyName: true,
      close_date: true,
      deadlineAt: true,
      source_url: true,
    },
  },
  assignee: { select: { id: true, name: true, email: true } },
  assigned_by: { select: { id: true, name: true, email: true } },
  // The reassignment chain, so a passed-on call reads as one story rather than
  // two unrelated records.
  previous_assignment: {
    select: {
      id: true,
      status: true,
      declined_reason: true,
      assignee: { select: { id: true, name: true, email: true } },
    },
  },
  superseded_by: {
    select: {
      id: true,
      status: true,
      assignee: { select: { id: true, name: true, email: true } },
    },
  },
}

export function serializeAssignment(record: any) {
  return {
    id: record.id,
    status: record.status,
    message: record.message,
    deadlineAt: record.deadline_at,
    declinedReason: record.declined_reason,
    respondedAt: record.responded_at,
    matchScore: record.match_score,
    matchTier: record.match_tier,
    matchBasis: record.match_basis,
    submissionReference: record.submission_reference,
    submissionUrl: record.submission_url,
    submissionNotes: record.submission_notes,
    submittedAt: record.submitted_at,
    completedAt: record.completed_at,
    outcome: record.outcome,
    awardAmount: record.award_amount,
    awardCurrency: record.award_currency,
    decisionAt: record.decision_at,
    createdAt: record.created_at,
    call: record.funding_call
      ? {
          id: record.funding_call.id,
          title: record.funding_call.scheme_title || record.funding_call.title,
          agencyName: record.funding_call.agencyName,
          closeDate: record.funding_call.close_date,
          deadlineAt: record.funding_call.deadlineAt,
          sourceUrl: record.funding_call.source_url,
        }
      : null,
    assignee: record.assignee
      ? { id: record.assignee.id, name: record.assignee.name, email: record.assignee.email }
      : null,
    assignedBy: record.assigned_by
      ? { id: record.assigned_by.id, name: record.assigned_by.name, email: record.assigned_by.email }
      : null,
    passedOnFrom: record.previous_assignment
      ? {
          id: record.previous_assignment.id,
          status: record.previous_assignment.status,
          declinedReason: record.previous_assignment.declined_reason,
          name:
            record.previous_assignment.assignee?.name ||
            record.previous_assignment.assignee?.email ||
            null,
        }
      : null,
    passedOnTo: record.superseded_by
      ? {
          id: record.superseded_by.id,
          status: record.superseded_by.status,
          name:
            record.superseded_by.assignee?.name || record.superseded_by.assignee?.email || null,
        }
      : null,
  }
}
