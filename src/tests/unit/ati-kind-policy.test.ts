import { describe, expect, it } from 'vitest'

import {
  computeAccessExpiresAt,
  DEFAULT_EVENT_ACCESS_HOURS,
  isAccessExpired,
  resolveAssignedRole,
  shouldPromoteFirstUserToOwner
} from '@/lib/ati-kind-policy'

const NOW = new Date('2026-07-09T10:00:00.000Z')

describe('ATI kind policy', () => {
  describe('shouldPromoteFirstUserToOwner', () => {
    it('promotes only for STANDARD tenants', () => {
      expect(shouldPromoteFirstUserToOwner('STANDARD')).toBe(true)
      expect(shouldPromoteFirstUserToOwner('MANAGED')).toBe(false)
      expect(shouldPromoteFirstUserToOwner('EVENT')).toBe(false)
    })
  })

  describe('resolveAssignedRole', () => {
    it('honors service roles on STANDARD tokens', () => {
      expect(resolveAssignedRole('STANDARD', 'ADMIN')).toEqual({ role: 'ADMIN', clamped: false })
      expect(resolveAssignedRole('STANDARD', 'MANAGER')).toEqual({ role: 'MANAGER', clamped: false })
      expect(resolveAssignedRole('STANDARD', 'ANALYST')).toEqual({ role: 'ANALYST', clamped: false })
    })

    it('rejects non-service roles on STANDARD tokens without clamping', () => {
      expect(resolveAssignedRole('STANDARD', 'OWNER')).toEqual({ role: null, clamped: false })
      expect(resolveAssignedRole('STANDARD', 'SUPER_ADMIN')).toEqual({ role: null, clamped: false })
    })

    it('clamps admin-capable roles to ANALYST on MANAGED/EVENT tokens', () => {
      expect(resolveAssignedRole('MANAGED', 'ADMIN')).toEqual({ role: 'ANALYST', clamped: true })
      expect(resolveAssignedRole('EVENT', 'MANAGER')).toEqual({ role: 'ANALYST', clamped: true })
      expect(resolveAssignedRole('EVENT', 'OWNER')).toEqual({ role: 'ANALYST', clamped: true })
    })

    it('allows ANALYST and VIEWER on MANAGED/EVENT tokens', () => {
      expect(resolveAssignedRole('EVENT', 'ANALYST')).toEqual({ role: 'ANALYST', clamped: false })
      expect(resolveAssignedRole('MANAGED', 'VIEWER')).toEqual({ role: 'VIEWER', clamped: false })
    })

    it('returns null when no role is assigned', () => {
      expect(resolveAssignedRole('STANDARD', null)).toEqual({ role: null, clamped: false })
      expect(resolveAssignedRole('EVENT', undefined)).toEqual({ role: null, clamped: false })
    })
  })

  describe('computeAccessExpiresAt', () => {
    it('returns null for non-EVENT kinds', () => {
      expect(
        computeAccessExpiresAt({ kind: 'STANDARD', memberAccessHours: 24, accessEndsAt: null }, NOW)
      ).toBeNull()
      expect(
        computeAccessExpiresAt({ kind: 'MANAGED', memberAccessHours: null, accessEndsAt: new Date() }, NOW)
      ).toBeNull()
    })

    it('uses signup time + memberAccessHours when only hours are set', () => {
      const result = computeAccessExpiresAt(
        { kind: 'EVENT', memberAccessHours: 8, accessEndsAt: null },
        NOW
      )
      expect(result).toEqual(new Date('2026-07-09T18:00:00.000Z'))
    })

    it('uses the hard cutoff when only accessEndsAt is set', () => {
      const cutoff = new Date('2026-07-09T17:00:00.000Z')
      const result = computeAccessExpiresAt(
        { kind: 'EVENT', memberAccessHours: null, accessEndsAt: cutoff },
        NOW
      )
      expect(result).toEqual(cutoff)
    })

    it('takes the earlier of hours window and hard cutoff', () => {
      const cutoff = new Date('2026-07-09T12:00:00.000Z')
      // 8h window would end at 18:00, but the event ends at 12:00
      expect(
        computeAccessExpiresAt({ kind: 'EVENT', memberAccessHours: 8, accessEndsAt: cutoff }, NOW)
      ).toEqual(cutoff)
      // 1h window ends before the 12:00 cutoff
      expect(
        computeAccessExpiresAt({ kind: 'EVENT', memberAccessHours: 1, accessEndsAt: cutoff }, NOW)
      ).toEqual(new Date('2026-07-09T11:00:00.000Z'))
    })

    it('falls back to the default window when nothing is configured', () => {
      const result = computeAccessExpiresAt(
        { kind: 'EVENT', memberAccessHours: null, accessEndsAt: null },
        NOW
      )
      expect(result).toEqual(new Date(NOW.getTime() + DEFAULT_EVENT_ACCESS_HOURS * 60 * 60 * 1000))
    })
  })

  describe('isAccessExpired', () => {
    it('never expires accounts without a window', () => {
      expect(isAccessExpired(null, NOW)).toBe(false)
      expect(isAccessExpired(undefined, NOW)).toBe(false)
    })

    it('detects expiry from Date and ISO string values', () => {
      expect(isAccessExpired(new Date('2026-07-09T09:59:59.000Z'), NOW)).toBe(true)
      expect(isAccessExpired('2026-07-09T09:59:59.000Z', NOW)).toBe(true)
      expect(isAccessExpired(new Date('2026-07-09T10:00:01.000Z'), NOW)).toBe(false)
      expect(isAccessExpired('2026-07-09T10:00:01.000Z', NOW)).toBe(false)
    })

    it('treats the exact boundary as expired', () => {
      expect(isAccessExpired(NOW, NOW)).toBe(true)
    })
  })
})
