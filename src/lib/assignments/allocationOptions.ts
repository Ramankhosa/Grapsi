import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/lib/prisma-generated'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope, type TenantScopeContext } from '@/lib/auth/tenantAccess'
import { canAssignToUser } from '@/lib/orgUnits/scope'
import { tenantVisibleCallWhere } from './shared'
import { allocationCallClosed, allocationDateKey, type AllocationSchool } from './manualAllocation'

export class AllocationOptionsError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function requireAllocationAccess(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return context
  if (!context.scope.canAssign) return { error: 'You do not have permission to allocate funding calls.', status: 403 }
  return context
}

export async function allocationPerson(context: TenantScopeContext, userId: string) {
  if (!userId) throw new AllocationOptionsError('Choose a faculty member.')
  const person = await prisma.user.findFirst({
    where: { id: userId, tenantId: context.tenantId, status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'] } } },
    select: { id: true, name: true, email: true, researcher_profile: {
      select: { display_name: true, employee_id: true, school: true, department: true, org_unit_id: true, org_unit: { select: { path: true } } },
    } },
  })
  if (!person) throw new AllocationOptionsError('Faculty member not found or unavailable.', 404)
  const permission = await canAssignToUser(context.scope, person.id)
  if (!permission.allowed) throw new AllocationOptionsError(permission.reason || 'Faculty member outside your school coverage.', 403)
  return { person, permission }
}

function pagination(params: URLSearchParams) {
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(params.get(key) ?? fallback)
    if (!Number.isSafeInteger(value) || value < (key === 'limit' ? 1 : 0)) throw new AllocationOptionsError(`Invalid ${key}.`)
    return Math.min(value, max)
  }
  return { limit: integer('limit', 20, 50), offset: integer('offset', 0, 1000000) }
}

export async function callOptions(context: TenantScopeContext, params: URLSearchParams) {
  const { person, permission } = await allocationPerson(context, params.get('assigneeUserId') || '')
  const { limit, offset } = pagination(params)
  const q = (params.get('q') || '').trim().slice(0, 200)
  const callId = params.get('callId') || ''
  const filters: Prisma.FundingCallWhereInput[] = [tenantVisibleCallWhere(context.tenantId)]
  if (callId) filters.push({ id: callId })
  else {
    if (q) filters.push({ OR: ['id', 'programIdentifier', 'title', 'scheme_title', 'agencyName', 'agency_name', 'description', 'summary'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) })
    if (params.get('includeClosed') !== 'true') {
      const today = new Date(`${allocationDateKey(new Date())}T00:00:00+05:30`)
      filters.push({ OR: [
        { close_date: { gte: today } },
        { close_date: null, deadlineAt: { gte: today } },
        { close_date: null, deadlineAt: null },
      ] })
    }
  }
  const where: Prisma.FundingCallWhereInput = { AND: filters }
  const [rows, total] = await Promise.all([
    prisma.fundingCall.findMany({ where, select: { id: true, title: true, scheme_title: true, agency_name: true, agencyName: true, close_date: true, deadlineAt: true },
      orderBy: [{ close_date: { sort: 'asc', nulls: 'last' } }, { deadlineAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: limit, skip: offset }),
    prisma.fundingCall.count({ where }),
  ])
  if (callId && !rows.length) throw new AllocationOptionsError('This call is unavailable for allocation. It must be published and active.', 404)
  const ids = rows.map(row => row.id)
  const schoolId = person.researcher_profile?.org_unit?.path[0] || permission.assigneeUnitId
  const [assignments, mappings, school] = await Promise.all([
    prisma.callAssignment.findMany({ where: { tenant_id: context.tenantId, assignee_user_id: person.id, funding_call_id: { in: ids } }, select: { id: true, status: true, funding_call_id: true } }),
    schoolId && ids.length ? prisma.$queryRaw<Array<{ call_id: string; is_active: boolean; ended_reason: string | null }>>(Prisma.sql`
      SELECT call_id, is_active, ended_reason FROM dsr_call_school_mappings
      WHERE tenant_id=${context.tenantId} AND school_id=${schoolId} AND call_id IN (${Prisma.join(ids)})`) : Promise.resolve([]),
    schoolId ? prisma.tenantOrgUnit.findFirst({ where: { id: schoolId, tenant_id: context.tenantId }, select: { name: true } }) : Promise.resolve(null),
  ])
  return { calls: rows.map(row => {
    const assignment = assignments.find(a => a.funding_call_id === row.id)
    const mapping = mappings.find(m => m.call_id === row.id)
    const deadline = row.close_date || row.deadlineAt
    return { id: row.id, title: row.scheme_title || row.title, agency: row.agency_name || row.agencyName,
      closeDate: deadline, isClosed: allocationCallClosed(deadline),
      existingAssignment: assignment ? { id: assignment.id, status: assignment.status } : null,
      responsibility: { schoolId, schoolName: school?.name || null, willReopen: mapping?.is_active === false, previousReason: mapping?.ended_reason || null } }
  }), total, limit, offset }
}

export async function facultyOptions(context: TenantScopeContext, params: URLSearchParams) {
  const callId = params.get('fundingCallId') || ''
  if (!callId) throw new AllocationOptionsError('Choose a funding call.')
  const call = await prisma.fundingCall.findFirst({ where: { AND: [{ id: callId }, tenantVisibleCallWhere(context.tenantId)] }, select: { id: true } })
  if (!call) throw new AllocationOptionsError('This call is unavailable for allocation. It must be published and active.', 404)
  const { limit, offset } = pagination(params)
  const units = await prisma.tenantOrgUnit.findMany({ where: { tenant_id: context.tenantId, is_active: true }, select: { id: true, name: true, depth: true, path: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
  const allowed = units.filter(unit => context.scope.isTenantWide || context.scope.managedUnitIds.includes(unit.id))
  const schools: AllocationSchool[] = units.filter(unit => unit.depth === 0 && allowed.some(child => child.id === unit.id || child.path.includes(unit.id)))
    .map(school => ({ id: school.id, name: school.name, departments: allowed.filter(unit => unit.depth > 0 && unit.path[0] === school.id).map(unit => ({ id: unit.id, name: unit.name })) }))
  if (context.scope.isTenantWide) schools.push({ id: '__unplaced__', name: 'Faculty without school placement', departments: [] })
  const schoolId = params.get('schoolId') || ''
  const departmentId = params.get('departmentId') || ''
  // No selection returns only the authorised hierarchy; it never means everyone.
  if (!schoolId) return { faculty: [], schools, total: 0, limit, offset }
  if (!schools.some(school => school.id === schoolId)) throw new AllocationOptionsError('That school is outside your allocation access.', 403)
  if (departmentId && !schools.find(school => school.id === schoolId)?.departments.some(unit => unit.id === departmentId)) throw new AllocationOptionsError('That department is outside the selected school or your access.', 403)
  const selectedUnits = allowed.filter(unit => (unit.id === schoolId || unit.path[0] === schoolId) && (!departmentId || unit.id === departmentId || unit.path.includes(departmentId)))
  const filters: Prisma.UserWhereInput[] = [
    { tenantId: context.tenantId, status: 'ACTIVE', NOT: { roles: { hasSome: ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'] } } },
    schoolId === '__unplaced__' ? { OR: [{ researcher_profile: null }, { researcher_profile: { org_unit_id: null } }] } : { researcher_profile: { org_unit_id: { in: selectedUnits.map(unit => unit.id) } } },
  ]
  const q = (params.get('q') || '').trim().slice(0, 200)
  if (q) filters.push({ OR: [
    { name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } },
    { researcher_profile: { display_name: { contains: q, mode: 'insensitive' } } },
    { researcher_profile: { employee_id: { contains: q, mode: 'insensitive' } } },
  ] })
  const where: Prisma.UserWhereInput = { AND: filters }
  const [people, total] = await Promise.all([
    prisma.user.findMany({ where, select: { id: true, name: true, email: true, researcher_profile: { select: { display_name: true, employee_id: true, school: true, department: true } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit, skip: offset }),
    prisma.user.count({ where }),
  ])
  const assignments = await prisma.callAssignment.findMany({ where: { tenant_id: context.tenantId, funding_call_id: callId, assignee_user_id: { in: people.map(person => person.id) } }, select: { id: true, status: true, assignee_user_id: true } })
  return { faculty: people.map(person => {
    const assignment = assignments.find(a => a.assignee_user_id === person.id)
    return { userId: person.id, name: person.researcher_profile?.display_name || person.name || person.email, email: person.email,
      employeeId: person.researcher_profile?.employee_id, school: person.researcher_profile?.school || schools.find(s => s.id === schoolId)?.name,
      department: person.researcher_profile?.department, existingAssignment: assignment ? { id: assignment.id, status: assignment.status } : null }
  }), schools, total, limit, offset }
}

export async function allocationOptionsHandler(request: NextRequest, kind: 'calls' | 'faculty') {
  const context = await requireAllocationAccess(request)
  if (isAccessError(context)) return NextResponse.json({ error: context.error }, { status: context.status })
  try {
    const data = await (kind === 'calls' ? callOptions : facultyOptions)(context, request.nextUrl.searchParams)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof AllocationOptionsError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('Allocation options failed', error)
    return NextResponse.json({ error: 'Could not load allocation options. Please try again.' }, { status: 500 })
  }
}
