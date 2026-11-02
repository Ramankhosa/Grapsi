import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Audit probes use synthetic records. No database, network delivery or real user writes.
const m = vi.hoisted(() => ({
  query: vi.fn(), find: vi.fn(), call: vi.fn(), update: vi.fn(), followUp: vi.fn(), execute: vi.fn(), notify: vi.fn(),
}))
vi.mock('@/lib/prisma', () => {
  const db = { $queryRaw: m.query, $executeRaw: m.execute,
    callAssignment: { findFirst: m.find, update: m.update }, fundingCall: { findFirst: m.call },
    assignmentFollowUp: { create: m.followUp }, callCandidate: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: async (fn: any) => fn(db),
  }
  return { default: db, prisma: db }
})
vi.mock('@/lib/auth/tenantAccess', () => ({
  requireTenantUser: async () => ({ tenantId: 'tenant', user: { id: 'manager' } }),
  withOrgScope: async () => ({ scope: {} }), isAccessError: () => false,
}))
vi.mock('@/lib/orgUnits/scope', () => ({ canManageAssignment: () => true }))
vi.mock('@/lib/assignments/shared', async importOriginal => ({
  ...await importOriginal<any>(), serializeAssignment: (r: any) => r,
}))
vi.mock('@/lib/tenant/locale', () => ({ getTenantTimeZone: async () => 'Asia/Kolkata',
  getTenantLocale: async () => ({ timezone: 'Asia/Kolkata', currency: 'INR', locale: 'en-IN' }),
}))
vi.mock('@/lib/fundingDept/shared', () => ({ submissionWatchers: async () => [] }))
vi.mock('@/lib/notifications/notificationService', () => ({ notifyQuietly: m.notify }))

import { PATCH } from '@/app/api/assignments/[id]/route'
import { buildSubmissionUpdate } from '@/lib/assignments/submission'
import { getFollowUpReport } from '@/lib/fundingDept/followUpReport'
import { actionStatus, responsibilityPendencyState } from '@/lib/fundingDept/reportDefinitions'

const now = new Date('2026-10-31T12:00:00Z')
const assignment = { id: 'a', funding_call_id: 'call', tenant_id: 'tenant', assignee_user_id: 'faculty',
  assignee_org_unit_id: 'school', assigned_by_user_id: 'manager', status: 'IN_PROGRESS', outcome: 'PENDING',
  created_at: new Date('2026-10-01'), updated_at: now, auto_nudge_stages: [],
  assignee: { id: 'faculty', name: 'Faculty', status: 'INACTIVE' },
  funding_call: { id: 'call', title: 'Expired fixture call', close_date: new Date('2000-01-01') },
}
const reportFilters = { schoolIds: ['school'], weeks: 4, asOf: now, page: 1, pageSize: 25, timeZone: 'Asia/Kolkata' }
const entry = { id: 'note', assignment_id: 'a', funding_call_id: 'call', kind: 'NOTE', contact_target: 'INTERNAL',
  stage: null, note: 'Reviewed internally', happened_at: new Date('2026-10-27'), created_by_user_id: 'previous-owner',
  author: 'Previous owner', week: new Date('2026-10-26'), school_name: 'School', call_title: 'Call', faculty_name: 'Faculty', is_faculty: false,
}
const reportAssignment = { id: 'a', funding_call_id: 'call', call_title: 'Call', faculty_name: 'Faculty', school_name: 'School',
  status: 'IN_PROGRESS', created_at: assignment.created_at, closed_at: null, owner_id: 'current-owner', owner_name: 'Current owner',
  first_contact: null, last_follow_up: entry.happened_at, stages: [], submitted: false,
  week_owners: Object.fromEntries(['2026-10-05','2026-10-12','2026-10-19','2026-10-26'].map((week,index) => [week, index < 3 ? {id:'previous-owner',name:'Previous owner'} : {id:'current-owner',name:'Current owner'}])),
}
const patch = (body: Record<string, unknown>) => PATCH(new NextRequest('http://localhost/api/assignments/a', {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}), { params: { id: 'a' } })
beforeEach(() => {
  vi.clearAllMocks()
  m.find.mockResolvedValue(assignment)
  m.call.mockResolvedValue({close_date:new Date('2000-01-01')})
  m.update.mockImplementation(async ({ data }: any) => ({ ...assignment, ...data }))
  m.followUp.mockResolvedValue({ id: 'synthetic' })
  m.query.mockResolvedValueOnce([entry]).mockResolvedValueOnce([reportAssignment])
})

describe('DSR reporting integrity regressions', () => {
  it('an internal note cannot clear the faculty-contact alert', async () => {
    const r = await getFollowUpReport('tenant', reportFilters)
    expect(r.totals).toMatchObject({ followUps: 1, facultyContacts: 0, silentThisWeek: 1 })
  })
  it('the same allocation becomes silent under the faculty-contacts-only lens', async () => {
    const r = await getFollowUpReport('tenant', { ...reportFilters, facultyOnly: true })
    expect(r.totals).toMatchObject({ followUps: 0, facultyContacts: 0, silentThisWeek: 1 })
  })
  it('historical weeks retain their dated owner after a transfer', async () => {
    const r = await getFollowUpReport('tenant', reportFilters)
    const owner = r.members.find(p => p.userId === 'current-owner')!
    expect(Object.values(owner.weeks).map(w => w.active)).toEqual([0, 0, 0, 1])
    expect(r.members.find(p => p.userId === 'previous-owner')?.total.followUps).toBe(1)
  })
  it('the contact log exposes older entries on its own page', async () => {
    m.query.mockReset().mockResolvedValueOnce(Array.from({ length: 51 }, (_, i) => ({ ...entry, id: `e${i}` }))).mockResolvedValueOnce([reportAssignment])
    const r = await getFollowUpReport('tenant', {...reportFilters,logPage:3})
    expect(r.logTotal).toBe(51); expect(r.log).toHaveLength(1); expect(r.log[0].id).toBe('e50')
  })
  it('a notes-only backdated claim is accepted as completed', async () => {
    const r = await patch({ status: 'COMPLETED', submissionNotes: 'Faculty said submitted', submittedAt: '2026-10-09' })
    expect(r.status).toBe(200)
    expect(m.update.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED', submission_evidence_status: 'NOTE', submitted_at: new Date('2026-10-09') })
  })
  it('a direct update rejects a future submission date', async () => {
    const r = await patch({ status: 'COMPLETED', submissionNotes: 'Synthetic claim', submittedAt: '2099-01-01' })
    expect(r.status).toBe(400)
    expect(m.update).not.toHaveBeenCalled()
  })
  it('unallocation requires an explanation on the server', async () => {
    const r = await patch({ status: 'CANCELLED' })
    expect(r.status).toBe(400)
    expect(m.followUp).not.toHaveBeenCalled()
  })
  it('reactivation rejects inactive faculty even through a status update', async () => {
    m.find.mockResolvedValue({ ...assignment, status: 'CANCELLED' })
    const r = await patch({ status: 'ASSIGNED' })
    expect(r.status).toBe(409)
    expect(m.update).not.toHaveBeenCalled()
  })
  it('reactivation also rejects a closed entry stage for active faculty', async () => {
    m.find.mockResolvedValue({...assignment,status:'CANCELLED',assignee:{...assignment.assignee,status:'ACTIVE'}})
    const response=await patch({status:'ASSIGNED'})
    expect(response.status).toBe(409);expect(m.update).not.toHaveBeenCalled()
  })
  it('a date-only edit cannot bypass the future-submission guard',async()=>{
    const response=await patch({submittedAt:'2099-01-01'})
    expect(response.status).toBe(400);expect(m.update).not.toHaveBeenCalled()
  })
  it('invalid calendar dates cannot be silently normalized',async()=>{
    const response=await patch({status:'COMPLETED',submittedAt:'2026-02-30',submissionNotes:'Claim'})
    expect(response.status).toBe(400);expect(m.update).not.toHaveBeenCalled()
  })
  it('a reasoned cancellation writes its explanation together with the status update',async()=>{
    const response=await patch({status:'CANCELLED',cancelReason:'Researcher unavailable; reviewing a replacement.'})
    expect(response.status).toBe(200);expect(m.followUp).toHaveBeenCalledTimes(1)
    expect(m.followUp.mock.calls[0][0].data).toMatchObject({contact_target:'INTERNAL',note:'Unallocated by the department. Researcher unavailable; reviewing a replacement.'})
  })
  it('completed DSR action can coexist with an outstanding application', () => {
    expect(actionStatus({ actionCompletedAt: now, triageDecidedAt: null, shortlisted: 0, allocations: 1, followUps: 0, namedActions: 0 })).toBe('COMPLETED')
    expect(responsibilityPendencyState({ daysToDeadline: 5, submissionsAtDeadline: 0, allocationsAtDeadline: 0,
      closedAtDeadline: false, submissions: 0, takenUp: 1, closedNow: false })).toBe('AT_RISK')
  })
  it('the shared submission builder rejects future dated claims', () => {
    const r = buildSubmissionUpdate({ record: {}, notes: 'Claim', submittedAt: new Date('2099-01-01'), now })
    expect(r.ok).toBe(false)
  })
})
