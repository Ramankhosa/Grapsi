import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ email: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), call: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: { personalGrantEvent: { findMany: m.findMany, updateMany: m.updateMany }, fundingCall: { findFirst: m.call } } }))
vi.mock('@/lib/mailer', () => ({ sendEmail: m.email, SITE_URL: 'https://grants.example.test' }))
import { personalGrantReminderMessage, sweepPersonalGrantReminders } from '../reminders'
const now = new Date('2026-11-01T10:00:00Z')
const event = () => ({ id: 'event', title: '<Finish & review>', event_at: new Date('2026-11-02T10:00:00Z'), timezone: 'Asia/Kolkata', reminder_at: now, attempts: 0, revision: 0,
  personal_grant: { tenant_id: 'tenant-a', user: { email: 'owner@example.test', name: 'Owner', tenantId: 'tenant-a', status: 'ACTIVE', accessExpiresAt: null }, tenant: { status: 'ACTIVE' }, funding_call: { id: 'call', title: '<Private grant>', scheme_title: null } } })
beforeEach(() => {
  vi.resetAllMocks(); m.findMany.mockResolvedValue([event()]); m.updateMany.mockResolvedValue({ count: 1 }); m.call.mockResolvedValue({ id: 'call' }); m.email.mockResolvedValue({ sent: true })
})
describe('personal grant reminder delivery', () => {
  it('sends only to the grant owner and stamps SENT only after provider confirmation', async () => {
    const result = await sweepPersonalGrantReminders({ now })
    expect(result.sent).toBe(1); expect(m.email.mock.calls[0][0].to).toBe('owner@example.test')
    const completed = m.updateMany.mock.calls.find(([arg]) => arg.data.reminder_state === 'SENT')![0]
    expect(completed.where).toMatchObject({ id: 'event', reminder_state: 'SENDING', claim_token: expect.any(String) })
    expect(completed.data.sent_at).toBeInstanceOf(Date)
    expect(m.email.mock.calls[0][0].html).not.toContain('<Private grant>')
  })
  it('conditionally claims due entries by revision, preventing concurrent sends', async () => {
    let claimed = false
    m.updateMany.mockImplementation(async ({ data }) => {
      if (data.reminder_state === 'SENDING') { if (claimed) return { count: 0 }; claimed = true }
      return { count: 1 }
    })
    await Promise.all([sweepPersonalGrantReminders({ now }), sweepPersonalGrantReminders({ now })])
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(m.updateMany.mock.calls.find(([arg]) => arg.data.reminder_state === 'SENDING')![0].where).toMatchObject({ revision: 0, reminder_state: 'PENDING' })
  })
  it('retries an unconfigured provider without marking the reminder sent', async () => {
    m.email.mockResolvedValue({ sent: false })
    const result = await sweepPersonalGrantReminders({ now })
    expect(result.retrying).toBe(1); expect(result.sent).toBe(0)
    expect(m.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ reminder_state: 'PENDING', retry_at: new Date('2026-11-01T10:05:00Z') })
  })
  it('shows a terminal failure after bounded configuration retries', async () => {
    m.findMany.mockResolvedValue([{ ...event(), attempts: 4 }]); m.email.mockResolvedValue({ sent: false })
    expect((await sweepPersonalGrantReminders({ now })).failed).toBe(1)
    expect(m.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ reminder_state: 'FAILED' })
  })
  it('does not blindly retry an ambiguous provider failure', async () => {
    m.email.mockRejectedValue(new Error('Connection closed after acceptance'))
    expect((await sweepPersonalGrantReminders({ now })).failed).toBe(1)
    expect(m.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ reminder_state: 'FAILED', retry_at: null })
  })
  it.each(['suspended', 'moved', 'expired', 'tenant-closed', 'hidden-call'])('does not email an unavailable account/grant: %s', async condition => {
    const row = event()
    if (condition === 'suspended') row.personal_grant.user.status = 'SUSPENDED'
    if (condition === 'moved') row.personal_grant.user.tenantId = 'tenant-b'
    if (condition === 'expired') Object.assign(row.personal_grant.user, { accessExpiresAt: new Date('2020-01-01') })
    if (condition === 'tenant-closed') row.personal_grant.tenant.status = 'SUSPENDED'
    if (condition === 'hidden-call') m.call.mockResolvedValue(null)
    m.findMany.mockResolvedValue([row])
    expect((await sweepPersonalGrantReminders({ now })).failed).toBe(1); expect(m.email).not.toHaveBeenCalled()
  })
  it('marks abandoned sends for review rather than sending them a second time', async () => {
    m.findMany.mockResolvedValue([])
    expect((await sweepPersonalGrantReminders({ now })).recovered).toBe(1)
    expect(m.updateMany.mock.calls[0][0]).toMatchObject({ where: { reminder_state: 'SENDING', claimed_at: { lt: new Date('2026-11-01T09:50:00Z') } }, data: { reminder_state: 'FAILED' } })
    expect(m.email).not.toHaveBeenCalled()
  })
  it('escapes user-entered titles and links to the exact grant', () => {
    const message = personalGrantReminderMessage({ title: '<script>\nBudget & costs', callTitle: '<Grant>', callId: 'my-call', eventAt: now, timezone: 'Asia/Kolkata' })
    expect(message.html).toContain('&lt;script&gt;'); expect(message.html).toContain('&lt;Grant&gt;')
    expect(message.text).toContain('https://grants.example.test/finder/calls/my-call'); expect(message.subject).not.toContain('\n')
  })
})
