import { prisma } from '@/lib/prisma'

/**
 * Onboarding journey engine.
 *
 * Milestones are computed from real data (does a researcher profile exist,
 * has the user run a finder chat, ...) rather than stored flags, so users
 * who completed steps before this feature shipped are never nagged, and the
 * state self-heals if data is deleted. The UserJourneyState row only stores
 * things that cannot be derived: dismissed tours and checklist dismissal.
 */

export type JourneyMilestoneKey =
  | 'profile_created'
  | 'research_focus_added'
  | 'first_finder_chat'
  | 'first_application_started'
  | 'team_invited'

export interface JourneyMilestone {
  key: JourneyMilestoneKey
  title: string
  description: string
  href: string
  completed: boolean
}

export interface JourneyFacts {
  hasResearcherProfile: boolean
  hasResearchFocus: boolean
  finderConversationCount: number
  startedApplicationCount: number
  /** Only meaningful for tenant admins (OWNER/ADMIN). */
  tenantMemberCount: number
  pendingInviteCount: number
  isTenantAdmin: boolean
}

export interface JourneySnapshot {
  milestones: JourneyMilestone[]
  completedCount: number
  totalCount: number
  nextBestAction: JourneyMilestone | null
  checklistDone: boolean
  dismissedTours: string[]
}

const MILESTONE_DEFS: Record<JourneyMilestoneKey, Omit<JourneyMilestone, 'completed'>> = {
  profile_created: {
    key: 'profile_created',
    title: 'Set up your researcher profile',
    description: 'Tell us who you are — institution, career stage, and location power eligibility matching.',
    href: '/profile/researcher'
  },
  research_focus_added: {
    key: 'research_focus_added',
    title: 'Add your research focus',
    description: 'Research areas and a summary let the AI match funding calls to your work.',
    href: '/profile/research-fit'
  },
  first_finder_chat: {
    key: 'first_finder_chat',
    title: 'Discover funding matches',
    description: 'Ask Fund Finder anything — it searches calls matched to your profile.',
    href: '/finder'
  },
  first_application_started: {
    key: 'first_application_started',
    title: 'Start an application',
    description: 'Create a project in Grant Writer and begin structured, AI-assisted drafting.',
    href: '/projects'
  },
  team_invited: {
    key: 'team_invited',
    title: 'Invite your team',
    description: 'Bring colleagues into your workspace with role-based access.',
    href: '/admin'
  }
}

/** Pure milestone derivation — kept side-effect free so it is trivially testable. */
export function buildMilestones(facts: JourneyFacts): JourneyMilestone[] {
  const milestones: JourneyMilestone[] = [
    { ...MILESTONE_DEFS.profile_created, completed: facts.hasResearcherProfile },
    { ...MILESTONE_DEFS.research_focus_added, completed: facts.hasResearchFocus },
    { ...MILESTONE_DEFS.first_finder_chat, completed: facts.finderConversationCount > 0 },
    { ...MILESTONE_DEFS.first_application_started, completed: facts.startedApplicationCount > 0 }
  ]

  if (facts.isTenantAdmin) {
    milestones.push({
      ...MILESTONE_DEFS.team_invited,
      completed: facts.pendingInviteCount > 0 || facts.tenantMemberCount > 1
    })
  }

  return milestones
}

export function buildSnapshot(
  facts: JourneyFacts,
  state: { checklistDone: boolean; dismissedTours: string[] } | null
): JourneySnapshot {
  const milestones = buildMilestones(facts)
  const completedCount = milestones.filter(m => m.completed).length
  return {
    milestones,
    completedCount,
    totalCount: milestones.length,
    nextBestAction: milestones.find(m => !m.completed) || null,
    checklistDone: state?.checklistDone ?? false,
    dismissedTours: state?.dismissedTours ?? []
  }
}

export async function gatherJourneyFacts(
  userId: string,
  tenantId: string | null,
  roles: string[]
): Promise<JourneyFacts> {
  const isTenantAdmin = roles.includes('OWNER') || roles.includes('ADMIN')

  const [profile, finderConversationCount, projectCount, grantPrepCount, tenantMemberCount, pendingInviteCount] =
    await Promise.all([
      prisma.researcherProfile.findUnique({
        where: { user_id: userId },
        select: { research_areas: true, research_summary: true }
      }),
      prisma.recommendationConversation.count({ where: { user_id: userId } }),
      prisma.project.count({ where: { userId, name: { not: 'Default Project' } } }),
      prisma.grantPrepSession.count({ where: { user_id: userId } }),
      isTenantAdmin && tenantId ? prisma.user.count({ where: { tenantId } }) : Promise.resolve(0),
      isTenantAdmin && tenantId
        ? prisma.tenantMemberInvite.count({ where: { tenantId } })
        : Promise.resolve(0)
    ])

  return {
    hasResearcherProfile: !!profile,
    hasResearchFocus: !!profile && ((profile.research_areas?.length ?? 0) > 0 || !!profile.research_summary),
    finderConversationCount,
    startedApplicationCount: projectCount + grantPrepCount,
    tenantMemberCount,
    pendingInviteCount,
    isTenantAdmin
  }
}

export async function getJourneySnapshot(
  userId: string,
  tenantId: string | null,
  roles: string[]
): Promise<JourneySnapshot> {
  const [facts, state] = await Promise.all([
    gatherJourneyFacts(userId, tenantId, roles),
    prisma.userJourneyState.findUnique({
      where: { userId },
      select: { checklistDone: true, dismissedTours: true }
    })
  ])
  return buildSnapshot(facts, state)
}

export async function dismissTour(userId: string, tourId: string): Promise<void> {
  const existing = await prisma.userJourneyState.findUnique({
    where: { userId },
    select: { dismissedTours: true }
  })
  if (existing?.dismissedTours.includes(tourId)) return
  await prisma.userJourneyState.upsert({
    where: { userId },
    create: { userId, dismissedTours: [tourId] },
    update: { dismissedTours: { push: tourId } }
  })
}

export async function setChecklistDone(userId: string, done: boolean): Promise<void> {
  await prisma.userJourneyState.upsert({
    where: { userId },
    create: { userId, checklistDone: done },
    update: { checklistDone: done }
  })
}
