/**
 * Shared shapes for the funding call assignment routes.
 *
 * These live outside the route files because Next.js App Router only permits
 * HTTP handlers and a fixed set of config exports from a `route.ts`.
 */

export const ASSIGNMENT_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/** Calls a tenant may see: its own, plus globally published ones. */
export function tenantVisibleCallWhere(tenantId: string) {
  return {
    OR: [
      { tenantId },
      { tenantId: null, visibility: 'GLOBAL_PUBLISHED' as const, status: 'PUBLISHED' as const },
    ],
  }
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
}

export function serializeAssignment(record: any) {
  return {
    id: record.id,
    status: record.status,
    message: record.message,
    deadlineAt: record.deadline_at,
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
  }
}
