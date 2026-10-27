import { prisma } from '@/lib/prisma'

import { classifyOpportunity, WAITING_LOCAL_PREFIX, type PageOutcome } from './outcomes'
import { ADAPTIVE_CADENCE } from './schedule'

export type StageKey = 'sources' | 'crawl' | 'screen' | 'review' | 'publish'

const CLASSIFY_CAP = 50_000
// A page waiting this long for the laptop on a site the laptop has never
// analysed usually means the site is missing from the broker's host list.
const LAPTOP_STALE_MS = 6 * 3600_000

/**
 * One count line per pipeline stage, read in one round trip, so the stage bar
 * says where work is piling up and what is broken before anyone opens a stage.
 * Opportunity counts use classifyOpportunity — the same definitions as the
 * page tree. `attention` names the stage the page should open on.
 */
export async function pipelineSummary(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000)
  const [sites, pendingApproval, watchPoints, quietWatchPoints, suggestedFeeds, skipRules, checks, failingWatchPoints, deadTasks, opportunities, spend] = await Promise.all([
    prisma.monitorSite.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.monitorSite.count({ where: { pending_scope: { not: { equals: null } } } }),
    prisma.monitoredSource.count({ where: { site_id: { not: null }, status: 'ACTIVE' } }),
    prisma.monitoredSource.count({ where: { site_id: { not: null }, status: 'ACTIVE', quiet_streak: { gte: ADAPTIVE_CADENCE.doubleAfter } } }),
    prisma.monitorCrawlFrontier.count({ where: { state: 'SUGGESTED_FEED' } }),
    prisma.monitorSkipRule.count({ where: { OR: [{ expires_at: null }, { expires_at: { gt: now } }] } }),
    prisma.monitorCheckRun.groupBy({ by: ['status'], where: { started_at: { gte: dayAgo } }, _count: { _all: true } }),
    prisma.monitoredSource.count({ where: { site_id: { not: null }, status: 'ACTIVE', fail_count: { gt: 0 } } }),
    prisma.monitorTask.count({ where: { status: { in: ['DEAD', 'FAILED_PERMANENT'] } } }),
    prisma.monitorOpportunity.findMany({
      select: {
        site_id: true, review_state: true, processing_state: true, triage_verdict: true, triage_reason: true, relevance_outcome: true,
        funding_call_id: true, updated_at: true, primary_resource: { select: { last_validation_status: true } },
      },
      orderBy: { updated_at: 'desc' },
      take: CLASSIFY_CAP,
    }),
    prisma.monitorLlmAttempt.aggregate({ _sum: { actual_cost_micros: true }, _count: true }),
  ])
  const siteCount = Object.fromEntries(sites.map((g) => [g.status, g._count._all])) as Record<string, number>
  const checkCount = Object.fromEntries(checks.map((g) => [g.status, g._count._all])) as Record<string, number>

  const outcome: Partial<Record<PageOutcome, number>> = {}
  let unchangedReused = 0
  let drafted = 0
  const waitingSites = new Map<string, Date>()
  for (const o of opportunities) {
    const { outcome: kind } = classifyOpportunity(o, o.primary_resource)
    outcome[kind] = (outcome[kind] ?? 0) + 1
    if (o.triage_reason?.startsWith('Unchanged since')) unchangedReused += 1
    if (o.funding_call_id && o.review_state !== 'PUBLISHED') drafted += 1
    if (o.triage_reason?.startsWith(WAITING_LOCAL_PREFIX)) {
      const oldest = waitingSites.get(o.site_id)
      if (!oldest || o.updated_at < oldest) waitingSites.set(o.site_id, o.updated_at)
    }
  }

  // Sites whose pages have waited for the laptop for hours without the laptop
  // ever analysing anything from them.
  const stale = [...waitingSites].filter(([, since]) => now.getTime() - since.getTime() > LAPTOP_STALE_MS).slice(0, 20)
  const laptopMissingHosts: string[] = []
  for (const [siteId] of stale) {
    const analysed = await prisma.monitorLocalAnalysisResult.count({ where: { resource: { site_id: siteId } } })
    if (analysed === 0) {
      const site = await prisma.monitorSite.findUnique({ where: { id: siteId }, select: { host: true } })
      if (site) laptopMissingHosts.push(site.host)
    }
  }

  const count = (kind: PageOutcome) => outcome[kind] ?? 0
  const stages = {
    sources: {
      activeSites: siteCount.ACTIVE ?? 0,
      pausedSites: (siteCount.PAUSED ?? 0) + (siteCount.BLOCKED ?? 0),
      suggestedSites: siteCount.SUGGESTED ?? 0,
      pendingApproval,
      watchPoints,
      suggestedFeeds,
      skipRules,
    },
    crawl: {
      checks24h: Object.values(checkCount).reduce((n, v) => n + v, 0),
      failed24h: checkCount.FAILED ?? 0,
      incomplete24h: checkCount.PARTIAL ?? 0,
      skipped24h: checkCount.SKIPPED ?? 0,
      failingWatchPoints,
      deadTasks,
      quietWatchPoints,
    },
    screen: {
      waitingLocal: count('WAITING_LOCAL'),
      screening: count('SCREENING'),
      notFunding: count('NOT_FUNDING'),
      unreadable: count('UNREADABLE'),
      unchangedReused,
      laptopMissingHosts,
      aiCostMicros: (spend._sum.actual_cost_micros ?? 0n).toString(),
      aiAttempts: spend._count,
    },
    review: {
      fundingFound: count('FUNDING_FOUND'),
      unsure: count('UNSURE'),
      incomplete: count('INCOMPLETE'),
    },
    publish: { drafted, published: count('PUBLISHED') },
    capped: opportunities.length === CLASSIFY_CAP,
  }

  // Broken things first, then the human queue, then setup gaps.
  const attention: StageKey =
    stages.crawl.failingWatchPoints > 0 || stages.crawl.deadTasks > 0
      ? 'crawl'
      : stages.review.fundingFound + stages.review.unsure + stages.review.incomplete > 0
        ? 'review'
        : stages.screen.laptopMissingHosts.length > 0
          ? 'screen'
          : stages.sources.activeSites === 0 || stages.sources.suggestedFeeds > 0 || stages.sources.pendingApproval > 0
            ? 'sources'
            : 'review'
  return { stages, attention }
}
