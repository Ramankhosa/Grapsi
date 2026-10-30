import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/prisma-generated'

import { laneWhere } from './discoveryExport'
import { lifecycleAt } from './evidence'
import { classifyOpportunity, type PageOutcome } from './outcomes'
import { catalogueIndex, checkAgainst, discoveryTwins, type DuplicateCheck, type DuplicateSubject } from './reviewDuplicates'

/**
 * Review as a scannable list (30 Oct 2026): every discovery in a lane with the
 * facts a reviewer sorts and filters by, and the live duplicate check. The
 * full evidence loads only when a row is opened.
 */

/** Most rows one lane sends; the screen says when there were more and searches the rest on the server. */
export const REVIEW_LIST_CAP = 2000
const OPEN_REVIEW = ['PENDING', 'UPDATE_PROPOSED', 'SNOOZED']
const FACT_KEYS = ['scheme_title', 'agency_name', 'close_date', 'open_date', 'is_rolling', 'amount_min', 'amount_max', 'currency'] as const

export interface ReviewFacts { title: string | null; funder: string | null; deadline: string | null; opens: string | null; rolling: boolean; award: string | null }
export interface ReviewSummary {
  id: string
  title: string
  host: string
  url: string | null
  outcome: PageOutcome
  outcomeDetail: string
  reviewState: string
  processingState: string
  verdict: string | null
  confidence: number | null
  reason: string | null
  matchType: string | null
  lifecycle: string
  quality: string | null
  facts: ReviewFacts
  call: { id: string; title: string; status: string | null } | null
  found: string
  duplicates: DuplicateCheck
  /** Why "Draft it" cannot run now; null when it can. */
  draftBlock: string | null
}

type FactRow = { id: string; quality: string | null; reasons: string[] | null; conflicts: number | null; facts: Record<string, unknown> | null }

function award(facts: Record<string, unknown>): string | null {
  const min = facts.amount_min, max = facts.amount_max
  if (min == null && max == null) return null
  const n = (v: unknown) => typeof v === 'number' ? v.toLocaleString('en-GB') : String(v)
  const range = min != null && max != null && min !== max ? `${n(min)}–${n(max)}` : n(max ?? min)
  return facts.currency ? `${range} ${facts.currency}` : range
}
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function draftBlock(row: { review_state: string; funding_call_id: string | null; stale_evidence: boolean; match_type: string | null }, fact: FactRow | undefined): string | null {
  if (row.review_state === 'PUBLISHED') return 'Already published'
  if (row.funding_call_id) return 'Already drafted; open the catalogue draft'
  if (row.stale_evidence) return 'The source changed; check the evidence again first'
  if (!fact?.quality) return null // "Draft it" extracts first and drafts only if the details are complete.
  if (fact.conflicts) return 'Some extracted facts conflict with the source; extract again or reject'
  if (row.match_type && !['NEW', 'NEW_ROUND_OF'].includes(row.match_type)) return 'Matched to an existing catalogue call; resolve that first'
  if (fact.quality !== 'READY') return `Details incomplete: ${(fact.reasons ?? []).join('; ') || 'the invitation, dates or round are missing'}`
  return null
}

export async function reviewLane(lane: string, options: { q?: string; cap?: number } = {}) {
  const cap = options.cap ?? REVIEW_LIST_CAP
  const q = options.q?.trim()
  const search: Prisma.MonitorOpportunityWhereInput = q ? { OR: [
    { title: { contains: q, mode: 'insensitive' } },
    { primary_resource: { canonical_url: { contains: q, mode: 'insensitive' } } },
    { primary_resource: { title: { contains: q, mode: 'insensitive' } } },
    { site: { host: { contains: q, mode: 'insensitive' } } },
  ] } : {}
  const where = { ...laneWhere(lane), ...search }
  const [total, rows] = await Promise.all([
    prisma.monitorOpportunity.count({ where }),
    prisma.monitorOpportunity.findMany({ where, orderBy: { created_at: 'desc' }, take: cap, select: {
      id: true, title: true, review_state: true, processing_state: true, triage_verdict: true, triage_confidence: true, triage_reason: true, relevance_outcome: true,
      match_type: true, lifecycle: true, stale_evidence: true, created_at: true, funding_call_id: true,
      site: { select: { host: true } }, funder: { select: { name: true } },
      primary_resource: { select: { title: true, canonical_url: true, final_url: true, last_validation_status: true } },
      funding_call: { select: { id: true, title: true, catalog_status: true } },
    } }),
  ])
  const ids = rows.map(r => r.id)
  // Only the handful of extracted facts, not the quoted evidence behind them.
  const factRows = ids.length ? await prisma.$queryRaw<FactRow[]>`
    SELECT o.id,
      o.field_evidence #>> '{quality,state}' AS quality,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(o.field_evidence #> '{quality,reasons}', '[]'::jsonb))) AS reasons,
      jsonb_array_length(CASE WHEN jsonb_typeof(o.field_evidence -> 'conflicts') = 'array' THEN o.field_evidence -> 'conflicts' ELSE '[]'::jsonb END)::int AS conflicts,
      (SELECT jsonb_object_agg(k, o.field_evidence #> ARRAY['payload', 'fields', k, 'value']) FROM unnest(${[...FACT_KEYS]}::text[]) AS k) AS facts
    FROM monitor_opportunities o WHERE o.id = ANY(${ids}::text[])` : []
  const facts = new Map(factRows.map(f => [f.id, f]))

  const summaries = rows.map(row => {
    const fact = facts.get(row.id)
    const f = fact?.facts ?? {}
    const title = text(f.scheme_title) ?? text(row.title) ?? text(row.primary_resource?.title) ?? 'Announcement awaiting details'
    const { outcome, detail } = classifyOpportunity(row, row.primary_resource)
    const summary: ReviewSummary = {
      id: row.id, title, host: row.site.host, url: row.primary_resource?.canonical_url ?? null,
      outcome, outcomeDetail: detail, reviewState: row.review_state, processingState: row.processing_state,
      verdict: row.triage_verdict, confidence: row.triage_confidence, reason: row.triage_reason, matchType: row.match_type,
      lifecycle: lifecycleAt(text(f.close_date), text(f.open_date), row.lifecycle), quality: fact?.quality ?? null,
      facts: { title: text(f.scheme_title), funder: text(f.agency_name) ?? row.funder?.name ?? null, deadline: text(f.close_date), opens: text(f.open_date), rolling: f.is_rolling === true, award: award(f) },
      call: row.funding_call ? { id: row.funding_call.id, title: row.funding_call.title, status: row.funding_call.catalog_status ?? null } : null,
      found: row.created_at.toISOString(),
      duplicates: { catalogue: [], discoveries: [] },
      draftBlock: draftBlock(row, fact),
    }
    return { summary, urls: [row.primary_resource?.canonical_url, row.primary_resource?.final_url].filter((u): u is string => Boolean(u)), ownCallId: row.funding_call_id }
  })
  await attachDuplicates(summaries)
  return { total, truncated: total > rows.length, rows: summaries.map(s => s.summary) }
}

/** Live catalogue twins for each row, and twins among all discoveries still open for review. */
async function attachDuplicates(items: Array<{ summary: ReviewSummary; urls: string[]; ownCallId: string | null }>) {
  if (!items.length) return
  const index = await catalogueIndex()
  const subject = (s: ReviewSummary, urls: string[], ownCallId: string | null): DuplicateSubject => ({ id: s.id, title: s.title, funder: s.facts.funder, urls, deadline: s.facts.deadline, ownCallId, host: s.host })
  for (const item of items) item.summary.duplicates.catalogue = checkAgainst(index, subject(item.summary, item.urls, item.ownCallId))
  // Twins are looked for among every open discovery, not just this lane's rows.
  const open = await openSubjects()
  const listed = new Map(items.map(i => [i.summary.id, subject(i.summary, i.urls, i.ownCallId)]))
  const twins = discoveryTwins([...listed.values(), ...open.filter(o => !listed.has(o.id))])
  for (const item of items) item.summary.duplicates.discoveries = twins.get(item.summary.id) ?? []
}

async function openSubjects(): Promise<DuplicateSubject[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; title: string | null; funder: string | null; deadline: string | null; url: string | null; host: string; call: string | null }>>`
    SELECT o.id, COALESCE(NULLIF(o.field_evidence #>> '{payload,fields,scheme_title,value}', ''), o.title, r.title) AS title,
      o.field_evidence #>> '{payload,fields,agency_name,value}' AS funder, o.field_evidence #>> '{payload,fields,close_date,value}' AS deadline,
      r.canonical_url AS url, s.host, o.funding_call_id AS call
    FROM monitor_opportunities o JOIN monitor_sites s ON s.id = o.site_id LEFT JOIN monitor_resources r ON r.id = o.primary_resource_id
    WHERE o.review_state = ANY(${OPEN_REVIEW}::text[]) AND (o.triage_verdict IS NULL OR o.triage_verdict <> 'NOT_FUNDING')`
  return rows.filter(r => r.title).map(r => ({ id: r.id, title: r.title!, funder: r.funder, urls: r.url ? [r.url] : [], deadline: r.deadline, ownCallId: r.call, host: r.host }))
}

export async function laneCounts(lanes: string[]) {
  const counts = await Promise.all(lanes.map(lane => prisma.monitorOpportunity.count({ where: laneWhere(lane) })))
  return Object.fromEntries(lanes.map((lane, i) => [lane, counts[i]]))
}

/** One discovery's duplicate check, for the detail view. */
export async function duplicateCheckFor(id: string): Promise<DuplicateCheck> {
  const row = await prisma.monitorOpportunity.findUnique({ where: { id }, select: { id: true, title: true, funding_call_id: true, field_evidence: true, site: { select: { host: true } }, primary_resource: { select: { title: true, canonical_url: true, final_url: true } } } })
  if (!row) return { catalogue: [], discoveries: [] }
  const f = ((row.field_evidence as { payload?: { fields?: Record<string, { value: unknown }> } } | null)?.payload?.fields ?? {})
  const title = text(f.scheme_title?.value) ?? text(row.title) ?? text(row.primary_resource?.title) ?? ''
  const s: DuplicateSubject = { id: row.id, title, funder: text(f.agency_name?.value), urls: [row.primary_resource?.canonical_url, row.primary_resource?.final_url].filter((u): u is string => Boolean(u)), deadline: text(f.close_date?.value), ownCallId: row.funding_call_id, host: row.site.host }
  const twins = discoveryTwins([s, ...(await openSubjects()).filter(o => o.id !== s.id)])
  return { catalogue: checkAgainst(await catalogueIndex(), s), discoveries: twins.get(s.id) ?? [] }
}
