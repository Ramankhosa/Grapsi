import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findTenantMock,
  findUserMock,
  findManyUsersMock,
  updateUserMock,
  transactionMock
} = vi.hoisted(() => ({
  findTenantMock: vi.fn(),
  findUserMock: vi.fn(),
  findManyUsersMock: vi.fn(),
  updateUserMock: vi.fn(),
  transactionMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findUnique: findTenantMock },
    user: {
      findUnique: findUserMock,
      findMany: findManyUsersMock,
      update: updateUserMock
    },
    $transaction: transactionMock
  }
}))

import { changeTenantAdmin, withHierarchyRole } from '@/lib/tenant-admin-service'

const ACTIVE_TENANT = { id: 't1', name: 'Acme University', atiId: 'ACME', status: 'ACTIVE' }

const TARGET = {
  id: 'u-new',
  email: 'new.admin@acme.edu',
  name: 'New Admin',
  roles: ['ANALYST'],
  status: 'ACTIVE',
  tenantId: 't1'
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    newAdminUserId: 'u-new',
    role: 'OWNER' as const,
    demoteCurrentTo: 'ADMIN' as const,
    actorUserId: 'super-admin',
    ...overrides
  }
}

describe('tenant admin service', () => {
  beforeEach(() => {
    findTenantMock.mockReset()
    findUserMock.mockReset()
    findManyUsersMock.mockReset()
    updateUserMock.mockReset()
    transactionMock.mockReset()

    // Run the callback against a tx that records the same update calls.
    transactionMock.mockImplementation(async (cb: any) =>
      cb({ user: { update: updateUserMock } })
    )
  })

  describe('withHierarchyRole', () => {
    it('replaces the hierarchy slot', () => {
      expect(withHierarchyRole(['ANALYST'] as any, 'OWNER' as any)).toEqual(['OWNER'])
    })

    it('keeps additive tags across a promotion', () => {
      expect(withHierarchyRole(['ANALYST', 'CALL_ADMIN', 'QUALITY_AUDITOR'] as any, 'OWNER' as any))
        .toEqual(['OWNER', 'CALL_ADMIN', 'QUALITY_AUDITOR'])
    })

    it('does not duplicate a role the user already holds', () => {
      expect(withHierarchyRole(['ADMIN', 'MEMBER'] as any, 'ADMIN' as any)).toEqual(['ADMIN', 'MEMBER'])
    })
  })

  describe('changeTenantAdmin', () => {
    it('promotes the target and demotes the sitting owner', async () => {
      findTenantMock.mockResolvedValue(ACTIVE_TENANT)
      findUserMock.mockResolvedValue(TARGET)
      findManyUsersMock.mockResolvedValue([
        { id: 'u-old', email: 'old@acme.edu', name: 'Old Owner', roles: ['OWNER', 'CALL_ADMIN'] }
      ])

      const result = await changeTenantAdmin(baseInput())

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.promoted.newRoles).toEqual(['OWNER'])
      expect(result.demoted).toHaveLength(1)
      // The outgoing owner keeps CALL_ADMIN — demotion moves the slot, not the tags.
      expect(result.demoted[0].newRoles).toEqual(['ADMIN', 'CALL_ADMIN'])

      expect(updateUserMock).toHaveBeenCalledWith({
        where: { id: 'u-new' },
        data: { roles: ['OWNER'] }
      })
      expect(updateUserMock).toHaveBeenCalledWith({
        where: { id: 'u-old' },
        data: { roles: ['ADMIN', 'CALL_ADMIN'] }
      })
    })

    it('leaves the sitting owner alone when no demotion is requested', async () => {
      findTenantMock.mockResolvedValue(ACTIVE_TENANT)
      findUserMock.mockResolvedValue(TARGET)
      findManyUsersMock.mockResolvedValue([
        { id: 'u-old', email: 'old@acme.edu', name: 'Old Owner', roles: ['OWNER'] }
      ])

      const result = await changeTenantAdmin(baseInput({ demoteCurrentTo: null }))

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.demoted).toEqual([])
      expect(updateUserMock).toHaveBeenCalledTimes(1)
    })

    it('excludes the incoming admin from the demotion set', async () => {
      findTenantMock.mockResolvedValue(ACTIVE_TENANT)
      findUserMock.mockResolvedValue(TARGET)
      findManyUsersMock.mockResolvedValue([])

      await changeTenantAdmin(baseInput())

      expect(findManyUsersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'u-new' } })
        })
      )
    })

    it('refuses the platform tenant', async () => {
      findTenantMock.mockResolvedValue({ ...ACTIVE_TENANT, atiId: 'PLATFORM' })

      const result = await changeTenantAdmin(baseInput())

      expect(result).toMatchObject({ ok: false, code: 'INVALID_TENANT', status: 400 })
      expect(updateUserMock).not.toHaveBeenCalled()
    })

    it('refuses a user from another tenant', async () => {
      findTenantMock.mockResolvedValue(ACTIVE_TENANT)
      findUserMock.mockResolvedValue({ ...TARGET, tenantId: 'other-tenant' })

      const result = await changeTenantAdmin(baseInput())

      expect(result).toMatchObject({ ok: false, code: 'USER_NOT_IN_TENANT', status: 404 })
      expect(updateUserMock).not.toHaveBeenCalled()
    })

    it('refuses a suspended user', async () => {
      findTenantMock.mockResolvedValue(ACTIVE_TENANT)
      findUserMock.mockResolvedValue({ ...TARGET, status: 'SUSPENDED' })

      const result = await changeTenantAdmin(baseInput())

      expect(result).toMatchObject({ ok: false, code: 'USER_NOT_ACTIVE', status: 400 })
      expect(updateUserMock).not.toHaveBeenCalled()
    })

    it('refuses to hand a tenant seat to platform staff', async () => {
      findTenantMock.mockResolvedValue(ACTIVE_TENANT)
      findUserMock.mockResolvedValue({ ...TARGET, roles: ['SUPER_ADMIN'] })

      const result = await changeTenantAdmin(baseInput())

      expect(result).toMatchObject({ ok: false, code: 'PLATFORM_USER', status: 400 })
      expect(updateUserMock).not.toHaveBeenCalled()
    })
  })
})
