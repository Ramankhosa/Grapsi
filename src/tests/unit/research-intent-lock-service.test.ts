import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/prisma', () => ({
  prisma: {
    paperBlueprint: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    grantSession: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '../../lib/prisma'
import { researchIntentLockService } from '@/lib/services/research-intent-lock-service'

describe('research intent lock service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects generic edits to grant-derived intent locks', async () => {
    ;(prisma.paperBlueprint.findFirst as any).mockResolvedValue({
      id: 'blueprint_1',
      intentLock: {
        source: 'grant_idea_anchor',
        ideaAnchorHash: 'anchor_hash_1',
        thesisStatement: 'Grant-derived thesis',
      },
    })

    await expect(
      researchIntentLockService.updateIntentLock('session_1', {
        thesisStatement: 'Generic replacement',
      })
    ).rejects.toThrow(/controlled by Grant Prep/i)

    expect(prisma.paperBlueprint.update).not.toHaveBeenCalled()
  })

  it('rebuilds a grant lock when the current idea anchor hash changes', async () => {
    ;(prisma.paperBlueprint.findFirst as any).mockResolvedValue({
      id: 'blueprint_1',
      intentLock: {
        source: 'grant_idea_anchor',
        ideaAnchorHash: 'old_hash',
        thesisStatement: 'Old thesis',
      },
    })
    ;(prisma.grantSession.findUnique as any).mockResolvedValue({
      blueprint: {
        freezePayloadJson: {
          ideaAnchorHash: 'new_hash',
          ideaAnchor: {
            version: 'idea_anchor_v1',
            oneSentenceSummary: 'New clinic-led grant direction.',
            distinguishingFeatures: ['Clinic workflow integration'],
            funderFit: ['Implementation science'],
            scopeBoundaries: ['Pilot only'],
            nonNegotiables: ['Clinic-led delivery'],
            unresolvedQuestions: ['Confirm districts'],
            keywords: ['clinics'],
          },
        },
      },
    })

    const lock = await researchIntentLockService.getOrCreateIntentLock('session_1', {} as any)

    expect(lock).toMatchObject({
      ideaAnchorHash: 'new_hash',
      thesisStatement: 'New clinic-led grant direction.',
    })
    expect(prisma.paperBlueprint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'blueprint_1' },
      data: { intentLock: expect.objectContaining({ ideaAnchorHash: 'new_hash' }) },
    }))
  })
})
