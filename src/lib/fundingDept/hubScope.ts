/**
 * Scope for the DSR Reports hub (Incoming Calls, Assigned Calls, Pendency,
 * Follow-ups).
 *
 * The same primary/deputy fence as every management report (`managementAccess`),
 * plus the head's Member filter: a head asking for one member's view gets that
 * member's primary schools, which is what that member is accountable for
 * (Pendency instead filters by responsible coordinator; Follow-ups by author and
 * owner). A coordinator can never widen their scope — naming another school or
 * another member is refused, not silently emptied.
 *
 * A coordinator's schools are their primary ones unless they ask for
 * `portfolio=deputy`, the schools they cover for someone else: the two are never
 * mixed, so cover work is not added to their own accountability.
 */
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { textArray } from './callSql'
import { managementAccess } from './managementAccess'

export type HubScope = {
  tenantId: string
  userId: string
  /** Head or admin: sees every school and every member. */
  department: boolean
  /** The viewer's own funding-department member id, if any. */
  memberId: string | null
  /** Schools (depth-0 units) the report covers after every filter. */
  schoolIds: string[]
  /** Schools after the school filter but before the member filter (effort reports filter by author instead). */
  schoolIdsIgnoringMember: string[]
  /** The user behind the head's Member filter, when one is chosen. */
  memberUserId: string | null
  /** The filter options the viewer may pick from. */
  options: {
    schools: Array<{ id: string; name: string }>; members: Array<{ id: string; userId: string; name: string }>
    /** How many schools a coordinator covers as deputy (0 for the department lens): whether to offer the portfolio switch. */
    deputySchools: number
  }
  lens: 'department' | 'member'
  portfolio: 'primary' | 'deputy'
}

export async function resolveHubScope(request: NextRequest): Promise<HubScope | { response: NextResponse }> {
  const access = await managementAccess(request)
  if ('response' in access) return { response: access.response as NextResponse }
  const { tenantId } = access.context
  const params = new URL(request.url).searchParams

  const allSchools = await prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
    SELECT id, name FROM tenant_org_units WHERE tenant_id=${tenantId} AND depth=0 AND is_active ORDER BY name`)
  const visible = access.schoolIds ? allSchools.filter(s => access.schoolIds!.includes(s.id)) : allSchools

  const members = access.department ? await prisma.$queryRaw<Array<{ id: string; userId: string; name: string }>>(Prisma.sql`
    SELECT m.id, m.user_id "userId", COALESCE(u.name, u.email) name FROM funding_dept_members m JOIN users u ON u.id=m.user_id
     WHERE m.tenant_id=${tenantId} AND m.is_active ORDER BY COALESCE(u.name, u.email)`) : []

  const deputySchools = !access.department && access.memberId ? (await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int n FROM funding_dept_school_assignments WHERE tenant_id=${tenantId} AND member_id=${access.memberId} AND is_deputy`))[0]?.n ?? 0 : 0

  let schoolIds = visible.map(s => s.id)
  let memberUserId: string | null = null
  const memberFilter = params.get('memberId')
  if (memberFilter) {
    if (!access.department && memberFilter !== access.memberId)
      return { response: NextResponse.json({ error: 'Only the department head can view another member.' }, { status: 403 }) }
    const own = await prisma.$queryRaw<Array<{ org_unit_id: string }>>(Prisma.sql`
      SELECT org_unit_id FROM funding_dept_school_assignments WHERE tenant_id=${tenantId} AND member_id=${memberFilter} AND NOT is_deputy`)
    const mine = new Set(own.map(r => r.org_unit_id))
    schoolIds = schoolIds.filter(id => mine.has(id))
    memberUserId = members.find(m => m.id === memberFilter)?.userId
      ?? (await prisma.$queryRaw<Array<{ user_id: string }>>(Prisma.sql`SELECT user_id FROM funding_dept_members WHERE id=${memberFilter} AND tenant_id=${tenantId}`))[0]?.user_id ?? null
    if (!memberUserId) return { response: NextResponse.json({ error: 'Unknown DSR member.' }, { status: 404 }) }
  }
  const schoolFilter = params.get('schoolId')
  let schoolIdsIgnoringMember = visible.map(s => s.id)
  if (schoolFilter) {
    if (!visible.some(s => s.id === schoolFilter))
      return { response: NextResponse.json({ error: 'That school is outside your access.' }, { status: 403 }) }
    schoolIds = schoolIds.filter(id => id === schoolFilter)
    schoolIdsIgnoringMember = [schoolFilter]
  }

  return {
    tenantId, userId: access.context.user.id, department: access.department, memberId: access.memberId, schoolIds, schoolIdsIgnoringMember, memberUserId,
    options: { schools: visible, members, deputySchools }, lens: access.department ? 'department' : 'member',
    portfolio: !access.department && access.deputy ? 'deputy' : 'primary',
  }
}

/** `school_id = ANY(scope)` for a column holding a depth-0 school id. */
export const inSchools = (column: string, schoolIds: string[]) => Prisma.sql`${Prisma.raw(column)} = ANY(${textArray(schoolIds)})`

/** Page and page size from the query string, clamped. */
export function paging(params: URLSearchParams) {
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(params.get('pageSize') || '25', 10) || 25))
  return { page, pageSize }
}

/**
 * A per-call transfer counts only while its owner is an active member who still
 * covers the school — the rule `getManagementReport` applies. Without it, a
 * transfer to someone since deactivated or moved off the school kept naming them
 * as the coordinator here while the Overview named the primary.
 */
export function transferOwnerSql(tenantId: string, schoolExpr: string, callExpr: string): Prisma.Sql {
  return Prisma.sql`(SELECT tr.owner_user_id FROM dsr_responsibility_transfers tr
      JOIN funding_dept_members tm ON tm.user_id=tr.owner_user_id AND tm.tenant_id=tr.tenant_id AND tm.is_active
     WHERE tr.tenant_id=${tenantId} AND tr.school_id=${Prisma.raw(schoolExpr)} AND tr.call_id=${Prisma.raw(callExpr)}
       AND EXISTS (SELECT 1 FROM funding_dept_school_assignments ts WHERE ts.member_id=tm.id AND ts.org_unit_id=tr.school_id)
     LIMIT 1)`
}

/** The school's responsible coordinator: a valid per-call transfer owner, else the primary member. */
export function coordinatorSql(tenantId: string, schoolExpr: string, callExpr: string): Prisma.Sql {
  return Prisma.sql`COALESCE(
    ${transferOwnerSql(tenantId, schoolExpr, callExpr)},
    (SELECT dm.user_id FROM funding_dept_school_assignments sa JOIN funding_dept_members dm ON dm.id=sa.member_id AND dm.is_active
      WHERE sa.tenant_id=${tenantId} AND sa.org_unit_id=${Prisma.raw(schoolExpr)} AND NOT sa.is_deputy ORDER BY sa.id LIMIT 1))`
}
