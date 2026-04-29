import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyJWTMock, userFindUniqueMock } = vi.hoisted(() => ({
  verifyJWTMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyJWT: verifyJWTMock,
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}))

import { getReviewerSession, requireReviewerSession } from '@/lib/reviewer-auth-api'

describe('reviewer-auth-api', () => {
  beforeEach(() => {
    verifyJWTMock.mockReset()
    userFindUniqueMock.mockReset()
  })

  it('returns a NextAuth-like session for an active Grapsi JWT user', async () => {
    verifyJWTMock.mockReturnValue({ sub: 'user-1' })
    userFindUniqueMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Reviewer User',
      tenantId: 'tenant-1',
      roles: ['ANALYST'],
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
    })

    const session = await getReviewerSession({
      headers: { authorization: 'Bearer jwt-token' },
    })

    expect(verifyJWTMock).toHaveBeenCalledWith('jwt-token')
    expect(session).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Reviewer User',
        tenantId: 'tenant-1',
        roles: ['ANALYST'],
      },
    })
  })

  it('rejects missing, inactive, or tenant-disabled sessions', async () => {
    await expect(getReviewerSession({ headers: {} })).resolves.toBeNull()

    verifyJWTMock.mockReturnValue({ sub: 'user-1' })
    userFindUniqueMock.mockResolvedValue({
      id: 'user-1',
      status: 'ACTIVE',
      tenant: { status: 'SUSPENDED' },
    })

    await expect(
      getReviewerSession({ headers: { authorization: 'Bearer jwt-token' } })
    ).resolves.toBeNull()
  })

  it('writes the donor-compatible unauthorized response', () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any

    expect(requireReviewerSession(null, res)).toBe(false)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' })
  })
})
