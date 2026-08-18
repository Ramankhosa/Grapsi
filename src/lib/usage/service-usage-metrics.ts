/**
 * Service usage metrics for the funding platform.
 *
 * The usage picture is built from what the three billable AI services actually
 * produce:
 *   - Funding intelligence runs — completed `IdeaIntelligenceRun` analyses
 *   - Reviewer runs            — section reviews the reviewer actually executed,
 *                                plus the reviewer calls (proposals) they sit in
 *   - Funding chat             — conversations started and user turns sent
 *
 * Counts are read from the domain tables rather than from a usage ledger so the
 * historical picture is correct without a backfill. `ServiceCompletionUsage`
 * stays the quota ledger (see `service-usage-tracker.ts`); this module is the
 * reporting side.
 */

import { prisma } from '@/lib/prisma'

export const NO_TENANT_KEY = 'no-tenant'
export const NO_USER_KEY = 'unknown'

export interface ServiceUsageCounts {
  /** Completed funding-intelligence (idea analysis) runs. */
  fundingIntelligenceRuns: number
  /** Reviewer section reviews executed by the AI reviewer. */
  reviewerRuns: number
  /** Reviewer calls (proposals) opened for review. */
  reviewerCalls: number
  /** Funding chat conversations started. */
  chatSessions: number
  /** User turns sent into funding chat conversations. */
  chatMessages: number
}

export interface UsageDateRange {
  gte: Date
  lte: Date
}

/** For surfaces that report lifetime usage rather than a window. */
export function allTimeRange(): UsageDateRange {
  return { gte: new Date(0), lte: new Date() }
}

export function emptyServiceUsageCounts(): ServiceUsageCounts {
  return {
    fundingIntelligenceRuns: 0,
    reviewerRuns: 0,
    reviewerCalls: 0,
    chatSessions: 0,
    chatMessages: 0,
  }
}

export function addServiceUsageCounts(target: ServiceUsageCounts, source: ServiceUsageCounts): ServiceUsageCounts {
  target.fundingIntelligenceRuns += source.fundingIntelligenceRuns
  target.reviewerRuns += source.reviewerRuns
  target.reviewerCalls += source.reviewerCalls
  target.chatSessions += source.chatSessions
  target.chatMessages += source.chatMessages
  return target
}

/**
 * Total billable actions. Reviewer calls are excluded because every call is
 * already represented by the section runs inside it — counting both would
 * double-count the same work.
 */
export function totalServiceActions(counts: ServiceUsageCounts): number {
  return (
    counts.fundingIntelligenceRuns +
    counts.reviewerRuns +
    counts.chatSessions +
    counts.chatMessages
  )
}

type MetricKey = keyof ServiceUsageCounts

interface UsageEvent {
  tenantId: string | null
  userId: string | null
}

export interface ServiceUsageFilter {
  tenantId?: string
  userId?: string
  /** Narrow the queries themselves to a known set of users. */
  userIds?: string[]
}

export interface ServiceUsageResult {
  byTenant: Map<string, ServiceUsageCounts>
  byUser: Map<string, ServiceUsageCounts>
  totals: ServiceUsageCounts
}

/**
 * Rows carry a denormalized `tenantId` that predates tenanting in some tables,
 * so anything still null is resolved through the owning user.
 */
async function resolveMissingTenants(events: UsageEvent[]): Promise<void> {
  const unresolvedUserIds = new Set<string>()
  for (const event of events) {
    if (!event.tenantId && event.userId) {
      unresolvedUserIds.add(event.userId)
    }
  }

  if (unresolvedUserIds.size === 0) return

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(unresolvedUserIds) } },
    select: { id: true, tenantId: true },
  })
  const tenantByUser = new Map(users.map(user => [user.id, user.tenantId]))

  for (const event of events) {
    if (!event.tenantId && event.userId) {
      event.tenantId = tenantByUser.get(event.userId) ?? null
    }
  }
}

async function collectEvents(
  range: UsageDateRange,
  userIds?: string[]
): Promise<Record<MetricKey, UsageEvent[]>> {
  // Tenant filtering stays in memory because rows can still carry a null
  // tenantId; user filtering is safe to push into the query.
  const userScope = userIds && userIds.length > 0 ? { in: userIds } : undefined
  const ownerScope = userScope ? { user_id: userScope } : undefined

  const [intelligenceRuns, reviewerSections, reviewerCalls, chatSessions, chatMessages] = await Promise.all([
    prisma.ideaIntelligenceRun.findMany({
      where: { status: 'COMPLETED', completedAt: range, ...(userScope ? { userId: userScope } : {}) },
      select: { tenantId: true, userId: true },
    }),
    prisma.reviewerSection.findMany({
      where: {
        status: 'reviewed',
        last_reviewed_at: range,
        ...(ownerScope ? { reviewer_call: ownerScope } : {}),
      },
      select: { reviewer_call: { select: { tenantId: true, user_id: true } } },
    }),
    prisma.reviewerCall.findMany({
      where: { created_at: range, ...(ownerScope || {}) },
      select: { tenantId: true, user_id: true },
    }),
    prisma.recommendationConversation.findMany({
      where: { created_at: range, ...(ownerScope || {}) },
      select: { tenantId: true, user_id: true },
    }),
    prisma.recommendationConversationMessage.findMany({
      where: {
        created_at: range,
        role: 'user',
        ...(ownerScope ? { conversation: ownerScope } : {}),
      },
      select: { tenantId: true, conversation: { select: { user_id: true } } },
    }),
  ])

  return {
    fundingIntelligenceRuns: intelligenceRuns.map(row => ({ tenantId: row.tenantId, userId: row.userId })),
    reviewerRuns: reviewerSections.map(row => ({
      tenantId: row.reviewer_call?.tenantId ?? null,
      userId: row.reviewer_call?.user_id ?? null,
    })),
    reviewerCalls: reviewerCalls.map(row => ({ tenantId: row.tenantId, userId: row.user_id })),
    chatSessions: chatSessions.map(row => ({ tenantId: row.tenantId, userId: row.user_id })),
    chatMessages: chatMessages.map(row => ({
      tenantId: row.tenantId,
      userId: row.conversation?.user_id ?? null,
    })),
  }
}

/**
 * Count every service event in the window, bucketed by tenant and by user.
 */
export async function collectServiceUsage(
  range: UsageDateRange,
  filter: ServiceUsageFilter = {}
): Promise<ServiceUsageResult> {
  const events = await collectEvents(range, filter.userIds)
  const allEvents = Object.values(events).flat()
  await resolveMissingTenants(allEvents)

  const byTenant = new Map<string, ServiceUsageCounts>()
  const byUser = new Map<string, ServiceUsageCounts>()
  const totals = emptyServiceUsageCounts()

  const bucket = (map: Map<string, ServiceUsageCounts>, key: string) => {
    let counts = map.get(key)
    if (!counts) {
      counts = emptyServiceUsageCounts()
      map.set(key, counts)
    }
    return counts
  }

  for (const [metric, metricEvents] of Object.entries(events) as Array<[MetricKey, UsageEvent[]]>) {
    for (const event of metricEvents) {
      if (filter.tenantId && event.tenantId !== filter.tenantId) continue
      if (filter.userId && event.userId !== filter.userId) continue

      bucket(byTenant, event.tenantId || NO_TENANT_KEY)[metric] += 1
      bucket(byUser, event.userId || NO_USER_KEY)[metric] += 1
      totals[metric] += 1
    }
  }

  return { byTenant, byUser, totals }
}

/**
 * Per-service quota-relevant view for a single tenant, used by admin surfaces
 * that only need one tenant's numbers.
 */
export async function getTenantServiceUsageCounts(
  tenantId: string,
  range: UsageDateRange
): Promise<ServiceUsageCounts> {
  const { byTenant } = await collectServiceUsage(range, { tenantId })
  return byTenant.get(tenantId) ?? emptyServiceUsageCounts()
}
