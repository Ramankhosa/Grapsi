import { beforeEach, describe, expect, it, vi } from 'vitest'

// The daily hygiene sweep: ACTIVE users past accessExpiresAt are suspended,
// their refresh tokens revoked, and an audit row written. These tests pin the
// limit, the per-user failure isolation, and the null-tenant audit write.

const mocks = vi.hoisted(() => {
  const userFindMany = vi.fn()
  const userUpdate = vi.fn()
  const refreshTokenUpdateMany = vi.fn()
  const auditLogCreate = vi.fn()
  const transaction = vi.fn()
  const prismaMock = {
    user: { findMany: userFindMany, update: userUpdate },
    refreshToken: { updateMany: refreshTokenUpdateMany },
    auditLog: { create: auditLogCreate },
    $transaction: transaction,
  }
  return { userFindMany, userUpdate, refreshTokenUpdateMany, auditLogCreate, transaction, prismaMock }
})

vi.mock('@/lib/prisma', () => ({ default: mocks.prismaMock, prisma: mocks.prismaMock }))

import { expireEventUsers } from '@/lib/services/eventUserExpiryService'

const NOW = new Date('2026-09-01T12:00:00.000Z')

function expiredUser(id: string, tenantId: string | null = 'tenant-1') {
  return {
    id,
    email: `${id}@example.edu`,
    accessExpiresAt: new Date('2026-08-31T00:00:00.000Z'),
    tenantId,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // The service reads the updateMany result out of the transaction tuple:
  // [userUpdate, revoked, audit].
  mocks.transaction.mockResolvedValue([{}, { count: 2 }, {}])
})

describe('expireEventUsers', () => {
  it('returns zeros when nothing has expired', async () => {
    mocks.userFindMany.mockResolvedValue([])
    const result = await expireEventUsers({ now: NOW })
    expect(result).toEqual({ considered: 0, suspended: 0, tokensRevoked: 0, failed: 0 })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('queries only ACTIVE users past the cutoff, bounded by the limit', async () => {
    mocks.userFindMany.mockResolvedValue([])
    await expireEventUsers({ now: NOW, limit: 25 })
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', accessExpiresAt: { lte: NOW } },
        take: 25,
      })
    )
  })

  it('suspends each expired user and counts revoked tokens', async () => {
    mocks.userFindMany.mockResolvedValue([expiredUser('u1'), expiredUser('u2')])
    const result = await expireEventUsers({ now: NOW })
    expect(result).toEqual({ considered: 2, suspended: 2, tokensRevoked: 4, failed: 0 })
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
  })

  it('a null tenantId flows through to the audit row rather than crashing', async () => {
    mocks.userFindMany.mockResolvedValue([expiredUser('u1', null)])
    const result = await expireEventUsers({ now: NOW })
    expect(result.suspended).toBe(1)
    expect(mocks.auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: null }) })
    )
  })

  it('one failing user does not abort the batch', async () => {
    mocks.userFindMany.mockResolvedValue([expiredUser('u1'), expiredUser('u2'), expiredUser('u3')])
    mocks.transaction
      .mockResolvedValueOnce([{}, { count: 1 }, {}])
      .mockRejectedValueOnce(new Error('deadlock'))
      .mockResolvedValueOnce([{}, { count: 1 }, {}])
    const result = await expireEventUsers({ now: NOW })
    expect(result).toEqual({ considered: 3, suspended: 2, tokensRevoked: 2, failed: 1 })
  })
})
