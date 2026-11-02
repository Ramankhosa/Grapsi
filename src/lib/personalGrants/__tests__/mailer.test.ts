import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const message = { to: 'owner@example.test', subject: 'Reminder', html: '<p>Reminder</p>' }
beforeEach(() => { vi.resetModules(); vi.stubEnv('MAILJET_API_KEY', 'test-key'); vi.stubEnv('MAILJET_API_SECRET', 'test-secret') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('confirmed email acceptance', () => {
  it('returns sent only when Mailjet confirms the message', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Messages: [{ Status: 'success' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { sendEmail } = await import('@/lib/mailer')
    expect(await sendEmail(message)).toEqual({ sent: true })
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
  it('does not treat an HTTP 200 with a rejected message as delivered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ Messages: [{ Status: 'error' }] }), { status: 200 })))
    const { sendEmail } = await import('@/lib/mailer')
    await expect(sendEmail(message)).rejects.toThrow(/confirm/)
  })
  it('does not accept an unparseable provider response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })))
    const { sendEmail } = await import('@/lib/mailer')
    await expect(sendEmail(message)).rejects.toThrow(/confirm/)
  })
})
