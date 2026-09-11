/**
 * Who sees which rows in the department reports.
 *
 * One clamp, shared, because there are now four endpoints showing the same grid
 * from different angles and a clamp copied four times is a clamp that will differ
 * four ways. The rule these reports need is not the same as the one the queue
 * needs, and writing it out per route is how "pendency" ends up meaning one thing
 * on the grid and another on the list behind it.
 *
 *   admin / department head   everything, optionally filtered
 *   an active member          their own rota AND anything they deputise on,
 *                             because during leave the deputy is the one doing
 *                             the work and must be able to see it
 *   a school head             the units they were granted, and only the two
 *                             reports that are about their own school
 *   anyone else               403
 *
 * A member is clamped rather than refused on purpose. An officer should be able
 * to see exactly what the head sees about them: nothing here is meant to be a
 * secret scorecard, and a number somebody cannot check is a number they cannot
 * fix.
 *
 * The school-head lens was missing when these reports shipped, so a Dean got a
 * 403 on the screens most about their own school. Their authority is an
 * OrgUnitManager grant rather than a role or a coverage row — precisely the case
 * `canReviewDept` does not cover, and the reason this file exists at all.
 */
import { NextResponse } from 'next/server'

import type { TenantContext } from '@/lib/auth/tenantAccess'
import type { ManagedScope } from '@/lib/orgUnits/scope'

import { getMembership } from './membershipService'
import { canReviewDept, memberReachSchoolIds, serializeMember } from './shared'

/** Sentinel for "narrowed to nothing", so a clamp can never widen to everything. */
const NOTHING = '__none__'

export interface ReportLens {
  lens: 'department' | 'member' | 'school-head'
  /**
   * True only when the caller may see the whole tenant and asked for no filter.
   *
   * This exists because an empty `schoolIds` is genuinely ambiguous — "no filter,
   * show everything" for a head, "you cover nothing, show nothing" for a member —
   * and leaving callers to infer which from the lens name is how a member who
   * asked about somebody else's school came back with their own whole reach
   * instead of an empty report. Read this, never `schoolIds.length`.
   */
  allSchools: boolean
  /** Schools to report on. Meaningful only when `allSchools` is false. */
  schoolIds: string[]
  /** Members to report on. Undefined means all of them. */
  memberIds: string[] | undefined
  viewer: {
    memberId: string | null
    isHead: boolean
    canReviewDept: boolean
  }
}

export type ReportLensResult = ReportLens | { error: string; status: number }

export function isLensError(value: ReportLensResult): value is { error: string; status: number } {
  return typeof (value as { error?: unknown }).error === 'string'
}

export async function resolveReportLens(
  context: TenantContext & { scope: ManagedScope },
  requested: { schoolId?: string | null; memberId?: string | null } = {}
): Promise<ReportLensResult> {
  const reviewsDept = canReviewDept(context, context.scope)
  const membership = await getMembership(context.tenantId, context.user.id)
  const isActiveMember = Boolean(membership?.is_active)

  // A Dean or Head of Department, resolved from their OrgUnitManager grant.
  // Evaluated after membership so that somebody who is both an officer and a
  // school head keeps the officer lens, which is the wider of the two.
  const isSchoolHead =
    !reviewsDept &&
    !isActiveMember &&
    context.scope.canViewReports &&
    (context.scope.headUnitIds ?? []).length > 0

  if (!reviewsDept && !isActiveMember && !isSchoolHead) {
    return { error: 'Only the funding department can see this.', status: 403 }
  }

  const requestedSchool = (requested.schoolId || '').trim() || null
  const requestedMember = (requested.memberId || '').trim() || null

  const viewer = {
    memberId: membership?.id ?? null,
    isHead: Boolean(membership?.is_head),
    canReviewDept: reviewsDept,
  }

  if (reviewsDept) {
    return {
      lens: 'department',
      allSchools: !requestedSchool,
      schoolIds: requestedSchool ? [requestedSchool] : [],
      memberIds: requestedMember ? [requestedMember] : undefined,
      viewer,
    }
  }

  if (isSchoolHead) {
    // `headUnitIds` rather than `managedUnitIds`: it holds the units actually
    // granted, and the report services expand each one's subtree themselves.
    const granted = context.scope.headUnitIds ?? []
    return {
      lens: 'school-head',
      allSchools: false,
      // Same clamp shape as a member: a unit outside the grant narrows to
      // nothing rather than widening to everything this person heads.
      schoolIds: requestedSchool ? granted.filter((id) => id === requestedSchool) : granted,
      memberIds: undefined,
      viewer,
    }
  }

  // Clamped to this member's own reach. A requested school outside it narrows to
  // nothing rather than widening — the same shape the roster and matching routes
  // use, and the reason the sentinel exists rather than an empty array.
  const serialized = serializeMember(membership)
  const reach = memberReachSchoolIds(serialized)
  return {
    lens: 'member',
    allSchools: false,
    schoolIds: requestedSchool
      ? reach.filter((id) => id === requestedSchool)
      : reach.length > 0
        ? reach
        : [NOTHING],
    memberIds: [serialized.id],
    viewer,
  }
}

/**
 * Whether a resolved lens can see nothing at all.
 *
 * Worth asking explicitly: a member with no schools and a member asking about
 * someone else's school both arrive here, and both should get an empty report
 * rather than a query that falls through to the whole tenant.
 */
/**
 * Refuse a school head one of the two department-facing reports.
 *
 * The four reports split in two. The backlog and the faculty roster describe a
 * school's own opportunity and its own people, so a Dean should see them. The
 * member grid and the efficiency report describe how the funding department's
 * officers are performing, which is the department's internal management — the
 * same line `redactLedgerForSchoolHead` already draws by stripping officer notes
 * from a Dean's copy of the ledger.
 *
 * Returns null when the caller may proceed, so a route reads:
 * `const refusal = refuseSchoolHead(lens); if (refusal) return refusal`.
 */
export function refuseSchoolHead(lens: ReportLens): NextResponse | null {
  if (lens.lens !== 'school-head') return null
  return NextResponse.json(
    {
      error:
        'This report is the funding department’s own. Your school’s unallocated calls and faculty engagement are on your school page.',
    },
    { status: 403 }
  )
}

export function lensIsEmpty(lens: ReportLens): boolean {
  if (lens.allSchools) return false
  return lens.schoolIds.length === 0 || lens.schoolIds[0] === NOTHING
}
