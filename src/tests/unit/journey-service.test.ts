import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildMilestones, buildSnapshot, type JourneyFacts } from '@/lib/journey/journeyService'

function facts(overrides: Partial<JourneyFacts> = {}): JourneyFacts {
  return {
    hasResearcherProfile: false,
    hasResearchFocus: false,
    finderConversationCount: 0,
    startedApplicationCount: 0,
    tenantMemberCount: 1,
    pendingInviteCount: 0,
    isTenantAdmin: false,
    ...overrides
  }
}

describe('journey service', () => {
  it('gives regular users four milestones and admins five', () => {
    expect(buildMilestones(facts()).map(m => m.key)).toEqual([
      'profile_created',
      'research_focus_added',
      'first_finder_chat',
      'first_application_started'
    ])
    expect(buildMilestones(facts({ isTenantAdmin: true })).map(m => m.key)).toContain('team_invited')
  })

  it('derives completion from real data', () => {
    const milestones = buildMilestones(
      facts({ hasResearcherProfile: true, hasResearchFocus: true, finderConversationCount: 2 })
    )
    const byKey = Object.fromEntries(milestones.map(m => [m.key, m.completed]))
    expect(byKey).toEqual({
      profile_created: true,
      research_focus_added: true,
      first_finder_chat: true,
      first_application_started: false
    })
  })

  it('marks team_invited complete when invites were sent or members joined', () => {
    const viaInvite = buildMilestones(facts({ isTenantAdmin: true, pendingInviteCount: 1 }))
    expect(viaInvite.find(m => m.key === 'team_invited')?.completed).toBe(true)

    const viaMembers = buildMilestones(facts({ isTenantAdmin: true, tenantMemberCount: 3 }))
    expect(viaMembers.find(m => m.key === 'team_invited')?.completed).toBe(true)
  })

  it('picks the first incomplete milestone as the next best action', () => {
    const snapshot = buildSnapshot(facts({ hasResearcherProfile: true }), null)
    expect(snapshot.nextBestAction?.key).toBe('research_focus_added')
    expect(snapshot.completedCount).toBe(1)
    expect(snapshot.totalCount).toBe(4)
  })

  it('has no next action when everything is complete', () => {
    const snapshot = buildSnapshot(
      facts({
        hasResearcherProfile: true,
        hasResearchFocus: true,
        finderConversationCount: 1,
        startedApplicationCount: 1
      }),
      { checklistDone: true, dismissedTours: ['finder'] }
    )
    expect(snapshot.nextBestAction).toBeNull()
    expect(snapshot.checklistDone).toBe(true)
    expect(snapshot.dismissedTours).toEqual(['finder'])
  })

  it('defaults stored state when no journey row exists', () => {
    const snapshot = buildSnapshot(facts(), null)
    expect(snapshot.checklistDone).toBe(false)
    expect(snapshot.dismissedTours).toEqual([])
  })
})
