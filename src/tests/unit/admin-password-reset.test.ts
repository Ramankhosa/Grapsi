import { beforeEach, describe, expect, it, vi } from 'vitest'

// Administrator-issued password recovery. What matters here is not the happy
// path — it is the set of things the module must refuse, and the cleanup that
// has to happen alongside a manually set password: old reset links burned,
// sessions revoked, the forced-change flag set.

const mocks = vi.hoisted(() => {
  const userFindUnique = vi.fn()
  const userUpdate = vi.fn()
  const resetCreate = vi.fn()
  const resetUpdateMany = vi.fn()
  const transaction = vi.fn()
  const prismaMock = {
    user: { findUnique: userFindUnique, update: userUpdate },
    passwordResetToken: { create: resetCreate, updateMany: resetUpdateMany },
    $transaction: transaction,
  }
  const createAuditLog = vi.fn()
  const hashPassword = vi.fn()
  const revokeAllUserTokens = vi.fn()
  const sendEmail = vi.fn()
  return {
    userFindUnique,
    userUpdate,
    resetCreate,
    resetUpdateMany,
    transaction,
    prismaMock,
    createAuditLog,
    hashPassword,
    revokeAllUserTokens,
    sendEmail,
  }
})

vi.mock('@/lib/prisma', () => ({ default: mocks.prismaMock, prisma: mocks.prismaMock }))
vi.mock('@/lib/auth', () => ({
  createAuditLog: mocks.createAuditLog,
  hashPassword: mocks.hashPassword,
  revokeAllUserTokens: mocks.revokeAllUserTokens,
}))
vi.mock('@/lib/mailer', () => ({
  sendEmail: mocks.sendEmail,
  SITE_URL: 'https://app.example.com',
  // email-templates reads the brand name off the mailer at module load.
  MAIL_FROM_NAME: 'Grapsi',
}))

import {
  MIN_TEMPORARY_PASSWORD_LENGTH,
  generateTemporaryPassword,
  issuePasswordReset,
  requirePasswordChange,
  setTemporaryPassword,
  startForcedPasswordChange,
} from '@/lib/admin-password-reset'

const ACTOR = 'actor-1'

function targetUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'faculty@university.edu',
    name: 'A Faculty',
    passwordHash: 'argon2-hash',
    oauthProvider: null,
    status: 'ACTIVE',
    tenantId: 'tenant-1',
    tenant: { name: 'Example University' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userFindUnique.mockResolvedValue(targetUser())
  mocks.resetUpdateMany.mockResolvedValue({ count: 0 })
  mocks.resetCreate.mockResolvedValue({})
  mocks.userUpdate.mockResolvedValue({})
  mocks.transaction.mockResolvedValue([{}, {}])
  mocks.hashPassword.mockResolvedValue('new-hash')
  mocks.sendEmail.mockResolvedValue(undefined)
})

describe('guards shared by every action', () => {
  it('refuses to act on the actor’s own account', async () => {
    const result = await issuePasswordReset({ targetUserId: ACTOR, actorUserId: ACTOR, sendEmail: true })
    expect(result).toMatchObject({ ok: false, code: 'SELF_TARGET', status: 400 })
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it('404s an unknown user', async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    const result = await issuePasswordReset({ targetUserId: 'nobody', actorUserId: ACTOR, sendEmail: false })
    expect(result).toMatchObject({ ok: false, code: 'USER_NOT_FOUND', status: 404 })
  })

  it('refuses a social-only account rather than inventing a password login', async () => {
    mocks.userFindUnique.mockResolvedValue(targetUser({ passwordHash: null, oauthProvider: 'GOOGLE' }))
    const result = await issuePasswordReset({ targetUserId: 'user-1', actorUserId: ACTOR, sendEmail: false })
    expect(result).toMatchObject({ ok: false, code: 'SOCIAL_ACCOUNT' })
    expect((result as { message: string }).message).toContain('Google')
  })
})

describe('issuePasswordReset', () => {
  it('burns outstanding links, mints one, and returns it', async () => {
    const result = await issuePasswordReset({ targetUserId: 'user-1', actorUserId: ACTOR, sendEmail: false })

    expect(result.ok).toBe(true)
    expect(mocks.resetUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1', usedAt: null }) })
    )
    expect(mocks.resetCreate).toHaveBeenCalledTimes(1)
    if (!result.ok) throw new Error('expected success')
    expect(result.resetLink).toMatch(/^https:\/\/app\.example\.com\/reset-password\?token=/)
    // Not sent, not attempted, so no error to report either.
    expect(result.emailSent).toBe(false)
    expect(result.emailError).toBeNull()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_PASSWORD_RESET_ISSUED', resource: 'user:user-1' })
    )
  })

  it('works for an account that never set a password — the link becomes an activation', async () => {
    mocks.userFindUnique.mockResolvedValue(targetUser({ passwordHash: null }))
    const result = await issuePasswordReset({ targetUserId: 'user-1', actorUserId: ACTOR, sendEmail: false })
    expect(result.ok).toBe(true)
  })

  it('still returns the link when the mailer fails', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('Sender is inactive'))
    const result = await issuePasswordReset({ targetUserId: 'user-1', actorUserId: ACTOR, sendEmail: true })

    if (!result.ok) throw new Error('expected success')
    expect(result.emailSent).toBe(false)
    expect(result.emailError).toBe('Sender is inactive')
    expect(result.resetLink).toContain('/reset-password?token=')
  })
})

describe('setTemporaryPassword', () => {
  it('refuses an account with no password to replace', async () => {
    mocks.userFindUnique.mockResolvedValue(targetUser({ passwordHash: null }))
    const result = await setTemporaryPassword({ targetUserId: 'user-1', actorUserId: ACTOR })
    expect(result).toMatchObject({ ok: false, code: 'NOT_ACTIVATED' })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('refuses a supplied password under the length floor', async () => {
    const result = await setTemporaryPassword({ targetUserId: 'user-1', actorUserId: ACTOR, password: 'short' })
    expect(result).toMatchObject({ ok: false, code: 'WEAK_PASSWORD' })
    expect(mocks.hashPassword).not.toHaveBeenCalled()
  })

  it('generates a password, forces a change, and clears sessions and links', async () => {
    const result = await setTemporaryPassword({ targetUserId: 'user-1', actorUserId: ACTOR })

    if (!result.ok) throw new Error('expected success')
    expect(result.temporaryPassword).toHaveLength(16)
    expect(mocks.hashPassword).toHaveBeenCalledWith(result.temporaryPassword)

    const [writes] = mocks.transaction.mock.calls[0]
    expect(writes).toHaveLength(2)
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: 'new-hash', mustChangePassword: true }),
      })
    )
    expect(mocks.revokeAllUserTokens).toHaveBeenCalledWith('user-1', 'admin_password_reset')
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_PASSWORD_SET_BY_ADMIN',
        meta: expect.objectContaining({ requireChange: true, generated: true }),
      })
    )
  })

  it('keeps a supplied password and honours require_change false', async () => {
    const supplied = 'correct-horse-battery'
    const result = await setTemporaryPassword({
      targetUserId: 'user-1',
      actorUserId: ACTOR,
      password: supplied,
      requireChange: false,
    })

    if (!result.ok) throw new Error('expected success')
    expect(result.temporaryPassword).toBe(supplied)
    expect(result.mustChangePassword).toBe(false)
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: false }) })
    )
  })
})

describe('requirePasswordChange', () => {
  it('sets the flag and revokes sessions by default', async () => {
    const result = await requirePasswordChange({ targetUserId: 'user-1', actorUserId: ACTOR, required: true })

    expect(result).toMatchObject({ ok: true, mustChangePassword: true, sessionsRevoked: true })
    expect(mocks.revokeAllUserTokens).toHaveBeenCalledWith('user-1', 'admin_password_change_required')
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_PASSWORD_CHANGE_REQUIRED' })
    )
  })

  it('clearing the flag never signs anybody out', async () => {
    const result = await requirePasswordChange({ targetUserId: 'user-1', actorUserId: ACTOR, required: false })

    expect(result).toMatchObject({ ok: true, mustChangePassword: false, sessionsRevoked: false })
    expect(mocks.revokeAllUserTokens).not.toHaveBeenCalled()
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_PASSWORD_CHANGE_REQUIREMENT_CLEARED' })
    )
  })
})

describe('startForcedPasswordChange', () => {
  it('invalidates outstanding links and mints a short-lived one', async () => {
    const before = Date.now()
    const { expiresAt } = await startForcedPasswordChange('user-1')

    expect(mocks.resetUpdateMany).toHaveBeenCalled()
    expect(mocks.resetCreate).toHaveBeenCalledTimes(1)
    // 15 minutes, not the 24-hour admin link.
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(15 * 60 * 1000)
    expect(expiresAt.getTime() - before).toBeGreaterThan(14 * 60 * 1000)
  })
})

describe('generateTemporaryPassword', () => {
  it('avoids glyphs that get misheard when read aloud', () => {
    const sample = Array.from({ length: 40 }, () => generateTemporaryPassword()).join('')
    expect(sample).not.toMatch(/[0O1lI]/)
    expect(sample.length).toBeGreaterThan(MIN_TEMPORARY_PASSWORD_LENGTH)
  })
})
