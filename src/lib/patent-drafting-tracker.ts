/**
 * Patent Drafting Usage Tracker
 * 
 * Tracks patent drafts toward quota based on PATENTS, not LLM tokens.
 * A patent is counted toward quota when essential sections are drafted:
 * - detailedDescription (required)
 * - claims (required)
 * 
 * Once both essential sections are drafted for a session, the patent
 * is counted ONCE toward daily/monthly quota. Further section drafting
 * for the same session does NOT count again.
 * 
 * This prevents:
 * 1. Users being charged per-section instead of per-patent
 * 2. Users gaming the system by only drafting important sections
 */

import { prisma } from './prisma'

// Essential sections that must be drafted before a patent counts toward quota
const ESSENTIAL_SECTIONS = ['detailedDescription', 'claims'] as const

// All trackable sections
const ALL_SECTIONS = [
  'title',
  'abstract', 
  'fieldOfInvention',
  'background',
  'summary',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',
  'claims',
  'industrialApplicability',
  'listOfNumerals'
] as const

type EssentialSection = typeof ESSENTIAL_SECTIONS[number]
type AllSection = typeof ALL_SECTIONS[number]

export interface PatentDraftingQuota {
  dailyUsed: number
  dailyLimit: number | null
  monthlyUsed: number
  monthlyLimit: number | null
  dailyRemaining: number | null
  monthlyRemaining: number | null
}

/**
 * Track that a section has been drafted for a session
 * Returns whether this section drafting caused the patent to be counted
 */
export async function trackSectionDrafted(
  tenantId: string,
  sessionId: string,
  patentId: string,
  userId: string,
  sectionKey: string
): Promise<{ counted: boolean; quotaExceeded: boolean }> {
  const isDescription = sectionKey === 'detailedDescription' || sectionKey === 'description'
  const isClaims = sectionKey === 'claims'
  
  if (!isDescription && !isClaims) {
    // Non-essential section - no impact on quota counting
    return { counted: false, quotaExceeded: false }
  }
  
  const currentDay = new Date().toISOString().substring(0, 10)
  const currentMonth = new Date().toISOString().substring(0, 7)
  
  // Upsert the tracking record
  const usage = await prisma.patentDraftingUsage.upsert({
    where: { sessionId },
    create: {
      tenantId,
      sessionId,
      patentId,
      userId,
      hasDescription: isDescription,
      hasClaims: isClaims,
      isCounted: false
    },
    update: {
      hasDescription: isDescription ? true : undefined,
      hasClaims: isClaims ? true : undefined
    }
  })
  
  // Re-fetch to get accurate state after update
  const updatedUsage = await prisma.patentDraftingUsage.findUnique({
    where: { sessionId }
  })
  
  if (!updatedUsage) {
    return { counted: false, quotaExceeded: false }
  }
  
  // Check if patent should now be counted (has both essential sections)
  const shouldCount = updatedUsage.hasDescription && updatedUsage.hasClaims && !updatedUsage.isCounted
  
  if (shouldCount) {
    // Check if counting this would exceed quota
    const quota = await getPatentDraftingQuota(tenantId)
    
    // Check daily quota
    if (quota.dailyLimit !== null && quota.dailyUsed >= quota.dailyLimit) {
      return { counted: false, quotaExceeded: true }
    }
    
    // Check monthly quota
    if (quota.monthlyLimit !== null && quota.monthlyUsed >= quota.monthlyLimit) {
      return { counted: false, quotaExceeded: true }
    }
    
    // Mark as counted
    await prisma.patentDraftingUsage.update({
      where: { sessionId },
      data: {
        isCounted: true,
        countedDate: currentDay,
        countedMonth: currentMonth,
        countedAt: new Date()
      }
    })
    
    console.log(`[PatentDraftingTracker] Patent counted for session ${sessionId} (tenant: ${tenantId})`)
    return { counted: true, quotaExceeded: false }
  }
  
  return { counted: false, quotaExceeded: false }
}

/**
 * Get current patent drafting quota status for a tenant
 */
export async function getPatentDraftingQuota(tenantId: string): Promise<PatentDraftingQuota> {
  const currentDay = new Date().toISOString().substring(0, 10)
  const currentMonth = new Date().toISOString().substring(0, 7)
  
  // Get daily and monthly counted patents
  const [dailyCount, monthlyCount] = await Promise.all([
    prisma.patentDraftingUsage.count({
      where: {
        tenantId,
        isCounted: true,
        countedDate: currentDay
      }
    }),
    prisma.patentDraftingUsage.count({
      where: {
        tenantId,
        isCounted: true,
        countedMonth: currentMonth
      }
    })
  ])
  
  // Get quota limits from tenant plan
  const tenantPlan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: new Date() },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    },
    include: {
      plan: {
        include: {
          planFeatures: {
            include: { feature: true }
          }
        }
      }
    }
  })
  
  let dailyLimit: number | null = null
  let monthlyLimit: number | null = null
  
  if (tenantPlan) {
    const patentFeature = tenantPlan.plan.planFeatures?.find(
      pf => pf.feature.code === 'PATENT_DRAFTING'
    )
    if (patentFeature) {
      dailyLimit = patentFeature.dailyQuota
      monthlyLimit = patentFeature.monthlyQuota
    }
  }
  
  return {
    dailyUsed: dailyCount,
    dailyLimit,
    monthlyUsed: monthlyCount,
    monthlyLimit,
    dailyRemaining: dailyLimit !== null ? Math.max(0, dailyLimit - dailyCount) : null,
    monthlyRemaining: monthlyLimit !== null ? Math.max(0, monthlyLimit - monthlyCount) : null
  }
}

/**
 * Check if tenant can draft a new patent (has quota remaining)
 * This should be called BEFORE starting to draft sections
 */
export async function canDraftPatent(tenantId: string, sessionId?: string): Promise<{
  allowed: boolean
  reason?: string
  quota: PatentDraftingQuota
}> {
  // If session already exists and is counted, always allow (continue drafting)
  if (sessionId) {
    const existingUsage = await prisma.patentDraftingUsage.findUnique({
      where: { sessionId }
    })
    
    if (existingUsage?.isCounted) {
      // Patent already counted - allow continued drafting
      const quota = await getPatentDraftingQuota(tenantId)
      return { allowed: true, quota }
    }
    
    // Check if essential sections are partially drafted
    if (existingUsage && (existingUsage.hasDescription || existingUsage.hasClaims)) {
      // Allow completing the patent
      const quota = await getPatentDraftingQuota(tenantId)
      return { allowed: true, quota }
    }
  }
  
  const quota = await getPatentDraftingQuota(tenantId)
  
  // Check daily quota
  if (quota.dailyLimit !== null && quota.dailyUsed >= quota.dailyLimit) {
    return {
      allowed: false,
      reason: `Tenant daily quota exceeded for PATENT_DRAFTING`,
      quota
    }
  }
  
  // Check monthly quota  
  if (quota.monthlyLimit !== null && quota.monthlyUsed >= quota.monthlyLimit) {
    return {
      allowed: false,
      reason: `Tenant monthly quota exceeded for PATENT_DRAFTING`,
      quota
    }
  }
  
  return { allowed: true, quota }
}

/**
 * Get drafting status for a specific session
 */
export async function getSessionDraftingStatus(sessionId: string): Promise<{
  exists: boolean
  hasDescription: boolean
  hasClaims: boolean
  isCounted: boolean
} | null> {
  const usage = await prisma.patentDraftingUsage.findUnique({
    where: { sessionId }
  })
  
  if (!usage) {
    return null
  }
  
  return {
    exists: true,
    hasDescription: usage.hasDescription,
    hasClaims: usage.hasClaims,
    isCounted: usage.isCounted
  }
}

/**
 * Initialize tracking for a session (called when starting a new drafting session)
 */
export async function initializeSessionTracking(
  tenantId: string,
  sessionId: string,
  patentId: string,
  userId: string
): Promise<void> {
  await prisma.patentDraftingUsage.upsert({
    where: { sessionId },
    create: {
      tenantId,
      sessionId,
      patentId,
      userId,
      hasDescription: false,
      hasClaims: false,
      isCounted: false
    },
    update: {} // No updates if already exists
  })
}

/**
 * Manually mark sections as drafted (for existing drafts that need syncing)
 */
export async function syncExistingSections(
  tenantId: string,
  sessionId: string,
  patentId: string,
  userId: string,
  draftedSections: string[]
): Promise<{ counted: boolean }> {
  const hasDescription = draftedSections.some(s => 
    s === 'detailedDescription' || s === 'description'
  )
  const hasClaims = draftedSections.includes('claims')
  
  const currentDay = new Date().toISOString().substring(0, 10)
  const currentMonth = new Date().toISOString().substring(0, 7)
  
  const existing = await prisma.patentDraftingUsage.findUnique({
    where: { sessionId }
  })
  
  if (existing?.isCounted) {
    // Already counted, nothing to do
    return { counted: false }
  }
  
  const shouldCount = hasDescription && hasClaims
  
  await prisma.patentDraftingUsage.upsert({
    where: { sessionId },
    create: {
      tenantId,
      sessionId,
      patentId,
      userId,
      hasDescription,
      hasClaims,
      isCounted: shouldCount,
      countedDate: shouldCount ? currentDay : null,
      countedMonth: shouldCount ? currentMonth : null,
      countedAt: shouldCount ? new Date() : null
    },
    update: {
      hasDescription,
      hasClaims,
      isCounted: shouldCount,
      countedDate: shouldCount ? currentDay : undefined,
      countedMonth: shouldCount ? currentMonth : undefined,
      countedAt: shouldCount ? new Date() : undefined
    }
  })
  
  return { counted: shouldCount }
}

