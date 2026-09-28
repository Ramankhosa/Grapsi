import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { allocationCallClosed, createAssignmentSchema, ALLOCATION_REASONS } from '@/lib/assignments/manualAllocation'

const m = vi.hoisted(() => ({
  auth: vi.fn(), permission: vi.fn(), assignerUnit: vi.fn(), call: vi.fn(), user: vi.fn(), existing: vi.fn(),
  create: vi.fn(), transaction: vi.fn(), execute: vi.fn(), snapshot: vi.fn(), mapping: vi.fn(), notify: vi.fn(), candidates: vi.fn(),
}))
vi.mock('@/lib/auth/tenantAccess', () => ({ requireTenantScope: m.auth, isAccessError: (v: any) => 'error' in v }))
vi.mock('@/lib/orgUnits/scope', () => ({ canAssignToUser: m.permission, resolveAssignerUnitId: m.assignerUnit }))
vi.mock('@/lib/assignments/notifyAssignment', () => ({ notifyNewAssignment: m.notify }))
vi.mock('@/lib/fundingDept/opportunitySnapshot', () => ({ snapshotFundingOpportunity: m.snapshot }))
vi.mock('@/lib/assignments/manualAllocationMapping', () => ({ ensureManualAllocationMapping: m.mapping }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  fundingCall: { findFirst: m.call }, user: { findFirst: m.user }, callAssignment: { findUnique: m.existing },
  callCandidate: { updateMany: m.candidates }, $transaction: m.transaction,
} }))
import { POST } from '@/app/api/assignments/route'

const base = { fundingCallId: 'call', assigneeUserId: 'faculty' }
const manual = { ...base, allocationMethod: 'MANUAL', allocationReason: 'INDIRECT_FIT', allocationNote: 'Discussed with faculty', message: 'Please review the call' }
const tx = { callAssignment: { create: m.create }, $executeRaw: m.execute }
function request(body: unknown) { return new NextRequest('http://localhost/api/assignments', { method: 'POST', body: JSON.stringify(body) }) }

beforeEach(() => {
  vi.resetAllMocks()
  m.auth.mockResolvedValue({ tenantId: 'tenant', user: { id: 'officer' }, scope: { canAssign: true } })
  m.permission.mockResolvedValue({ allowed: true, assigneeUnitId: 'department' })
  m.assignerUnit.mockResolvedValue(null)
  m.call.mockResolvedValue({ id: 'call' })
  m.user.mockResolvedValue({ id: 'faculty', name: 'Faculty', email: 'faculty@example.test' })
  m.existing.mockResolvedValue(null)
  m.create.mockImplementation(async ({ data }) => ({ ...data, id: 'allocation', status: 'ASSIGNED' }))
  m.transaction.mockImplementation(async (work) => work(tx))
  m.snapshot.mockResolvedValue(undefined)
  m.mapping.mockResolvedValue(undefined)
  m.notify.mockResolvedValue(undefined)
  m.candidates.mockResolvedValue({ count: 0 })
})

describe('manual allocation validation and deadlines', () => {
  it.each(ALLOCATION_REASONS)('accepts %s with an optional note', reason => {
    expect(createAssignmentSchema.parse({ ...manual, allocationReason: reason, allocationNote: undefined }).allocationReason).toBe(reason)
  })
  it('requires a manual reason, rejects unknown reasons and notes over 2000 characters', () => {
    for (const body of [{ ...manual, allocationReason: null }, { ...manual, allocationReason: 'OTHER' }, { ...manual, allocationNote: 'a'.repeat(2001) }, { ...manual, allocationMethod: undefined }]) {
      expect(createAssignmentSchema.safeParse(body).success).toBe(false)
    }
    expect(createAssignmentSchema.safeParse(base).success).toBe(true)
  })
  it('keeps undated and same India calendar-day calls open', () => {
    const now = new Date('2026-09-25T17:00:00Z')
    expect(allocationCallClosed(null, now)).toBe(false)
    expect(allocationCallClosed('2026-09-25T00:00:00Z', now)).toBe(false)
    expect(allocationCallClosed('2026-09-24T00:00:00Z', now)).toBe(true)
    expect(allocationCallClosed('2026-09-25T00:00:00Z', new Date('2026-09-25T19:00:00Z'))).toBe(true)
  })
})

describe('allocation creation', () => {
  it('saves an unmatched allocation, mapping and snapshot in one transaction before notifying', async () => {
    const order: string[] = []
    m.transaction.mockImplementation(async (work) => { const result = await work(tx); order.push('commit'); return result })
    m.notify.mockImplementation(async () => { order.push('notify') })
    const response = await POST(request({ ...manual, matchScore: 99, matchTier: 'direct' }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ assignment: { status: 'ASSIGNED', allocationMethod: 'MANUAL', allocationReason: 'INDIRECT_FIT', allocationNote: manual.allocationNote, matchScore: null, matchTier: null } })
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignee_org_unit_id: 'department', message: manual.message, match_basis: null }) }))
    expect(m.mapping).toHaveBeenCalledWith(tx, expect.objectContaining({ tenantId: 'tenant', orgUnitId: 'department', actorId: 'officer' }))
    const audit = m.execute.mock.calls.find(([query]) => query.sql.includes('INSERT INTO dsr_events'))?.[0]
    expect(audit.sql).toContain("'ALLOCATION'")
    expect(audit.values).toContain('call')
    expect(audit.values).toContain(JSON.stringify({ assignmentId: 'allocation', facultyName: 'Faculty', allocationReason: 'INDIRECT_FIT', allocationNote: manual.allocationNote }))
    expect(m.snapshot).toHaveBeenCalledWith(expect.objectContaining({ score: null, tier: null, sourceVersion: 'manual-allocation-v1' }), tx)
    expect(order).toEqual(['commit', 'notify'])
  })
  it('preserves legacy matched-assignment metadata', async () => {
    expect((await POST(request({ ...base, matchScore: 83, matchTier: 'direct', matchBasis: 'combined' }))).status).toBe(201)
    expect(m.create.mock.calls[0][0].data).toMatchObject({ match_score: 83, match_tier: 'direct', match_basis: 'combined', allocation_method: null })
    expect(m.mapping).not.toHaveBeenCalled()
  })
  it('denies missing permissions before discovery or writes', async () => {
    m.auth.mockResolvedValue({ tenantId: 'tenant', scope: { canAssign: false } })
    expect((await POST(request(manual))).status).toBe(403)
    expect(m.call).not.toHaveBeenCalled()
  })
  it('denies out-of-coverage faculty and inaccessible calls', async () => {
    m.permission.mockResolvedValue({ allowed: false, reason: 'Outside coverage' })
    expect((await POST(request(manual))).status).toBe(403)
    m.call.mockResolvedValue(null)
    expect((await POST(request(manual))).status).toBe(404)
    expect(m.transaction).not.toHaveBeenCalled()
  })
  it('validates the reason on the server before writing', async () => {
    expect((await POST(request({ ...manual, allocationReason: undefined }))).status).toBe(400)
    expect(m.transaction).not.toHaveBeenCalled()
  })
  it('returns existing records, including closed allocations, without notifying', async () => {
    m.existing.mockResolvedValue({ id: 'old-allocation' })
    const response = await POST(request(manual))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ assignmentId: 'old-allocation' })
    expect(m.transaction).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })
  it('resolves a concurrent duplicate into the same existing allocation', async () => {
    m.existing.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winning-allocation' })
    m.transaction.mockRejectedValue({ code: 'P2002' })
    const response = await POST(request(manual))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ assignmentId: 'winning-allocation' })
    expect(m.notify).not.toHaveBeenCalled()
  })
  it('does not notify when the mapping transaction fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    m.mapping.mockRejectedValue(new Error('Mapping unavailable'))
    expect((await POST(request(manual))).status).toBe(500)
    expect(m.snapshot).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
    log.mockRestore()
  })
  it('returns the saved allocation even if notification delivery fails', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    m.notify.mockRejectedValue(new Error('Offline'))
    expect((await POST(request(manual))).status).toBe(201)
    log.mockRestore()
  })
})
