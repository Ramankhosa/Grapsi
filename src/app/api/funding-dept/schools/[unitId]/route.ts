import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import {
  getMissedAssignments,
  getSummary,
  getUnassignedUpcomingCalls,
  getUpcomingDeadlines,
} from '@/lib/assignments/dashboardService'
import { canOpenSchoolWork } from '@/lib/fundingDept/shared'
import { listSubtreeUnitIds } from '@/lib/orgUnits/tree'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic = 'force-dynamic'

/**
 * One school, as the officer covering it experiences it.
 *
 * The department's other screens are organised around a person — what I
 * delegated, what each member is carrying. This one is organised around the
 * school, because that is the unit an officer is actually answerable for: the
 * live work in it whoever delegated it, the faculty in it and what they are
 * carrying, the calls closing with nobody in the school on them, and the recent
 * contact log across all of it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { unitId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { scope } = context

  const unitId = (params.unitId || '').trim()
  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: unitId, tenant_id: context.tenantId },
    select: { id: true, name: true, code: true, kind: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'School not found.' }, { status: 404 })
  }

  // One rule for per-school work (see canOpenSchoolWork): admins and the
  // department head open any school; everyone else only the ones they cover.
  if (!canOpenSchoolWork(scope, unit.id)) {
    return NextResponse.json(
      { error: 'That school is outside the ones you cover.' },
      { status: 403 }
    )
  }

  // Everything at or beneath the school: faculty sit on departments, so the
  // school itself holds almost nobody.
  const subtreeIds = await listSubtreeUnitIds(context.tenantId, [unit.id])
  const unitIds = subtreeIds.length > 0 ? subtreeIds : [unit.id]

  // Deliberately NOT filtered by who delegated the work: the point of this
  // screen is that a colleague's assignment into your school is your business.
  const filters = { tenantId: context.tenantId, scopeUnitIds: unitIds }

  const unitIdArray = Prisma.sql`ARRAY[${Prisma.join(
    unitIds.map((id) => Prisma.sql`${id}`)
  )}]::text[]`

  const [summary, upcoming, missed, openCalls, faculty, live, recentContact] = await Promise.all([
    getSummary(filters),
    getUpcomingDeadlines(filters, 45, 30),
    getMissedAssignments(filters, 30),
    getUnassignedUpcomingCalls(context.tenantId, {
      scopeUnitIds: unitIds,
      // Narrowed to this school's disciplines, so the list is what this school
      // should be doing rather than the tenant's whole open catalog.
      relevanceUnitIds: [unit.id],
      withinDays: 60,
      limit: 15,
    }),
    // The roster for this school with what each person is carrying, so the
    // "who has capacity" question is answered on the same screen as the work.
    prisma.$queryRaw<
      Array<{
        userId: string
        name: string
        email: string
        employeeId: string | null
        department: string | null
        designation: string | null
        liveAssignments: number
        lastAssignedAt: Date | null
      }>
    >(Prisma.sql`
      SELECT
        u.id AS "userId",
        COALESCE(rp.display_name, u.name, u.email) AS name,
        u.email,
        rp.employee_id AS "employeeId",
        rp.department,
        rp.designation,
        (
          SELECT COUNT(*)::int FROM call_assignments ca
          WHERE ca.assignee_user_id = u.id AND ca.tenant_id = u."tenantId"
            AND ca.status IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS')
        ) AS "liveAssignments",
        (
          SELECT MAX(ca.created_at) FROM call_assignments ca
          WHERE ca.assignee_user_id = u.id AND ca.tenant_id = u."tenantId"
        ) AS "lastAssignedAt"
      FROM users u
      JOIN researcher_profiles rp ON rp.user_id = u.id
      WHERE u."tenantId" = ${context.tenantId}
        AND rp.org_unit_id = ANY(${unitIdArray})
        AND NOT (u.roles && ARRAY['SUPER_ADMIN','SUPER_ADMIN_VIEWER']::"UserRole"[])
      ORDER BY "liveAssignments" DESC, name ASC
    `),
    // Live assignments in the school, with the assigner named — this is the
    // column that makes a colleague's work visible instead of invisible.
    prisma.callAssignment.findMany({
      where: {
        tenant_id: context.tenantId,
        assignee_org_unit_id: { in: unitIds },
        status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
      },
      select: {
        id: true,
        status: true,
        deadline_at: true,
        created_at: true,
        responded_at: true,
        assignee: { select: { id: true, name: true, email: true } },
        assigned_by: { select: { id: true, name: true, email: true } },
        funding_call: {
          select: { id: true, title: true, scheme_title: true, agencyName: true, close_date: true },
        },
      },
      orderBy: [{ deadline_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }],
      take: 100,
    }),
    prisma.assignmentFollowUp.findMany({
      where: {
        tenant_id: context.tenantId,
        // Contact on an assignment in this school, or logged against the
        // school itself before anyone was assigned. A to-one relation filter
        // alone would drop the second kind — the earliest chasing there is.
        OR: [
          { assignment: { assignee_org_unit_id: { in: unitIds } } },
          { org_unit_id: { in: unitIds } },
        ],
      },
      select: {
        id: true,
        kind: true,
        note: true,
        happened_at: true,
        remind_at: true,
        created_by: { select: { id: true, name: true, email: true } },
        funding_call: { select: { id: true, title: true, scheme_title: true } },
        org_unit: { select: { id: true, name: true } },
        assignment: {
          select: {
            id: true,
            assignee: { select: { name: true, email: true } },
            funding_call: { select: { title: true, scheme_title: true } },
          },
        },
      },
      orderBy: { happened_at: 'desc' },
      take: 20,
    }),
  ])

  // Who covers this school, so an officer opening a neighbouring school knows
  // whose desk it is rather than assuming it is unowned.
  const coverage = await prisma.fundingDeptSchoolAssignment.findFirst({
    where: { tenant_id: context.tenantId, org_unit_id: unit.id },
    select: {
      member: {
        select: { is_active: true, user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  return NextResponse.json({
    school: { id: unit.id, name: unit.name, code: unit.code, kind: unit.kind },
    coveredBy: coverage?.member?.is_active
      ? {
          id: coverage.member.user.id,
          name: coverage.member.user.name || coverage.member.user.email,
          isMe: coverage.member.user.id === context.user.id,
        }
      : null,
    summary,
    upcoming,
    missed,
    openCalls,
    faculty: faculty.map((row) => ({
      ...row,
      lastAssignedAt: row.lastAssignedAt,
    })),
    assignments: live.map((row) => ({
      id: row.id,
      status: row.status,
      deadlineAt: row.deadline_at,
      createdAt: row.created_at,
      respondedAt: row.responded_at,
      assignee: row.assignee
        ? { id: row.assignee.id, name: row.assignee.name || row.assignee.email }
        : null,
      assignedBy: row.assigned_by
        ? {
            id: row.assigned_by.id,
            name: row.assigned_by.name || row.assigned_by.email,
            isMe: row.assigned_by.id === context.user.id,
          }
        : null,
      call: row.funding_call
        ? {
            id: row.funding_call.id,
            title: row.funding_call.scheme_title || row.funding_call.title,
            agency: row.funding_call.agencyName,
            closeDate: row.funding_call.close_date,
          }
        : null,
    })),
    recentContact: recentContact.map((row) => ({
      id: row.id,
      kind: row.kind,
      note: row.note,
      happenedAt: row.happened_at,
      remindAt: row.remind_at,
      author: row.created_by?.name || row.created_by?.email || null,
      assignmentId: row.assignment?.id ?? null,
      facultyName: row.assignment?.assignee?.name || row.assignment?.assignee?.email || null,
      // Call-level notes have no assignee; the dossier link still works.
      callId: row.funding_call?.id ?? null,
      orgUnitId: row.org_unit?.id ?? null,
      callTitle:
        row.assignment?.funding_call?.scheme_title ||
        row.assignment?.funding_call?.title ||
        row.funding_call?.scheme_title ||
        row.funding_call?.title ||
        null,
    })),
  })
}
