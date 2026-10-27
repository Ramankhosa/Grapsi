import { MonitorFetchError } from './errors'
import type { Db } from './queue'
import { identifyUrl } from './urlIdentity'

export type SkipMatch = 'PAGE' | 'FOLDER'

export interface SkipRuleLike {
  id?: string
  dedup_key: string
  match: string
  expires_at: Date | null
}

/** `www.` never distinguishes two pages of one site (see sameSiteHost). */
function comparable(key: string): string {
  return key.replace(/^(https?:\/\/)www\./i, '$1')
}

/**
 * The stored identity of a new rule. A folder rule drops the query string —
 * "everything under /calls/" means the path, whatever the parameters.
 */
export function skipRuleKey(url: string, match: SkipMatch): { url: string; dedupKey: string; host: string } | null {
  const id = identifyUrl(url)
  if (!id) return null
  if (match === 'PAGE') return { url: id.canonical, dedupKey: id.dedupKey, host: id.host }
  const folder = identifyUrl(id.canonical.replace(/[?#].*$/, ''))
  return folder ? { url: folder.canonical, dedupKey: folder.dedupKey, host: folder.host } : null
}

export function activeSkipRules<T extends SkipRuleLike>(rules: T[], now = new Date()): T[] {
  return rules.filter((rule) => !rule.expires_at || rule.expires_at > now)
}

/** The first active rule covering `url`, or null. Unparsable URLs are never skipped here. */
export function skipRuleFor<T extends SkipRuleLike>(rules: T[], url: string | null | undefined, now = new Date()): T | null {
  if (!url || rules.length === 0) return null
  const id = identifyUrl(url)
  if (!id) return null
  const key = comparable(id.dedupKey)
  for (const rule of activeSkipRules(rules, now)) {
    const ruleKey = comparable(rule.dedup_key)
    if (key === ruleKey) return rule
    if (rule.match === 'FOLDER') {
      const base = ruleKey.endsWith('/') ? ruleKey : `${ruleKey}/`
      if (key.startsWith(base) || key.startsWith(`${ruleKey}?`)) return rule
    }
  }
  return null
}

export async function loadSkipRules(db: Db, siteId: string, now = new Date()) {
  return db.monitorSkipRule.findMany({
    where: { site_id: siteId, OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
    select: { id: true, dedup_key: true, match: true, expires_at: true },
  })
}

/** Thrown before any request to a page an admin marked "don't visit". Never retried. */
export function skippedPageError(url: string): MonitorFetchError {
  return new MonitorFetchError('SKIPPED_BY_ADMIN', `${url} is on this site's don't-visit list`, { retryable: false, url })
}

const PARKABLE_FRONTIER = ['PENDING', 'VISITED', 'FAILED', 'SKIPPED_LIMIT']

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row])
  return out
}

/**
 * Make one site's crawl state agree with its active marks. Covered frontier
 * rows are parked and covered revisits paused, remembering the policy each
 * page had, so that once no active mark covers a page any more — removed or
 * expired — exactly the visits a mark stopped come back. Pages whose revisits
 * stopped for any other reason (no `skip_paused_policy`) are never touched.
 */
export async function reconcileSkipRules(db: Db, siteId: string, now = new Date()) {
  const rules = await loadSkipRules(db, siteId, now)

  const frontier = await db.monitorCrawlFrontier.findMany({
    where: { site_id: siteId, state: { in: [...PARKABLE_FRONTIER, 'SKIPPED_BY_ADMIN'] } },
    select: { id: true, url: true, state: true },
  })
  const park = frontier.filter((row) => row.state !== 'SKIPPED_BY_ADMIN' && skipRuleFor(rules, row.url, now)).map((row) => row.id)
  const release = frontier.filter((row) => row.state === 'SKIPPED_BY_ADMIN' && !skipRuleFor(rules, row.url, now)).map((row) => row.id)
  if (park.length) await db.monitorCrawlFrontier.updateMany({ where: { id: { in: park } }, data: { state: 'SKIPPED_BY_ADMIN', next_visit_at: null } })
  if (release.length) await db.monitorCrawlFrontier.updateMany({ where: { id: { in: release } }, data: { state: 'PENDING', next_visit_at: now } })

  let revisitsPaused = 0
  if (rules.length) {
    const scheduled = await db.monitorResource.findMany({
      where: { site_id: siteId, skip_paused_policy: null, OR: [{ revisit_policy: { not: 'NONE' } }, { next_revisit_at: { not: null } }] },
      select: { id: true, canonical_url: true, revisit_policy: true },
    })
    const covered = scheduled.filter((row) => skipRuleFor(rules, row.canonical_url, now))
    for (const [policy, rows] of groupBy(covered, (row) => (row.revisit_policy === 'NONE' ? 'ACTIVE' : row.revisit_policy))) {
      revisitsPaused += (await db.monitorResource.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, skip_paused_policy: null },
        data: { skip_paused_policy: policy, revisit_policy: 'NONE', next_revisit_at: null },
      })).count
    }
  }

  let revisitsRestored = 0
  const paused = await db.monitorResource.findMany({
    where: { site_id: siteId, skip_paused_policy: { not: null } },
    select: { id: true, canonical_url: true, skip_paused_policy: true },
  })
  const uncovered = paused.filter((row) => !skipRuleFor(rules, row.canonical_url, now))
  for (const [policy, rows] of groupBy(uncovered, (row) => row.skip_paused_policy ?? 'ACTIVE')) {
    revisitsRestored += (await db.monitorResource.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      // Due now: the page went unchecked while it was marked.
      data: { revisit_policy: policy, next_revisit_at: now, skip_paused_policy: null },
    })).count
  }

  return { parked: park.length, released: release.length, revisitsPaused, revisitsRestored }
}

/**
 * Hourly: sites holding parked work whose marks may have expired. Expiry has
 * no event of its own, so the planner reconciles these sites on a schedule.
 */
export async function reconcileParkedSites(db: Db, now = new Date(), limit = 50) {
  const [resources, frontier] = await Promise.all([
    db.monitorResource.findMany({ where: { skip_paused_policy: { not: null } }, select: { site_id: true }, distinct: ['site_id'], take: limit }),
    db.monitorCrawlFrontier.findMany({ where: { state: 'SKIPPED_BY_ADMIN' }, select: { site_id: true }, distinct: ['site_id'], take: limit }),
  ])
  const sites = [...new Set([...resources, ...frontier].map((row) => row.site_id))].slice(0, limit)
  let restored = 0
  for (const siteId of sites) {
    const result = await reconcileSkipRules(db, siteId, now)
    restored += result.released + result.revisitsRestored
  }
  return { sites: sites.length, restored }
}
