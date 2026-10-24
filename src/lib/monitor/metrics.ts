import { prisma } from '@/lib/prisma'
export function binomial(successes: number, total: number) {
  if (!total) return { successes, total, value: null, interval95: null }
  const p = successes / total, z = 1.96, denom = 1 + z * z / total
  const center = (p + z * z / (2 * total)) / denom
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
  return { successes, total, value: p, interval95: [Math.max(0, center - half), Math.min(1, center + half)] }
}
export async function qualityMetrics(siteId?: string) {
  const [labels, verified, attempts, cache, queue, frontier] = await Promise.all([
    prisma.monitorAuditSample.findMany({ where: { label: { not: null }, ...(siteId ? { resource_id: { in: (await prisma.monitorResource.findMany({ where: { site_id: siteId }, select: { id: true } })).map(r => r.id) } } : {}) }, take: 20_000 }),
    prisma.monitorVerifiedAnnouncement.findMany({ where: siteId ? { site_id: siteId } : {}, select: { id: true, site_id: true, cohort: true, url: true, announced_on: true, matched_opportunity_id: true, verified_at: true }, take: 20_000 }),
    prisma.monitorLlmAttempt.findMany({ where: siteId ? { ledger_scopes: { has: `SITE:${siteId}` } } : {}, select: { actual_cost_micros: true, reserved_max_micros: true, settled_at: true, status: true }, take: 20_000 }),
    prisma.monitorStageCache.aggregate({ _sum: { hit_count: true }, _count: true }),
    prisma.monitorOpportunity.findMany({ where: { ...(siteId ? { site_id: siteId } : {}), review_state: { in: ['PENDING', 'UPDATE_PROPOSED'] } }, select: { created_at: true }, take: 20_000 }),
    prisma.monitorCrawlFrontier.groupBy({ by: ['state'], where: siteId ? { site_id: siteId } : {}, _count: { _all: true } }),
  ])
  const latest = new Map<string, typeof labels[number]>()
  for (const label of labels.sort((a, b) => (a.labeled_at?.getTime() ?? 0) - (b.labeled_at?.getTime() ?? 0))) latest.set(`${label.stage}:${label.opportunity_id ?? label.resource_id ?? label.id}`, label)
  const positives = [...latest.values()].filter(l => l.stage === 'TRIAGE' && ['NEW_OPPORTUNITY', 'UPDATE_TO_EXISTING'].includes(l.sampled_outcome) && ['RELEVANT', 'IRRELEVANT'].includes(l.label ?? ''))
  const negative = [...latest.values()].filter(l => l.stage === 'FILTER')
  const announcements = [...new Map(verified.map(v => [`${v.site_id}:${v.cohort}:${v.url}:${v.announced_on?.toISOString() ?? ''}`, v])).values()]
  const age = queue.map(q => (Date.now() - q.created_at.getTime()) / 3600_000).sort((a, b) => a - b)
  const cost = attempts.reduce((n, a) => n + (a.actual_cost_micros ?? (!a.settled_at ? a.reserved_max_micros : 0n)), 0n)
  return {
    precision: binomial(positives.filter(p => p.label === 'RELEVANT').length, positives.length),
    discoveryRecall: binomial(announcements.filter(v => v.matched_opportunity_id).length, announcements.length),
    auditedNegativeMisses: { audited: negative.length, relevant: negative.filter(n => n.label === 'RELEVANT').length, estimatedMisses: negative.filter(n => n.label === 'RELEVANT').reduce((n, l) => n + l.sampling_weight, 0), note: 'Audited filter negatives; this is not end-to-end discovery recall.' },
    p95QueueAgeHours: age.length ? age[Math.min(age.length - 1, Math.ceil(age.length * 0.95) - 1)] : 0,
    pendingReview: queue.length, spendAndOutstandingMicros: cost.toString(),
    attempts: attempts.length, uncertainAttempts: attempts.filter(a => ['UNCERTAIN', 'DISPATCHED'].includes(a.status)).length,
    cache: { entries: cache._count, hits: cache._sum.hit_count ?? 0 },
    coverage: Object.fromEntries(frontier.map(f => [f.state, f._count._all])),
    capped: [labels.length, verified.length, attempts.length, queue.length].some(n => n === 20_000),
  }
}
/** No default automatically enables drafting; measured gates must all be configured. */
export async function autoDraftAllowed(siteId: string, calibrationVersion: string) {
  if (process.env.MONITOR_AUTO_DRAFT_ENABLED !== 'true' || !(process.env.MONITOR_AUTO_DRAFT_SITE_IDS ?? '').split(',').includes(siteId)) return false
  if (process.env.MONITOR_AUTO_DRAFT_CALIBRATION_VERSION !== calibrationVersion) return false
  const precision = Number(process.env.MONITOR_AUTO_DRAFT_MIN_PRECISION)
  const recall = Number(process.env.MONITOR_AUTO_DRAFT_MIN_RECALL)
  const age = Number(process.env.MONITOR_AUTO_DRAFT_MAX_QUEUE_HOURS)
  if (!(precision > 0 && precision <= 1 && recall > 0 && recall <= 1 && age > 0)) return false
  const metrics = await qualityMetrics(siteId)
  // SQL compares the actual columns; a numeric budget threshold cannot stand
  // in for the no-overshoot invariant.
  const violations = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "monitor_budget_ledger" WHERE "scope" IN ('PLATFORM', ${`SITE:${siteId}`}) AND "reserved_micros" + "settled_micros" > "limit_micros"`
  return !metrics.capped && metrics.precision.total >= 30 && metrics.discoveryRecall.total >= 20 &&
    (metrics.precision.interval95?.[0] ?? 0) >= precision && (metrics.discoveryRecall.interval95?.[0] ?? 0) >= recall &&
    metrics.p95QueueAgeHours < age && violations[0].n === 0 && metrics.uncertainAttempts === 0
}
