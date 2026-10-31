import { prisma } from '@/lib/prisma'

import { classifyOpportunity, type PageOutcome } from './outcomes'
import { skipRuleFor, type SkipRuleLike } from './skipRules'
import { identifyUrl } from './urlIdentity'

export type { PageOutcome }

export type PageNodeKind = 'WATCH_POINT' | 'PAGE' | 'DOCUMENT' | 'EXPLORED' | 'GROUP'

export interface PageNode {
  id: string
  parentId: string | null
  level: number
  kind: PageNodeKind
  url: string | null
  title: string | null
  outcome: PageOutcome
  detail: string | null
  opportunity: { id: string; title: string | null; reviewState: string; fundingCallId: string | null } | null
  lastSeenAt: string | null
  skipRuleId: string | null
  childCount: number
}

export interface TreeInput {
  sources: Array<{ id: string; name: string; url: string; kind: string; status: string; last_error: string | null; last_checked_at: Date | null }>
  resources: Array<{ id: string; kind: string; role: string; canonical_url: string | null; title: string | null; last_observed_at: Date; last_validation_status: string | null }>
  observations: Array<{ source_id: string; resource_id: string; anchor_text: string | null; missing_since: Date | null }>
  opportunities: Array<{ id: string; primary_resource_id: string | null; title: string | null; review_state: string; processing_state: string; triage_verdict: string | null; triage_reason?: string | null; relevance_outcome: string | null; funding_call_id: string | null; created_at: Date }>
  evidence: Array<{ opportunity_id: string; resource_id: string }>
  frontier: Array<{ id: string; url: string; depth: number; discovered_from: string | null; state: string; visited_at: Date | null }>
  skipRules: Array<SkipRuleLike & { id: string }>
}

function key(url: string | null | undefined): string | null {
  if (!url) return null
  const id = identifyUrl(url)
  return id ? id.dedupKey.replace(/^(https?:\/\/)www\./i, '$1') : null
}

const FRONTIER_OUTCOME: Record<string, { outcome: PageOutcome; detail: string }> = {
  PENDING: { outcome: 'QUEUED', detail: 'Found, not visited yet' },
  VISITED: { outcome: 'NO_RESULT', detail: 'Explored for links' },
  FAILED: { outcome: 'FAILED', detail: 'The visit failed' },
  SKIPPED_LIMIT: { outcome: 'SKIPPED', detail: 'Stopped by the exploration limit' },
  SKIPPED_BY_ADMIN: { outcome: 'SKIPPED', detail: "Marked don't visit" },
  TRAP: { outcome: 'SKIPPED', detail: 'Looks like a crawler trap (calendar, search, session link)' },
  SUGGESTED_FEED: { outcome: 'QUEUED', detail: 'Feed found, waiting for approval' },
  APPROVED_FEED: { outcome: 'LISTING', detail: 'Approved feed' },
}

/**
 * One tree per site. Watch points are the roots: the pages listed on them sit
 * one level down, and documents read as evidence for a call sit under that
 * call's page. Exploration (site discovery) hangs off the page it was found on,
 * following the crawler's own `discovered_from` link, under one group.
 */
export function buildSiteTree(input: TreeInput, now = new Date()): PageNode[] {
  const nodes = new Map<string, PageNode>()
  const byKey = new Map<string, string>()
  const latestOpportunity = new Map<string, TreeInput['opportunities'][number]>()
  for (const o of [...input.opportunities].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
    if (o.primary_resource_id) latestOpportunity.set(o.primary_resource_id, o)
  }
  const skip = (url: string | null) => (url ? skipRuleFor(input.skipRules, url, now) : null)

  const add = (node: Omit<PageNode, 'childCount' | 'skipRuleId'>) => {
    const rule = skip(node.url)
    const full: PageNode = { ...node, childCount: 0, skipRuleId: rule?.id ?? null }
    if (rule && node.kind !== 'WATCH_POINT') {
      full.outcome = 'SKIPPED'
      full.detail = "Marked don't visit"
    }
    nodes.set(node.id, full)
    const k = key(node.url)
    if (k && !byKey.has(k)) byKey.set(k, node.id)
    return full
  }

  for (const source of input.sources) {
    add({
      id: `source:${source.id}`,
      parentId: null,
      level: 0,
      kind: 'WATCH_POINT',
      url: source.url,
      title: source.name,
      outcome: source.status !== 'ACTIVE' ? 'SKIPPED' : source.last_error ? 'FAILED' : 'LISTING',
      detail: source.status !== 'ACTIVE' ? 'Watch point paused' : source.last_error ? source.last_error : `Watched ${source.kind.toLowerCase()}`,
      opportunity: null,
      lastSeenAt: source.last_checked_at?.toISOString() ?? null,
    })
  }

  const resourceById = new Map(input.resources.map((r) => [r.id, r]))
  const resourceNode = (resourceId: string, parentId: string, level: number, anchor: string | null) => {
    const r = resourceById.get(resourceId)
    if (!r) return
    const id = `resource:${r.id}`
    if (nodes.has(id)) return
    const o = latestOpportunity.get(r.id)
    const fromOpportunity = o ? classifyOpportunity(o, r) : null
    const unreachable = r.last_validation_status === 'UNREACHABLE'
    add({
      id,
      parentId,
      level,
      kind: r.kind === 'DOCUMENT' ? 'DOCUMENT' : 'PAGE',
      url: r.canonical_url,
      title: r.title ?? anchor,
      outcome: fromOpportunity?.outcome ?? (unreachable ? 'FAILED' : r.role === 'LISTING' ? 'LISTING' : 'NO_RESULT'),
      detail: fromOpportunity?.detail ?? (unreachable ? 'Could not be reached on the last visit' : r.role === 'LISTING' ? 'Lists other pages' : 'Seen, no funding opportunity'),
      opportunity: o ? { id: o.id, title: o.title, reviewState: o.review_state, fundingCallId: o.funding_call_id } : null,
      lastSeenAt: r.last_observed_at.toISOString(),
    })
  }

  // Level 1: what each watch point lists. The listing page itself is the root.
  for (const obs of input.observations) {
    const parent = `source:${obs.source_id}`
    const root = nodes.get(parent)
    const r = resourceById.get(obs.resource_id)
    if (!root || !r || key(r.canonical_url) === key(root.url)) continue
    resourceNode(obs.resource_id, parent, 1, obs.anchor_text)
  }

  // Documents and pages read as evidence sit under their call's page.
  const primaryOf = new Map(input.opportunities.map((o) => [o.id, o.primary_resource_id]))
  for (const ev of input.evidence) {
    const primary = primaryOf.get(ev.opportunity_id)
    if (!primary || primary === ev.resource_id) continue
    const parent = nodes.get(`resource:${primary}`)
    if (!parent) continue
    resourceNode(ev.resource_id, parent.id, parent.level + 1, null)
    // Evidence shares its call's result: it helped produce that funding call.
    const doc = nodes.get(`resource:${ev.resource_id}`)
    if (doc && !doc.opportunity && doc.outcome === 'NO_RESULT' && ['PUBLISHED', 'FUNDING_FOUND'].includes(parent.outcome)) {
      doc.outcome = parent.outcome
      doc.detail = 'Evidence read for this call'
    }
  }

  // Pages seen some other way (catalog seeds, older watch points) go in one group.
  const orphans = input.resources.filter((r) => !nodes.has(`resource:${r.id}`) && !byKey.has(key(r.canonical_url) ?? ''))
  if (orphans.length) {
    nodes.set('group:other', { id: 'group:other', parentId: null, level: 0, kind: 'GROUP', url: null, title: 'Other pages seen on this website', outcome: 'LISTING', detail: 'Not reached from a current watch point', opportunity: null, lastSeenAt: null, skipRuleId: null, childCount: 0 })
    for (const r of orphans) resourceNode(r.id, 'group:other', 1, null)
  }

  // Exploration: follow discovered_from; anything without a known parent hangs off the group.
  if (input.frontier.length) {
    nodes.set('group:explore', { id: 'group:explore', parentId: null, level: 0, kind: 'GROUP', url: null, title: 'Site exploration', outcome: 'LISTING', detail: 'Pages the crawler visited looking for new listings and feeds', opportunity: null, lastSeenAt: null, skipRuleId: null, childCount: 0 })
    const pending = [...input.frontier].sort((a, b) => a.depth - b.depth)
    for (const f of pending) {
      const existing = byKey.get(key(f.url) ?? '')
      if (existing) continue
      const parentKey = key(f.discovered_from)
      const parentId = (parentKey && byKey.get(parentKey)) || 'group:explore'
      const parent = nodes.get(parentId)!
      const state = FRONTIER_OUTCOME[f.state] ?? { outcome: 'NO_RESULT' as PageOutcome, detail: f.state.toLowerCase() }
      add({
        id: `frontier:${f.id}`,
        parentId,
        level: parent.level + 1,
        kind: 'EXPLORED',
        url: f.url,
        title: null,
        outcome: state.outcome,
        detail: state.detail,
        opportunity: null,
        lastSeenAt: f.visited_at?.toISOString() ?? null,
      })
    }
  }

  for (const node of nodes.values()) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId)
      if (parent) parent.childCount += 1
    }
  }
  return [...nodes.values()]
}

const RESOURCE_CAP = 3000

export async function loadSiteTree(siteId: string) {
  const site = await prisma.monitorSite.findUnique({ where: { id: siteId }, select: { id: true, host: true, status: true } })
  if (!site) return null
  const [sources, resources, observations, opportunities, evidence, frontier, skipRules, resourceTotal] = await Promise.all([
    prisma.monitoredSource.findMany({ where: { site_id: siteId }, select: { id: true, name: true, url: true, kind: true, status: true, last_error: true, last_checked_at: true }, orderBy: { created_at: 'asc' } }),
    prisma.monitorResource.findMany({ where: { site_id: siteId }, select: { id: true, kind: true, role: true, canonical_url: true, title: true, last_observed_at: true, last_validation_status: true }, orderBy: { last_observed_at: 'desc' }, take: RESOURCE_CAP }),
    prisma.monitorObservation.findMany({ where: { site_id: siteId }, select: { source_id: true, resource_id: true, anchor_text: true, missing_since: true }, take: RESOURCE_CAP * 2 }),
    prisma.monitorOpportunity.findMany({ where: { site_id: siteId }, select: { id: true, primary_resource_id: true, title: true, review_state: true, processing_state: true, triage_verdict: true, triage_reason: true, relevance_outcome: true, funding_call_id: true, created_at: true } }),
    prisma.monitorOpportunityEvidence.findMany({ where: { opportunity: { site_id: siteId } }, select: { opportunity_id: true, resource_id: true } }),
    prisma.monitorCrawlFrontier.findMany({ where: { site_id: siteId }, select: { id: true, url: true, depth: true, discovered_from: true, state: true, visited_at: true } }),
    prisma.monitorSkipRule.findMany({ where: { site_id: siteId }, orderBy: { created_at: 'desc' } }),
    prisma.monitorResource.count({ where: { site_id: siteId } }),
  ])
  const nodes = buildSiteTree({ sources, resources, observations, opportunities, evidence, frontier, skipRules })
  const counts: Partial<Record<PageOutcome, number>> = {}
  for (const node of nodes) {
    if (node.kind === 'GROUP' || node.kind === 'WATCH_POINT') continue
    // Evidence documents wear their call's colour but are not extra finds.
    const outcome = node.kind === 'DOCUMENT' && !node.opportunity && ['PUBLISHED', 'FUNDING_FOUND'].includes(node.outcome) ? 'NO_RESULT' : node.outcome
    counts[outcome] = (counts[outcome] ?? 0) + 1
  }
  return { site, nodes, counts, skipRules, truncated: resourceTotal > RESOURCE_CAP }
}
