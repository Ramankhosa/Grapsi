import { describe, expect, it, vi } from 'vitest'

import { ATIRedemptionError, assignSignupTeam, claimATITokenUse } from '@/lib/ati-redemption-service'

describe('ATI redemption service', () => {
  it('returns the atomically claimed final slot', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{
        id: 'token-1',
        tenantId: 'tenant-1',
        usageCount: 1,
        maxUses: 1,
        fingerprint: 'ABC123',
        assignedTeamId: null
      }])
    } as any

    await expect(claimATITokenUse(tx, 'token-1')).resolves.toMatchObject({
      id: 'token-1',
      usageCount: 1,
      maxUses: 1
    })
  })

  it('rejects when no token capacity can be claimed', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) } as any

    await expect(claimATITokenUse(tx, 'token-1')).rejects.toMatchObject({
      code: 'ATI_TOKEN_UNAVAILABLE'
    } satisfies Partial<ATIRedemptionError>)
  })

  it('creates membership for an assigned active tenant team', async () => {
    const tx = {
      team: {
        findFirst: vi.fn().mockResolvedValue({ id: 'team-1' })
      },
      teamMember: {
        upsert: vi.fn().mockResolvedValue({})
      }
    } as any

    await assignSignupTeam(tx, 'user-1', 'tenant-1', 'team-1')

    expect(tx.team.findFirst).toHaveBeenCalledWith({
      where: { id: 'team-1', tenantId: 'tenant-1', isActive: true },
      select: { id: true }
    })
    expect(tx.teamMember.upsert).toHaveBeenCalled()
  })
})
