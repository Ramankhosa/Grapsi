import { NextRequest, NextResponse } from 'next/server'

import { assignmentInclude, serializeAssignment } from '@/lib/assignments/shared'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadUnitAreaProfile, relevanceForCalls } from '@/lib/funding/callUnitRelevance'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { buildTimeline, type TimelineCaps } from '@/lib/fundingDept/callTimeline'
import { isNudgeTitle } from '@/lib/fundingDept/escalationService'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { queueStateFor } from '@/lib/fundingDept/queueState'
import { canOpenSchoolWork } from '@/lib/fundingDept/shared'
import { listSubtreeUnitIds } from '@/lib/orgUnits/tree'
import { prisma } from '@/lib/prisma'
import { researcherSearchService } from '@/lib/services/researcherSearchService'

export const dynamic = 'force-dynamic'

/**
 * Everything about one call in one school, on one screen.
 *
 * The department already recorded all of this, in six tables and across three
 * screens: who might do it, who is on it, what was said to whom, what the
 * system chased automatically. What nobody could see was the sequence. This
 * assembles it — people, assignments, and one merged history — for the officer
 * who has to move the call forward.
 *
 * Deliberately per (call, school): triage, "is anyone on this", and coverage
 * are all per-school facts, and the officer is answerable for one school at a
 * time. The school is the unit of responsibility, so it is the unit of view.
 */

/** Per-source row cap. Truncation is reconciled by buildTimeline's horizon rule. */
const SOURCE_CAP = 500
const PEOPLE_LIMIT = 30

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  // Members, not `canReviewDept` — this is the screen ordinary officers work
  // from, and gating it to the head would recreate the hole the queue filled.
  const membership = await getMembership(context.tenantId, context.user.id)
  if (!membership?.is_active && !context.isAdmin) {
    return NextResponse.json(
      { error: 'You are not a member of the funding department.' },
      { status: 403 }
    )
  }

  const requestedUnitId = (new URL(request.url).searchParams.get('orgUnitId') || '').trim()

  // Schools this person may work, in the order the queue offers them.
  const coveredIds = (membership?.school_assignments ?? []).map((row) => row.org_unit_id)
  const selectableUnits = await prisma.tenantOrgUnit.findMany({
    where: {
      tenant_id: context.tenantId,
      is_active: true,
      depth: 0,
      ...(coveredIds.length > 0 && !context.scope.fundingDept.isHead && !context.scope.isTenantWide
        ? { id: { in: coveredIds } }
        : {}),
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })
  if (selectableUnits.length === 0) {
    return NextResponse.json(
      { error: 'No schools are assigned to you yet.' },
      { status: 403 }
    )
  }

  const school =
    selectableUnits.find((unit) => unit.id === requestedUnitId) ||
    selectableUnits.find((unit) => coveredIds.includes(unit.id)) ||
    selectableUnits[0]

  if (!canOpenSchoolWork(context.scope, school.id)) {
    return NextResponse.json(
      { error: 'That school is outside the ones you cover.' },
      { status: 403 }
    )
  }

  const call = await prisma.fundingCall.findFirst({
    where: {
      AND: [
        { id: params.callId },
        visibleFundingCallWhere(context.tenantId, { includeTenantDrafts: true }),
      ],
    },
    select: {
      id: true,
      title: true,
      scheme_title: true,
      agencyName: true,
      agency_name: true,
      summary: true,
      description: true,
      close_date: true,
      deadlineAt: true,
      official_urls: true,
      source_url: true,
      visibility: true,
      status: true,
      catalog_status: true,
      disciplines: true,
    },
  })
  if (!call) {
    return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })
  }

  const subtreeIds = await listSubtreeUnitIds(context.tenantId, [school.id])
  const scopeIds = subtreeIds.length > 0 ? subtreeIds : [school.id]

  // Assignments in this school. STRICT on the snapshot, matching the queue's
  // own "is anyone on this" test — a COALESCE to the live profile here would
  // let a call the queue calls `pending` show a live assignment in its dossier.
  const assignments = await prisma.callAssignment.findMany({
    where: {
      funding_call_id: call.id,
      tenant_id: context.tenantId,
      assignee_org_unit_id: { in: scopeIds },
    },
    include: assignmentInclude,
    orderBy: [{ created_at: 'desc' }],
    take: 100,
  })
  const assignmentIds = assignments.map((row) => row.id)

  // Assignments on this call whose assignee has no unit snapshot at all. Only
  // an admin sees them, labelled — never merged into the school's own list,
  // because "unplaced" is a data gap, not a fact about this school.
  const unattributed = context.scope.isTenantWide
    ? await prisma.callAssignment.findMany({
        where: {
          funding_call_id: call.id,
          tenant_id: context.tenantId,
          assignee_org_unit_id: null,
        },
        include: assignmentInclude,
        orderBy: [{ created_at: 'desc' }],
        take: 25,
      })
    : []

  const [
    triage,
    profile,
    followUps,
    candidateRows,
    documents,
    milestones,
    notifications,
    liveAssignmentCounts,
  ] = await Promise.all([
    prisma.callSchoolTriage.findUnique({
      where: {
        funding_call_id_org_unit_id: { funding_call_id: call.id, org_unit_id: school.id },
      },
      select: {
        status: true,
        note: true,
        decided_at: true,
        decided_by: { select: { id: true, name: true, email: true } },
      },
    }),
    loadUnitAreaProfile(context.tenantId, [school.id]),
    // One indexed scan: call-level notes for this school, plus assignment-level
    // notes for the assignments above. Both carry funding_call_id since the
    // migration, so this needs no union through the assignments table.
    prisma.assignmentFollowUp.findMany({
      where: {
        tenant_id: context.tenantId,
        funding_call_id: call.id,
        OR: [
          { assignment_id: null, org_unit_id: school.id },
          ...(assignmentIds.length > 0 ? [{ assignment_id: { in: assignmentIds } }] : []),
        ],
      },
      select: {
        id: true,
        kind: true,
        note: true,
        happened_at: true,
        reminder_sent_at: true,
        remind_faculty: true,
        remind_at: true,
        assignment_id: true,
        created_by: { select: { id: true, name: true, email: true } },
      },
      orderBy: { happened_at: 'desc' },
      take: SOURCE_CAP,
    }),
    // Candidates whose unit — assignment snapshot first, live profile second —
    // falls in this school. Same precedence the portfolio reports use.
    prisma.callCandidate.findMany({
      where: { tenant_id: context.tenantId, funding_call_id: call.id },
      select: {
        id: true,
        status: true,
        note: true,
        match_score: true,
        match_tier: true,
        created_at: true,
        updated_at: true,
        user_id: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            researcher_profile: {
              select: { org_unit_id: true, department: true, employee_id: true },
            },
          },
        },
        created_by: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updated_at: 'desc' },
      take: SOURCE_CAP,
    }),
    assignmentIds.length > 0
      ? prisma.assignmentDocument.findMany({
          where: { assignment_id: { in: assignmentIds } },
          select: {
            id: true,
            kind: true,
            file_name: true,
            created_at: true,
            assignment_id: true,
            uploaded_by: { select: { id: true, name: true, email: true } },
          },
          orderBy: { created_at: 'desc' },
          take: SOURCE_CAP,
        })
      : Promise.resolve([]),
    assignmentIds.length > 0
      ? prisma.assignmentMilestone.findMany({
          where: { assignment_id: { in: assignmentIds } },
          select: {
            id: true,
            kind: true,
            title: true,
            status: true,
            created_at: true,
            completed_at: true,
            due_at: true,
            assignment_id: true,
          },
          orderBy: { created_at: 'desc' },
          take: SOURCE_CAP,
        })
      : Promise.resolve([]),
    // Automatic nudges only. Status-change notifications duplicate timestamps
    // the assignment already carries, and reminders are read from
    // reminder_sent_at — which also keeps a private tickler out of this view.
    assignmentIds.length > 0
      ? prisma.notification.findMany({
          where: {
            tenant_id: context.tenantId,
            assignment_id: { in: assignmentIds },
            category: 'DEADLINE',
          },
          select: { id: true, title: true, body: true, created_at: true, assignment_id: true },
          orderBy: { created_at: 'desc' },
          take: SOURCE_CAP,
        })
      : Promise.resolve([]),
    // How much each person in this school is already carrying, so an officer
    // sees load before adding to it.
    prisma.callAssignment.groupBy({
      by: ['assignee_user_id'],
      where: {
        tenant_id: context.tenantId,
        assignee_org_unit_id: { in: scopeIds },
        status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
      },
      _count: { _all: true },
    }),
  ])

  const candidates = candidateRows.filter((row) => {
    const snapshot = assignments.find((a) => a.assignee_user_id === row.user_id)
    const unitId = snapshot?.assignee_org_unit_id ?? row.user.researcher_profile?.org_unit_id
    return unitId ? scopeIds.includes(unitId) : false
  })

  const relevance = await relevanceForCalls(profile, [call.id])
  const match = relevance.get(call.id)

  const liveByUser = new Map(
    liveAssignmentCounts.map((row) => [row.assignee_user_id, row._count._all])
  )
  const candidateByUser = new Map(candidates.map((row) => [row.user_id, row]))
  // Only work still in hand blocks a fresh assignment. A cancelled or declined
  // one is history: the person is available again, and the UI must offer them.
  const liveAssignmentByUser = new Map(
    assignments
      .filter((row) => !['CANCELLED', 'DECLINED'].includes(row.status))
      .map((row) => [row.assignee_user_id, row])
  )
  const lastAssignmentByUser = new Map(assignments.map((row) => [row.assignee_user_id, row]))

  // The same search the matching page runs, narrowed to this school, so the
  // scores an officer sees here and there are the same numbers.
  let people: Array<Record<string, unknown>> = []
  let peopleError: string | null = null
  try {
    const search = await researcherSearchService.search({
      fundingCallId: call.id,
      filters: { orgUnitIds: scopeIds, tenantOnly: true, includeSelf: true },
      limit: PEOPLE_LIMIT,
      requesterUserId: context.user.id,
      requesterTenantId: context.tenantId,
    })
    people = (search.results || []).map((result: any) => {
      const candidate = candidateByUser.get(result.userId)
      const live = liveAssignmentByUser.get(result.userId)
      const last = lastAssignmentByUser.get(result.userId)
      return {
        userId: result.userId,
        name: result.displayName,
        department: result.department,
        careerStage: result.careerStage,
        score: result.score,
        matchTier: result.matchTier,
        matchReason: result.matchReason,
        researchAreas: (result.researchAreas || []).slice(0, 4),
        liveAssignments: liveByUser.get(result.userId) || 0,
        candidateStatus: candidate?.status ?? null,
        /** Set only while the work is live — this is what hides "Assign". */
        assignmentId: live?.id ?? null,
        /** The latest answer, live or not, so a decline still shows on the row. */
        assignmentStatus: last?.status ?? null,
      }
    })
  } catch (error) {
    // A matching failure must not take the whole dossier down — the history and
    // the assignments are still the record.
    peopleError = error instanceof Error ? error.message : 'Could not load matching faculty.'
  }

  const caps: TimelineCaps = {
    followUps: followUps.length >= SOURCE_CAP,
    candidates: candidateRows.length >= SOURCE_CAP,
    documents: documents.length >= SOURCE_CAP,
    milestones: milestones.length >= SOURCE_CAP,
    notifications: notifications.length >= SOURCE_CAP,
  }

  const timeline = buildTimeline(
    {
      followUps,
      candidates: candidates.map((row) => ({
        id: row.id,
        status: row.status,
        note: row.note,
        created_at: row.created_at,
        updated_at: row.updated_at,
        user: { name: row.user.name, email: row.user.email },
        created_by: row.created_by,
      })),
      assignments: assignments.map((row: any) => ({
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        responded_at: row.responded_at,
        declined_reason: row.declined_reason,
        submitted_at: row.submitted_at,
        completed_at: row.completed_at,
        decision_at: row.decision_at,
        outcome: row.outcome,
        award_amount: row.award_amount,
        award_currency: row.award_currency,
        assignee: { name: row.assignee?.name, email: row.assignee?.email },
        assigned_by: { name: row.assigned_by?.name, email: row.assigned_by?.email },
        previous_assignment: row.previous_assignment
          ? {
              id: row.previous_assignment.id,
              declined_reason: row.previous_assignment.declined_reason,
              assignee: {
                name: row.previous_assignment.assignee?.name,
                email: row.previous_assignment.assignee?.email,
              },
            }
          : null,
      })),
      documents,
      milestones,
      notifications: notifications.filter((row) => isNudgeTitle(row.title)),
    },
    caps
  )

  const liveCount = assignments.filter(
    (row) => !['CANCELLED', 'DECLINED'].includes(row.status)
  ).length

  return NextResponse.json({
    schools: selectableUnits.map((unit) => ({
      id: unit.id,
      name: unit.name,
      code: unit.code,
      covered: coveredIds.includes(unit.id),
    })),
    school: { id: school.id, name: school.name, code: school.code },
    call: {
      id: call.id,
      title: call.scheme_title || call.title,
      agency: call.agency_name || call.agencyName,
      summary: call.summary || call.description,
      closeDate: call.close_date || call.deadlineAt,
      url: call.official_urls?.[0] || call.source_url || null,
      disciplines: call.disciplines,
      isDraft:
        call.visibility === 'TENANT_PRIVATE' &&
        call.status !== 'PUBLISHED' &&
        call.catalog_status !== 'PUBLISHED',
    },
    relevance: {
      tier: match?.tier ?? 'none',
      reason: match?.reason ?? null,
      isUnmapped: profile.isUnmapped,
    },
    triage: triage
      ? {
          status: triage.status,
          note: triage.note,
          decidedAt: triage.decided_at,
          decidedBy: triage.decided_by?.name || triage.decided_by?.email || null,
        }
      : { status: 'NEW', note: null, decidedAt: null, decidedBy: null },
    // The queue's own verdict, computed by the shared ladder so the dossier and
    // the tab a user clicked from can never disagree.
    queueState: queueStateFor(triage?.status, liveCount),
    people,
    peopleError,
    assignments: assignments.map(serializeAssignment),
    unattributedAssignments: unattributed.map(serializeAssignment),
    timeline: timeline.events,
    truncatedBefore: timeline.truncatedBefore,
  })
}
