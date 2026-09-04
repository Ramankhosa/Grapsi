import { describe, it, expect } from 'vitest'

import { checkSocialSignInAllowed, normalizeEmail, type UserWithTenant } from '@/lib/social-auth'

function makeUser(overrides: Partial<UserWithTenant> = {}): UserWithTenant {
  return {
    id: 'u1',
    tenantId: 't1',
    status: 'ACTIVE',
    accessExpiresAt: null,
    tenant: { atiId: 'ATI-123', status: 'ACTIVE' },
    ...overrides
  } as unknown as UserWithTenant
}

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Ram.Singh@LPU.co.IN ')).toBe('ram.singh@lpu.co.in')
  })

  it('treats blank and missing values as null', () => {
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
  })
})

describe('checkSocialSignInAllowed', () => {
  it('allows an active tenant user', () => {
    expect(checkSocialSignInAllowed(makeUser())).toBeNull()
  })

  it('allows an active platform user', () => {
    const user = makeUser({ tenant: { atiId: 'PLATFORM', status: 'ACTIVE' } as never })
    expect(checkSocialSignInAllowed(user)).toBeNull()
  })

  it('blocks a suspended user', () => {
    expect(checkSocialSignInAllowed(makeUser({ status: 'SUSPENDED' as never })))
      .toBe('user_suspended')
  })

  it('blocks a user whose event access has expired', () => {
    const user = makeUser({ accessExpiresAt: new Date(Date.now() - 60_000) })
    expect(checkSocialSignInAllowed(user)).toBe('access_expired')
  })

  it('allows a user whose event access has not yet expired', () => {
    const user = makeUser({ accessExpiresAt: new Date(Date.now() + 60_000) })
    expect(checkSocialSignInAllowed(user)).toBeNull()
  })

  it('blocks a user with no tenant association', () => {
    const user = makeUser({ tenantId: null, tenant: null })
    expect(checkSocialSignInAllowed(user)).toBe('invalid_scope')
  })

  it('blocks a user whose tenant is inactive', () => {
    const user = makeUser({ tenant: { atiId: 'ATI-123', status: 'SUSPENDED' } as never })
    expect(checkSocialSignInAllowed(user)).toBe('scope_inactive')
  })
})
