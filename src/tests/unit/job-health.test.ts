import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sweep that chases the chasers.
 *
 * Everything here is about not crying wolf. A stale job stays stale, and an
 * hourly sweep that says so hourly is a sweep people mute — at which point it is
 * worth less than nothing, because it looks like coverage.
 */

const { findFirstJobRun, findFirstNotification, findManyUsers, notifyQuietlyMock } = vi.hoisted(
  () => ({
    findFirstJobRun: vi.fn(),
    findFirstNotification: vi.fn(),
    findManyUsers: vi.fn(),
    notifyQuietlyMock: vi.fn(),
  })
)

vi.mock('@/lib/prisma', () => ({
  default: {
    jobRun: { findFirst: findFirstJobRun },
    notification: { findFirst: findFirstNotification },
    user: { findMany: findManyUsers },
  },
}))

vi.mock('@/lib/notifications/notificationService', () => ({ notifyQuietly: notifyQuietlyMock }))

const load = () => import('@/lib/jobs/healthSweep')

beforeEach(() => {
  vi.clearAllMocks()
  findManyUsers.mockResolvedValue([{ id: 'admin-1', tenantId: 'platform-tenant' }])
  findFirstNotification.mockResolvedValue(null)
})

describe('job health sweep', () => {
  it('says nothing when every job has run recently', async () => {
    findFirstJobRun.mockResolvedValue({ started_at: new Date() })
    const { sweepJobHealth } = await load()
    const result = await sweepJobHealth()

    expect(result.ok).toBe(result.checked)
    expect(result.unhealthy).toEqual([])
    expect(notifyQuietlyMock).not.toHaveBeenCalled()
  })

  it('does not even look up who to tell when nothing is wrong', async () => {
    // The healthy path runs every hour forever, so it should cost only the run
    // lookups it cannot avoid.
    findFirstJobRun.mockResolvedValue({ started_at: new Date() })
    const { sweepJobHealth } = await load()
    await sweepJobHealth()
    expect(findManyUsers).not.toHaveBeenCalled()
  })

  it('reports a job that has never succeeded, and says so in those words', async () => {
    findFirstJobRun.mockResolvedValue(null)
    const { sweepJobHealth } = await load()
    const result = await sweepJobHealth()

    expect(result.never).toBe(result.checked)
    expect(result.stale).toBe(0)
    expect(notifyQuietlyMock).toHaveBeenCalled()
    const notice = notifyQuietlyMock.mock.calls[0][0]
    expect(notice.title).toContain('has never run')
    expect(notice.body).toContain('no record of it ever succeeding')
    expect(notice.linkUrl).toBe('/super-admin/jobs')
  })

  it('reports a job that used to work and stopped', async () => {
    findFirstJobRun.mockResolvedValue({ started_at: new Date('2020-01-01') })
    const { sweepJobHealth } = await load()
    const result = await sweepJobHealth()

    expect(result.stale).toBe(result.checked)
    expect(result.never).toBe(0)
    expect(notifyQuietlyMock.mock.calls[0][0].title).toContain('is overdue')
  })

  it('stays quiet about a job it has already complained about today', async () => {
    findFirstJobRun.mockResolvedValue(null)
    findFirstNotification.mockResolvedValue({ id: 'said-already' })
    const { sweepJobHealth } = await load()
    const result = await sweepJobHealth()

    expect(result.suppressed).toBe(result.checked)
    expect(result.noticesSent).toBe(0)
    expect(notifyQuietlyMock).not.toHaveBeenCalled()
  })

  it('still counts a suppressed job as unhealthy', async () => {
    // Suppressing the notice must not make the sweep's own response claim the
    // job is fine — that response is what the console and the logs read.
    findFirstJobRun.mockResolvedValue(null)
    findFirstNotification.mockResolvedValue({ id: 'said-already' })
    const { sweepJobHealth } = await load()
    const result = await sweepJobHealth()

    expect(result.unhealthy.length).toBe(result.checked)
    expect(result.ok).toBe(0)
  })

  it('does nothing when there is nobody to tell', async () => {
    findFirstJobRun.mockResolvedValue(null)
    findManyUsers.mockResolvedValue([])
    const { sweepJobHealth } = await load()
    const result = await sweepJobHealth()

    expect(result.noticesSent).toBe(0)
    expect(notifyQuietlyMock).not.toHaveBeenCalled()
  })

  it('carries on after one notice fails', async () => {
    // Observability must never take down the thing it observes, which is the
    // same rule withJobRun follows.
    findFirstJobRun.mockResolvedValue(null)
    notifyQuietlyMock.mockRejectedValue(new Error('inbox exploded'))
    const { sweepJobHealth } = await load()
    const result = await sweepJobHealth()

    expect(result.checked).toBeGreaterThan(0)
    expect(result.noticesSent).toBe(0)
  })
})
