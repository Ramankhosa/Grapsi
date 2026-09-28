import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), person: vi.fn(), people: vi.fn(), peopleCount: vi.fn(), call: vi.fn(), calls: vi.fn(), callCount: vi.fn(), units: vi.fn(), school: vi.fn(), assignments: vi.fn(), mappings: vi.fn() }))
vi.mock('@/lib/auth/tenantAccess', () => ({ requireTenantScope: m.auth, isAccessError: (v: any) => 'error' in v }))
vi.mock('@/lib/orgUnits/scope', () => ({ canAssignToUser: m.permission }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findFirst: m.person, findMany: m.people, count: m.peopleCount },
  fundingCall: { findFirst: m.call, findMany: m.calls, count: m.callCount },
  tenantOrgUnit: { findMany: m.units, findFirst: m.school },
  callAssignment: { findMany: m.assignments }, $queryRaw: m.mappings,
} }))
import { allocationOptionsHandler } from '@/lib/assignments/allocationOptions'
const context = { tenantId: 'tenant', user: { id: 'officer' }, scope: { canAssign: true, isTenantWide: false, managedUnitIds: ['school', 'dept'] } }
const units = [
  { id: 'school', name: 'Engineering', depth: 0, path: ['school'] },
  { id: 'dept', name: 'Design', depth: 1, path: ['school', 'dept'] },
  { id: 'other', name: 'Other school', depth: 0, path: ['other'] },
  { id: 'foreign-dept', name: 'Other department', depth: 1, path: ['other', 'foreign-dept'] },
]
function request(kind: 'calls' | 'faculty', query: string) { return allocationOptionsHandler(new NextRequest(`http://localhost/api/assignments/options/${kind}?${query}`), kind) }

beforeEach(() => {
  vi.resetAllMocks()
  m.auth.mockResolvedValue(context)
  m.permission.mockResolvedValue({ allowed: true, assigneeUnitId: 'dept' })
  m.person.mockResolvedValue({ id: 'person', name: 'Same Name', email: 'one@example.test', researcher_profile: { org_unit: { path: ['school', 'dept'] } } })
  m.people.mockResolvedValue([
    { id: 'one', name: 'Same Name', email: 'one@example.test', researcher_profile: { employee_id: '101', school: 'Engineering', department: 'Design' } },
    { id: 'two', name: 'Same Name', email: 'two@example.test', researcher_profile: { employee_id: '102', school: 'Engineering', department: 'Design' } },
  ])
  m.peopleCount.mockResolvedValue(42)
  m.call.mockResolvedValue({ id: 'call' })
  m.calls.mockResolvedValue([{ id: 'call', title: 'An unrelated call', scheme_title: null, agencyName: null, agency_name: 'Agency', close_date: null, deadlineAt: null }])
  m.callCount.mockResolvedValue(60)
  m.units.mockResolvedValue(units)
  m.school.mockResolvedValue({ name: 'Engineering' })
  m.assignments.mockResolvedValue([])
  m.mappings.mockResolvedValue([])
})

describe('manual allocation options', () => {
  it('returns an authorised school hierarchy without leaking faculty before school selection', async () => {
    const response = await request('faculty', 'fundingCallId=call')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.schools).toEqual([{ id: 'school', name: 'Engineering', departments: [{ id: 'dept', name: 'Design' }] }])
    expect(body.faculty).toEqual([])
    expect(m.people).not.toHaveBeenCalled()
  })
  it.each(['schoolId=other', 'schoolId=unknown', 'schoolId=school&departmentId=foreign-dept'])('rejects invalid scope %s', async scope => {
    expect((await request('faculty', `fundingCallId=call&${scope}`)).status).toBe(403)
    expect(m.people).not.toHaveBeenCalled()
  })
  it('shows same-name faculty with identifying details without requiring match data', async () => {
    m.assignments.mockResolvedValue([{ id: 'existing', status: 'DECLINED', assignee_user_id: 'two' }])
    const body = await (await request('faculty', 'fundingCallId=call&schoolId=school&departmentId=dept&q=Same&offset=20')).json()
    expect(body.faculty.map((p: any) => p.employeeId)).toEqual(['101', '102'])
    expect(body.faculty[1].existingAssignment).toEqual({ id: 'existing', status: 'DECLINED' })
    const args = m.people.mock.calls[0][0]
    expect(args).toMatchObject({ skip: 20, take: 20 })
    expect(JSON.stringify(args.where)).toContain('"org_unit_id":{"in":["dept"]}')
    expect(JSON.stringify(args.where)).toContain('"tenantId":"tenant"')
    expect(JSON.stringify(args)).not.toMatch(/embedding|match_score|research_areas/)
    expect(body.total).toBe(42)
  })
  it('restricts department-only grant holders while retaining the parent school label', async () => {
    m.auth.mockResolvedValue({ ...context, scope: { ...context.scope, managedUnitIds: ['dept'] } })
    const body = await (await request('faculty', 'fundingCallId=call&schoolId=school')).json()
    expect(body.schools[0].id).toBe('school')
    expect(JSON.stringify(m.people.mock.calls[0][0].where)).toContain('"org_unit_id":{"in":["dept"]}')
  })
  it('allows tenant-wide admins to find faculty with no profile or placement', async () => {
    m.auth.mockResolvedValue({ ...context, scope: { ...context.scope, isTenantWide: true } })
    m.people.mockResolvedValue([{ id: 'unprofiled', name: 'Unprofiled Faculty', email: 'unprofiled@example.test', researcher_profile: null }])
    const body = await (await request('faculty', 'fundingCallId=call&schoolId=__unplaced__')).json()
    expect(body.faculty[0].userId).toBe('unprofiled')
    expect(JSON.stringify(m.people.mock.calls[0][0].where)).toContain('"researcher_profile":null')
  })
  it('searches every accessible published call with deadline defaults and pagination', async () => {
    const body = await (await request('calls', 'assigneeUserId=person&q=Agency&offset=40')).json()
    expect(body.calls[0]).toMatchObject({ title: 'An unrelated call', isClosed: false, agency: 'Agency' })
    const args = m.calls.mock.calls[0][0]
    expect(args).toMatchObject({ skip: 40, take: 20 })
    const query = JSON.stringify(args.where)
    expect(query).toContain('PUBLISHED')
    expect(query).toContain('TENANT_PRIVATE')
    expect(query).toContain('is_active')
    expect(query).toContain('deadlineAt')
    expect(query).toContain('"agency_name":{"contains":"Agency"')
    expect(query).not.toMatch(/match_score|research_area|org_unit/)
  })
  it('shows closed calls only when requested or resolving a preselected call', async () => {
    m.calls.mockResolvedValue([{ id: 'call', title: 'Expired call', close_date: new Date('2000-01-01'), deadlineAt: null }])
    const body = await (await request('calls', 'assigneeUserId=person&includeClosed=true')).json()
    expect(body.calls[0].isClosed).toBe(true)
    expect(JSON.stringify(m.calls.mock.calls[0][0].where)).not.toContain('gte')
    await request('calls', 'assigneeUserId=person&callId=call')
    expect(JSON.stringify(m.calls.mock.calls[1][0].where)).not.toContain('gte')
  })
  it('includes existing allocations and the prior school-removal reason', async () => {
    m.assignments.mockResolvedValue([{ id: 'old', status: 'CANCELLED', funding_call_id: 'call' }])
    m.mappings.mockResolvedValue([{ call_id: 'call', is_active: false, ended_reason: 'Earlier decision' }])
    const body = await (await request('calls', 'assigneeUserId=person&callId=call')).json()
    expect(body.calls[0]).toMatchObject({ existingAssignment: { id: 'old', status: 'CANCELLED' }, responsibility: { willReopen: true, previousReason: 'Earlier decision' } })
  })
  it('refuses people outside the tenant or member coverage before reading calls', async () => {
    m.person.mockResolvedValueOnce(null)
    expect((await request('calls', 'assigneeUserId=foreign')).status).toBe(404)
    m.permission.mockResolvedValue({ allowed: false, reason: 'Outside coverage' })
    expect((await request('calls', 'assigneeUserId=person')).status).toBe(403)
    expect(m.calls).not.toHaveBeenCalled()
  })
  it('rejects unavailable calls, malformed paging and unauthorised users', async () => {
    m.call.mockResolvedValue(null)
    expect((await request('faculty', 'fundingCallId=draft')).status).toBe(404)
    expect((await request('calls', 'assigneeUserId=person&offset=-1')).status).toBe(400)
    m.auth.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    expect((await request('calls', 'assigneeUserId=person')).status).toBe(401)
  })
})
