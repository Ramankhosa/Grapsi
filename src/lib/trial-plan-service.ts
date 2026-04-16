/**
 * Trial Plan Service
 * 
 * Manages trial plan limits and quota enforcement for trial users.
 * Trial users come from TrialCampaigns with configurable per-campaign limits.
 */

import { prisma } from './prisma'

// ============================================================================
// Types
// ============================================================================

export interface TrialPlanLimits {
  patentDraftLimit: number | null
  noveltySearchLimit: number | null
  ideationRunLimit: number | null
  priorArtSearchLimit: number | null
  diagramLimit: number | null
  totalTokenBudget: number | null
}

export interface TrialUsage {
  patentsDrafted: number
  noveltySearches: number
  ideationRuns: number
  priorArtSearches: number
  diagrams: number
  totalTokensUsed: number
}

export interface TrialQuotaStatus {
  isTrialUser: boolean
  limits: TrialPlanLimits
  usage: TrialUsage
  remaining: {
    patents: number | null
    noveltySearches: number | null
    ideationRuns: number | null
    priorArtSearches: number | null
    diagrams: number | null
    tokens: number | null
  }
  quotaExceeded: {
    patents: boolean
    noveltySearches: boolean
    ideationRuns: boolean
    priorArtSearches: boolean
    diagrams: boolean
    tokens: boolean
    any: boolean
  }
  // Time-based expiry
  trialExpired: boolean
  trialExpiresAt: Date | null
  daysRemaining: number | null
  campaign?: {
    id: string
    name: string
  }
}

// Default trial limits if campaign doesn't specify
// Token budget is the PRIMARY safety cap - prevents abuse even if user
// never "completes" a patent (e.g., regenerates claims endlessly)
const DEFAULT_TRIAL_LIMITS: TrialPlanLimits = {
  patentDraftLimit: 3,          // 3 patent drafts (counted when description + claims done)
  noveltySearchLimit: 10,       // 10 novelty searches
  ideationRunLimit: 5,          // 5 ideation runs
  priorArtSearchLimit: 10,      // 10 prior art searches
  diagramLimit: 20,             // 20 diagram generations
  totalTokenBudget: 70000       // 70K tokens - SAFETY CAP (whichever hits first)
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check if a user is a trial user and get their campaign info
 */
export async function getTrialUserInfo(userId: string): Promise<{
  isTrialUser: boolean
  invite?: any
  campaign?: any
}> {
  try {
    // Find trial invite that this user signed up through
    const invite = await prisma.trialInvite.findFirst({
      where: {
        signedUpUserId: userId,
        status: 'SIGNED_UP'
      },
      include: {
        campaign: true
      }
    })

    if (!invite) {
      // Also check if user belongs to TRIAL tenant
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          tenant: true
        }
      })

      if (user?.tenant?.atiId === 'TRIAL') {
        return { isTrialUser: true }
      }

      return { isTrialUser: false }
    }

    // Handle case where campaign was deleted but invite still exists
    if (!invite.campaign) {
      return { isTrialUser: true, invite }
    }

    return {
      isTrialUser: true,
      invite,
      campaign: invite.campaign
    }
  } catch (error) {
    console.error('Error checking trial user info:', error)
    // Default to non-trial on error to avoid blocking users
    return { isTrialUser: false }
  }
}

/**
 * Get trial plan limits for a user
 * Returns campaign-specific limits or defaults
 */
export async function getTrialLimits(userId: string): Promise<TrialPlanLimits> {
  const { isTrialUser, campaign } = await getTrialUserInfo(userId)

  if (!isTrialUser) {
    // Not a trial user - return nulls (no trial limits apply)
    return {
      patentDraftLimit: null,
      noveltySearchLimit: null,
      ideationRunLimit: null,
      priorArtSearchLimit: null,
      diagramLimit: null,
      totalTokenBudget: null
    }
  }

  // Use campaign-specific limits or defaults
  // Note: We use !== null check because 0 is a valid limit (blocks all usage)
  return {
    patentDraftLimit: campaign?.patentDraftLimit !== null && campaign?.patentDraftLimit !== undefined 
      ? campaign.patentDraftLimit 
      : DEFAULT_TRIAL_LIMITS.patentDraftLimit,
    noveltySearchLimit: campaign?.noveltySearchLimit !== null && campaign?.noveltySearchLimit !== undefined 
      ? campaign.noveltySearchLimit 
      : DEFAULT_TRIAL_LIMITS.noveltySearchLimit,
    ideationRunLimit: campaign?.ideationRunLimit !== null && campaign?.ideationRunLimit !== undefined 
      ? campaign.ideationRunLimit 
      : DEFAULT_TRIAL_LIMITS.ideationRunLimit,
    priorArtSearchLimit: campaign?.priorArtSearchLimit !== null && campaign?.priorArtSearchLimit !== undefined 
      ? campaign.priorArtSearchLimit 
      : DEFAULT_TRIAL_LIMITS.priorArtSearchLimit,
    diagramLimit: campaign?.diagramLimit !== null && campaign?.diagramLimit !== undefined 
      ? campaign.diagramLimit 
      : DEFAULT_TRIAL_LIMITS.diagramLimit,
    totalTokenBudget: campaign?.totalTokenBudget !== null && campaign?.totalTokenBudget !== undefined 
      ? campaign.totalTokenBudget 
      : DEFAULT_TRIAL_LIMITS.totalTokenBudget
  }
}

/**
 * Get current trial usage for a user
 * Handles missing tables gracefully
 */
export async function getTrialUsage(userId: string): Promise<TrialUsage> {
  const defaultUsage: TrialUsage = {
    patentsDrafted: 0,
    noveltySearches: 0,
    ideationRuns: 0,
    priorArtSearches: 0,
    diagrams: 0,
    totalTokensUsed: 0
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true }
    })

    if (!user?.tenantId) {
      return defaultUsage
    }

    // Get counts from various usage tables - use Promise.allSettled to handle failures gracefully
    const results = await Promise.allSettled([
      // Patent drafts (counted as complete)
      prisma.patentDraftingUsage.count({
        where: {
          userId,
          isCounted: true
        }
      }),

      // Novelty searches
      prisma.noveltySearchRun.count({
        where: {
          userId,
          status: 'COMPLETED'
        }
      }),

      // Prior art searches - also count COMPLETED_WITH_WARNINGS as completed
      prisma.priorArtRun.count({
        where: {
          userId,
          status: { in: ['COMPLETED', 'COMPLETED_WITH_WARNINGS'] }
        }
      }),

      // Ideation runs
      prisma.serviceCompletionUsage.count({
        where: {
          userId,
          serviceType: 'IDEATION',
          isCompleted: true
        }
      }),

      // Diagram generations
      prisma.diagramGenerationUsage.count({
        where: {
          userId,
          isCompleted: true
        }
      }),

      // Total token usage
      prisma.usageLog.aggregate({
        where: {
          userId,
          tenantId: user.tenantId
        },
        _sum: {
          inputTokens: true,
          outputTokens: true
        }
      })
    ])

    // Extract values, defaulting to 0 on failure
    const getValue = (result: PromiseSettledResult<any>, defaultVal: any = 0) => {
      if (result.status === 'fulfilled') {
        return result.value
      }
      console.warn('Trial usage query failed:', result.reason)
      return defaultVal
    }

    const patentsDrafted = getValue(results[0])
    const noveltySearches = getValue(results[1])
    const priorArtSearches = getValue(results[2])
    const ideationRuns = getValue(results[3])
    const diagrams = getValue(results[4])
    const tokenUsage = getValue(results[5], { _sum: { inputTokens: 0, outputTokens: 0 } })

    return {
      patentsDrafted,
      noveltySearches,
      ideationRuns,
      priorArtSearches,
      diagrams,
      totalTokensUsed: (tokenUsage._sum?.inputTokens || 0) + (tokenUsage._sum?.outputTokens || 0)
    }
  } catch (error) {
    console.error('Error getting trial usage:', error)
    return defaultUsage
  }
}

/**
 * Get comprehensive trial quota status for a user
 */
export async function getTrialQuotaStatus(userId: string): Promise<TrialQuotaStatus> {
  const { isTrialUser, invite, campaign } = await getTrialUserInfo(userId)
  
  if (!isTrialUser) {
    return {
      isTrialUser: false,
      limits: {
        patentDraftLimit: null,
        noveltySearchLimit: null,
        ideationRunLimit: null,
        priorArtSearchLimit: null,
        diagramLimit: null,
        totalTokenBudget: null
      },
      usage: {
        patentsDrafted: 0,
        noveltySearches: 0,
        ideationRuns: 0,
        priorArtSearches: 0,
        diagrams: 0,
        totalTokensUsed: 0
      },
      remaining: {
        patents: null,
        noveltySearches: null,
        ideationRuns: null,
        priorArtSearches: null,
        diagrams: null,
        tokens: null
      },
      quotaExceeded: {
        patents: false,
        noveltySearches: false,
        ideationRuns: false,
        priorArtSearches: false,
        diagrams: false,
        tokens: false,
        any: false
      },
      trialExpired: false,
      trialExpiresAt: null,
      daysRemaining: null
    }
  }

  // Calculate time-based expiry
  let trialExpired = false
  let trialExpiresAt: Date | null = null
  let daysRemaining: number | null = null

  if (invite?.signedUpAt && campaign?.trialDurationDays) {
    const signedUpDate = new Date(invite.signedUpAt)
    trialExpiresAt = new Date(signedUpDate)
    trialExpiresAt.setDate(trialExpiresAt.getDate() + campaign.trialDurationDays)
    
    const now = new Date()
    trialExpired = now > trialExpiresAt
    
    if (!trialExpired) {
      const msRemaining = trialExpiresAt.getTime() - now.getTime()
      daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24))
    } else {
      daysRemaining = 0
    }
  }

  const limits = await getTrialLimits(userId)
  const usage = await getTrialUsage(userId)

  const calcRemaining = (limit: number | null, used: number): number | null => {
    if (limit === null) return null
    return Math.max(0, limit - used)
  }

  const remaining = {
    patents: calcRemaining(limits.patentDraftLimit, usage.patentsDrafted),
    noveltySearches: calcRemaining(limits.noveltySearchLimit, usage.noveltySearches),
    ideationRuns: calcRemaining(limits.ideationRunLimit, usage.ideationRuns),
    priorArtSearches: calcRemaining(limits.priorArtSearchLimit, usage.priorArtSearches),
    diagrams: calcRemaining(limits.diagramLimit, usage.diagrams),
    tokens: calcRemaining(limits.totalTokenBudget, usage.totalTokensUsed)
  }

  const quotaExceeded = {
    patents: remaining.patents !== null && remaining.patents <= 0,
    noveltySearches: remaining.noveltySearches !== null && remaining.noveltySearches <= 0,
    ideationRuns: remaining.ideationRuns !== null && remaining.ideationRuns <= 0,
    priorArtSearches: remaining.priorArtSearches !== null && remaining.priorArtSearches <= 0,
    diagrams: remaining.diagrams !== null && remaining.diagrams <= 0,
    tokens: remaining.tokens !== null && remaining.tokens <= 0,
    any: false
  }
  // Include time expiry in the "any" check
  quotaExceeded.any = trialExpired || Object.values(quotaExceeded).some(v => v === true)

  return {
    isTrialUser: true,
    limits,
    usage,
    remaining,
    quotaExceeded,
    trialExpired,
    trialExpiresAt,
    daysRemaining,
    campaign: campaign ? { id: campaign.id, name: campaign.name } : undefined
  }
}

/**
 * Check if trial user can perform an action
 * Returns { allowed, reason } 
 */
export async function checkTrialQuota(
  userId: string,
  action: 'patent' | 'noveltySearch' | 'ideation' | 'priorArt' | 'diagram'
): Promise<{ allowed: boolean; reason?: string; remaining?: number }> {
  const status = await getTrialQuotaStatus(userId)

  if (!status.isTrialUser) {
    // Not a trial user - trial limits don't apply
    return { allowed: true }
  }

  // Check time-based expiry first
  if (status.trialExpired) {
    return {
      allowed: false,
      reason: 'Your trial period has expired. Please upgrade to continue using the platform.',
      remaining: 0
    }
  }

  // Check token budget (applies to all actions)
  if (status.quotaExceeded.tokens) {
    return {
      allowed: false,
      reason: 'Trial token budget exceeded. Please upgrade to continue.',
      remaining: 0
    }
  }

  switch (action) {
    case 'patent':
      if (status.quotaExceeded.patents) {
        return {
          allowed: false,
          reason: `Trial limit of ${status.limits.patentDraftLimit} patent drafts reached. Please upgrade to continue.`,
          remaining: 0
        }
      }
      return { allowed: true, remaining: status.remaining.patents ?? undefined }

    case 'noveltySearch':
      if (status.quotaExceeded.noveltySearches) {
        return {
          allowed: false,
          reason: `Trial limit of ${status.limits.noveltySearchLimit} novelty searches reached. Please upgrade to continue.`,
          remaining: 0
        }
      }
      return { allowed: true, remaining: status.remaining.noveltySearches ?? undefined }

    case 'ideation':
      if (status.quotaExceeded.ideationRuns) {
        return {
          allowed: false,
          reason: `Trial limit of ${status.limits.ideationRunLimit} ideation runs reached. Please upgrade to continue.`,
          remaining: 0
        }
      }
      return { allowed: true, remaining: status.remaining.ideationRuns ?? undefined }

    case 'priorArt':
      if (status.quotaExceeded.priorArtSearches) {
        return {
          allowed: false,
          reason: `Trial limit of ${status.limits.priorArtSearchLimit} prior art searches reached. Please upgrade to continue.`,
          remaining: 0
        }
      }
      return { allowed: true, remaining: status.remaining.priorArtSearches ?? undefined }

    case 'diagram':
      if (status.quotaExceeded.diagrams) {
        return {
          allowed: false,
          reason: `Trial limit of ${status.limits.diagramLimit} diagrams reached. Please upgrade to continue.`,
          remaining: 0
        }
      }
      return { allowed: true, remaining: status.remaining.diagrams ?? undefined }

    default:
      return { allowed: true }
  }
}

// ============================================================================
// Seed Function - Creates TRIAL plan in database
// ============================================================================

/**
 * Seed the TRIAL plan with default limits
 * Call this during database setup or migration
 * Uses transaction to prevent race conditions
 */
export async function seedTrialPlan(): Promise<void> {
  try {
    // Use upsert pattern to handle race conditions
    const plan = await prisma.plan.upsert({
      where: { code: 'TRIAL' },
      update: {}, // Don't update if exists
      create: {
        code: 'TRIAL',
        name: 'Trial Plan',
        cycle: 'ONE_TIME',
        status: 'ACTIVE'
      }
    })

    // Get or create features
    const featureConfigs = [
      { code: 'PATENT_DRAFTING' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.patentDraftLimit },
      { code: 'PRIOR_ART_SEARCH' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.priorArtSearchLimit },
      { code: 'IDEATION' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.ideationRunLimit },
      { code: 'DIAGRAM_GENERATION' as const, monthlyQuota: DEFAULT_TRIAL_LIMITS.diagramLimit },
      { code: 'IDEA_BANK' as const, monthlyQuota: 5 }
    ]

    for (const config of featureConfigs) {
      // Upsert feature
      const feature = await prisma.feature.upsert({
        where: { code: config.code },
        update: {},
        create: {
          code: config.code,
          name: config.code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          unit: 'operations'
        }
      })

      // Check if plan feature already exists
      const existingPlanFeature = await prisma.planFeature.findUnique({
        where: {
          planId_featureId: {
            planId: plan.id,
            featureId: feature.id
          }
        }
      })

      if (!existingPlanFeature) {
        await prisma.planFeature.create({
          data: {
            planId: plan.id,
            featureId: feature.id,
            monthlyQuota: config.monthlyQuota,
            dailyQuota: null,
            monthlyTokenLimit: DEFAULT_TRIAL_LIMITS.totalTokenBudget,
            dailyTokenLimit: null
          }
        })
      }
    }

    console.log('TRIAL plan seeded successfully')
  } catch (error: any) {
    // Handle race conditions gracefully
    if (error.code === 'P2002') {
      console.log('TRIAL plan already exists (race condition handled)')
      return
    }
    console.error('Error seeding TRIAL plan:', error)
    throw error
  }
}

/**
 * Assign TRIAL plan to a tenant
 * Will create the TRIAL plan if it doesn't exist
 */
export async function assignTrialPlanToTenant(tenantId: string): Promise<void> {
  let plan = await prisma.plan.findUnique({
    where: { code: 'TRIAL' }
  })

  if (!plan) {
    // Auto-create the TRIAL plan if it doesn't exist
    console.log('TRIAL plan not found, creating...')
    await seedTrialPlan()
    plan = await prisma.plan.findUnique({
      where: { code: 'TRIAL' }
    })
    
    if (!plan) {
      console.error('Failed to create TRIAL plan')
      return
    }
  }

  // Check if already assigned
  const existing = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      planId: plan.id,
      status: 'ACTIVE'
    }
  })

  if (existing) {
    return // Already assigned
  }

  try {
    await prisma.tenantPlan.create({
      data: {
        tenantId,
        planId: plan.id,
        effectiveFrom: new Date(),
        expiresAt: null, // Trial doesn't expire by date, only by usage
        status: 'ACTIVE'
      }
    })
  } catch (error: any) {
    // Handle unique constraint violation (race condition)
    if (error.code === 'P2002') {
      console.log('Trial plan already assigned (race condition)')
      return
    }
    throw error
  }
}

/**
 * Update campaign trial limits
 */
export async function updateCampaignLimits(
  campaignId: string,
  limits: Partial<TrialPlanLimits>
): Promise<void> {
  await prisma.trialCampaign.update({
    where: { id: campaignId },
    data: {
      patentDraftLimit: limits.patentDraftLimit,
      noveltySearchLimit: limits.noveltySearchLimit,
      ideationRunLimit: limits.ideationRunLimit,
      priorArtSearchLimit: limits.priorArtSearchLimit,
      diagramLimit: limits.diagramLimit,
      totalTokenBudget: limits.totalTokenBudget
    }
  })
}

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Get trial limits for API response
 */
export async function getTrialLimitsForAPI(campaignId: string): Promise<TrialPlanLimits> {
  const campaign = await prisma.trialCampaign.findUnique({
    where: { id: campaignId }
  })

  if (!campaign) {
    return DEFAULT_TRIAL_LIMITS
  }

  return {
    patentDraftLimit: campaign.patentDraftLimit ?? DEFAULT_TRIAL_LIMITS.patentDraftLimit,
    noveltySearchLimit: campaign.noveltySearchLimit ?? DEFAULT_TRIAL_LIMITS.noveltySearchLimit,
    ideationRunLimit: campaign.ideationRunLimit ?? DEFAULT_TRIAL_LIMITS.ideationRunLimit,
    priorArtSearchLimit: campaign.priorArtSearchLimit ?? DEFAULT_TRIAL_LIMITS.priorArtSearchLimit,
    diagramLimit: campaign.diagramLimit ?? DEFAULT_TRIAL_LIMITS.diagramLimit,
    totalTokenBudget: campaign.totalTokenBudget ?? DEFAULT_TRIAL_LIMITS.totalTokenBudget
  }
}

export { DEFAULT_TRIAL_LIMITS }

