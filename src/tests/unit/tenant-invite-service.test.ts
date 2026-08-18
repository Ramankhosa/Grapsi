import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findUniqueInviteMock } = vi.hoisted(() => ({ findUniqueInviteMock: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenantMemberInvite: {
      findUnique: findUniqueInviteMock
    }
  }
}))

vi.mock('@/lib/mailer', () => ({
  sendEmail: vi.fn(),
  SITE_URL: 'https://app.example.com',
  // email-templates reads these at module load to brand the emails
  MAIL_FROM_EMAIL: 'noreply@example.com',
  MAIL_FROM_NAME: 'Grapsi'
}))

import { buildInviteLink, markInviteAccepted, validateInviteEmailLock } from '@/lib/tenant-invite-service'

describe('tenant invite service', () => {
  beforeEach(() => {
    findUniqueInviteMock.mockReset()
  })

  describe('buildInviteLink', () => {
    it('builds a register link with token and email prefilled', () => {
      expect(buildInviteLink('raw-token+x', 'person@uni.edu')).toBe(
        'https://app.example.com/register?invite=raw-token%2Bx&email=person%40uni.edu'
      )
    })
  })

  describe('validateInviteEmailLock', () => {
    it('passes plain ATI tokens with no invite attached', async () => {
      findUniqueInviteMock.mockResolvedValue(null)
      await expect(validateInviteEmailLock('token-1', 'anyone@x.com')).resolves.toEqual({ ok: true })
    })

    it('passes when the signup email matches (case-insensitive)', async () => {
      findUniqueInviteMock.mockResolvedValue({
        email: 'person@uni.edu',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000)
      })
      await expect(validateInviteEmailLock('token-1', ' Person@Uni.edu ')).resolves.toEqual({ ok: true })
    })

    it('rejects a mismatched email', async () => {
      findUniqueInviteMock.mockResolvedValue({
        email: 'person@uni.edu',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000)
      })
      const result = await validateInviteEmailLock('token-1', 'other@uni.edu')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/different email/)
    })

    it('rejects revoked and expired invites', async () => {
      findUniqueInviteMock.mockResolvedValue({
        email: 'person@uni.edu',
        status: 'REVOKED',
        expiresAt: new Date(Date.now() + 86400000)
      })
      await expect(validateInviteEmailLock('token-1', 'person@uni.edu')).resolves.toMatchObject({
        ok: false
      })

      findUniqueInviteMock.mockResolvedValue({
        email: 'person@uni.edu',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000)
      })
      const result = await validateInviteEmailLock('token-1', 'person@uni.edu')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/expired/)
    })
  })

  describe('markInviteAccepted', () => {
    it('marks only pending invites accepted inside the transaction', async () => {
      const updateManyMock = vi.fn().mockResolvedValue({ count: 1 })
      const tx = { tenantMemberInvite: { updateMany: updateManyMock } }

      await markInviteAccepted(tx, 'token-1', 'user-9')

      expect(updateManyMock).toHaveBeenCalledWith({
        where: { atiTokenId: 'token-1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'ACCEPTED', acceptedUserId: 'user-9' })
      })
    })
  })
})
