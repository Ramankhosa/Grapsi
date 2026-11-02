import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const m = vi.hoisted(() => ({
  auth: vi.fn(), call: vi.fn(), grant: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
  event: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn() }, transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ default: { fundingCall: { findFirst: m.call }, personalGrant: m.grant, personalGrantEvent: m.event, $transaction: m.transaction } }))
vi.mock('@/lib/funding/access', () => ({ requireFundingActor: m.auth }))
import { localDateTime, localToUtc } from '../dates'
import { changeEvent, createEvent, parseEvent, saveItem } from '../server'
import { GET } from '@/app/api/funding/personal-grants/route'
import { GET as calendar } from '@/app/api/funding/personal-grants/calendar/route'
import { PATCH } from '@/app/api/funding/personal-grants/[callId]/route'
const owner = { tenant_id: 'tenant-a', user_id: 'user-a' }
const eventBody = { title: 'Finish budget', local_event_at: '2090-11-10T10:00', timezone: 'Asia/Kolkata', reminder_local_at: '2090-11-09T09:00' }
const request = (query = '') => new NextRequest(`http://localhost/api/funding/personal-grants?${query}`)
beforeEach(() => {
  vi.resetAllMocks()
  m.auth.mockResolvedValue({ actor: { id: 'user-a', tenantId: 'tenant-a' } })
  m.call.mockResolvedValue({ id: 'call' }); m.grant.upsert.mockResolvedValue({ id: 'personal' })
  m.grant.updateMany.mockResolvedValue({ count: 1 }); m.grant.findUnique.mockResolvedValue({ id: 'personal' }); m.grant.findUniqueOrThrow.mockResolvedValue({ funding_call_id: 'call' })
  m.grant.findMany.mockResolvedValue([]); m.grant.count.mockResolvedValue(0)
  m.event.findMany.mockResolvedValue([]); m.event.count.mockResolvedValue(0); m.event.updateMany.mockResolvedValue({ count: 1 }); m.event.deleteMany.mockResolvedValue({ count: 1 })
  m.transaction.mockImplementation(fn => fn({ personalGrant: m.grant, personalGrantEvent: m.event }))
})

describe('personal grant calendar dates', () => {
  it('round trips India, UTC and daylight-saving zones', () => {
    expect(localToUtc('2026-11-10T09:00', 'Asia/Kolkata').toISOString()).toBe('2026-11-10T03:30:00.000Z')
    expect(localToUtc('2026-07-10T09:00', 'America/New_York').toISOString()).toBe('2026-07-10T13:00:00.000Z')
    expect(localDateTime('2026-11-10T00:00:00Z', 'UTC')).toBe('2026-11-10T00:00')
  })
  it.each(['2026-02-30T09:00', '2026-13-01T09:00', '2026-11-10T25:00', '2026-1-10T09:00'])('rejects invalid wall time %s', value => {
    expect(() => localToUtc(value, 'UTC')).toThrow()
  })
  it('rejects missing or ambiguous daylight-saving hours and invalid zones', () => {
    expect(() => localToUtc('2026-03-08T02:30', 'America/New_York')).toThrow(/daylight/)
    expect(() => localToUtc('2026-11-01T01:30', 'America/New_York')).toThrow(/daylight/)
    expect(() => parseEvent({ ...eventBody, timezone: 'Never/Exists' })).toThrow(/zone/)
  })
  it('rejects past reminders and reminders after the event', () => {
    expect(() => parseEvent({ ...eventBody, reminder_local_at: '2020-01-01T09:00' })).toThrow(/future/)
    expect(() => parseEvent({ ...eventBody, reminder_local_at: '2090-11-11T09:00' })).toThrow(/before/)
  })
  it('allows historical calendar entries without scheduling an email', () => {
    expect(parseEvent({ ...eventBody, local_event_at: '2020-01-01T09:00', reminder_local_at: null }).reminder_at).toBeNull()
  })
})
describe('private grant ownership and saves', () => {
  it('takes tenant and person from authenticated context and never accepts a requested owner', async () => {
    await GET(request('view=favourites&user_id=other&tenant_id=other'))
    expect(m.grant.findMany.mock.calls[0][0].where).toMatchObject({ ...owner, is_favourite: true })
    expect(m.grant.findMany.mock.calls[0][0].where.funding_call.AND[0].OR).toEqual(expect.arrayContaining([expect.objectContaining({ AND: expect.arrayContaining([{ visibility: 'TENANT_PRIVATE' }, { tenantId: 'tenant-a' }]) })]))
  })
  it('batch-loads only requested call IDs within the same personal scope', async () => {
    await GET(request('callIds=first,second'))
    expect(m.grant.findMany.mock.calls[0][0].where).toMatchObject({ ...owner, funding_call_id: { in: ['first', 'second'] } })
  })
  it('returns auth failures without querying private records', async () => {
    m.auth.mockResolvedValue({ response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await GET(request())).status).toBe(401); expect(m.grant.findMany).not.toHaveBeenCalled()
  })
  it('blocks changes to an unavailable or other-tenant call', async () => {
    m.call.mockResolvedValue(null)
    await expect(saveItem(owner, 'hidden', { is_favourite: true })).rejects.toMatchObject({ status: 404 })
    expect(m.grant.upsert).not.toHaveBeenCalled()
  })
  it('removing a favourite preserves notes and calendar entries', async () => {
    await saveItem(owner, 'call', { is_favourite: false })
    expect(m.grant.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'personal', ...owner }, data: { is_favourite: false, notes: undefined } })
    expect(m.event.deleteMany).not.toHaveBeenCalled()
  })
  it('uses a note revision to avoid overwriting another tab', async () => {
    m.grant.updateMany.mockResolvedValue({ count: 0 })
    await expect(saveItem(owner, 'call', { notes: 'my draft', notes_revision: 3 })).rejects.toMatchObject({ status: 409 })
    expect(m.grant.updateMany.mock.calls[0][0].where).toMatchObject({ ...owner, notes_revision: 3 })
  })
  it('does not allow forged ownership or oversized notes in a PATCH', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api', { method: 'PATCH', body: JSON.stringify({ notes: 'private', notes_revision: 0, user_id: 'other' }) }), { params: { callId: 'call' } })
    expect(response.status).toBe(400); expect(m.grant.upsert).not.toHaveBeenCalled()
    await expect(saveItem(owner, 'call', { notes: 'x'.repeat(10001), notes_revision: 0 })).rejects.toThrow()
  })
  it('rejects invalid pagination and oversized batches', async () => {
    expect((await GET(request('page=1.5'))).status).toBe(400)
    expect((await GET(request(`callIds=${Array(101).fill('id').join(',')}`))).status).toBe(400)
  })
})
describe('calendar editing and cancellation', () => {
  it('saves UTC instants and a pending reminder under the personal grant', async () => {
    await createEvent(owner, 'call', eventBody)
    expect(m.event.create.mock.calls[0][0].data).toMatchObject({ personal_grant_id: 'personal', reminder_state: 'PENDING', event_at: new Date('2090-11-10T04:30:00Z'), reminder_at: new Date('2090-11-09T03:30:00Z') })
  })
  it('does not exceed the per-grant event limit', async () => {
    m.event.count.mockResolvedValue(100)
    await expect(createEvent(owner, 'call', eventBody)).rejects.toThrow(/100/)
    expect(m.event.create).not.toHaveBeenCalled()
  })
  it('returns 404 for a calendar entry belonging to someone else', async () => {
    m.event.findFirst.mockResolvedValue(null)
    await expect(changeEvent(owner, 'other', { revision: 0 }, true)).rejects.toMatchObject({ status: 404 })
    expect(m.event.findFirst.mock.calls[0][0].where).toMatchObject({ personal_grant: owner })
  })
  it('requires the original revision and refuses to cancel an email being sent', async () => {
    m.event.findFirst.mockResolvedValue({ id: 'event', personal_grant_id: 'personal' }); m.event.deleteMany.mockResolvedValue({ count: 0 })
    await expect(changeEvent(owner, 'event', { revision: 2 }, true)).rejects.toMatchObject({ status: 409 })
    expect(m.event.deleteMany.mock.calls[0][0].where).toMatchObject({ revision: 2, reminder_state: { not: 'SENDING' }, personal_grant: owner })
  })
  it('removes a reminder without deleting private notes', async () => {
    m.event.findFirst.mockResolvedValue({ id: 'event', personal_grant_id: 'personal', reminder_at: new Date('2090-11-09T03:30:00Z') })
    await changeEvent(owner, 'event', { ...eventBody, reminder_local_at: null, revision: 1 })
    expect(m.event.updateMany.mock.calls[0][0].data).toMatchObject({ reminder_state: 'NONE', reminder_at: null, retry_at: null })
    expect(m.grant.updateMany).not.toHaveBeenCalled()
  })
  it('editing an old sent entry does not resend its email', async () => {
    m.event.findFirst.mockResolvedValue({ id: 'event', personal_grant_id: 'personal', reminder_at: new Date('2020-01-01T03:30:00Z') })
    await changeEvent(owner, 'event', { ...eventBody, reminder_local_at: '2020-01-01T09:00', revision: 2 })
    expect(m.event.updateMany.mock.calls[0][0].data.reminder_state).toBeUndefined()
  })
  it('scopes the calendar by user, tenant and accessible grant, with bounded date ranges', async () => {
    expect((await calendar(request('from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z'))).status).toBe(200)
    expect(m.event.findMany.mock.calls[0][0].where.personal_grant).toMatchObject(owner)
    expect((await calendar(request('from=2026-01-01&to=2027-01-01'))).status).toBe(400)
  })
})
