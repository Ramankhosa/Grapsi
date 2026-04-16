import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyJWTMock, findUniqueMock } = vi.hoisted(() => ({
  verifyJWTMock: vi.fn(),
  findUniqueMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  verifyJWT: verifyJWTMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: findUniqueMock,
    },
  },
}))

import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge'

describe('auth-bridge', () => {
  beforeEach(() => {
    verifyJWTMock.mockReset()
    findUniqueMock.mockReset()
  })

  it('reads Authorization headers case-insensitively', async () => {
    verifyJWTMock.mockReturnValue({
      sub: 'user-1',
      email: 'user@example.com',
      tenant_id: 'tenant-1',
      roles: [],
      ati_id: null,
      tenant_ati_id: null,
      scope: 'tenant',
      iat: 1,
      exp: 2,
    })
    findUniqueMock.mockResolvedValue({
      id: 'tenant-1',
      status: 'ACTIVE',
      tenantPlans: [{ planId: 'plan-1' }],
    })

    const tenantContext = await extractTenantContextFromRequest({
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(verifyJWTMock).toHaveBeenCalledWith('test-token')
    expect(findUniqueMock).toHaveBeenCalled()
    expect(tenantContext).toEqual({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      tenantStatus: 'ACTIVE',
      userId: 'user-1',
    })
  })
})
