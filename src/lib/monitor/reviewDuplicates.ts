import { prisma } from '@/lib/prisma'

import { tokens } from './relevance'
import { identifyUrl } from './urlIdentity'

/**
 * The duplicate check shown in Review: is a found call already in the
 * catalogue, or found more than once?
 *
 * The pipeline's own match (matching.ts) is stored when a page is screened or
 * extracted and goes stale as the catalogue grows: 30 Oct 2026, a DIV Fund RFP
 * still read "new" after the curated call arrived. This check runs against
 * the catalogue as it is now, every time the list loads, so a reviewer sees
 * the twin before drafting. It only informs; drafting and publishing keep
 * their own blocking checks.
 */

export interface CatalogueTwin {
  id: string
  title: string
  status: string
  origin: 'Imported' | 'Curated'
  reason: 'Same page' | 'Same title' | 'Similar title, same funder'
}
export interface DiscoveryTwin { id: string; title: string; host: string; reason: 'Same page' | 'Same title' }
export interface DuplicateCheck { catalogue: CatalogueTwin[]; discoveries: DiscoveryTwin[] }
export interface DuplicateSubject {
  id: string
  title: string
  funder: string | null
  urls: string[]
  deadline: string | null
  /** The catalogue draft made from this discovery: its own call, not a twin. */
  ownCallId: string | null
  host: string
}

// Words every funding title shares; they say nothing about which call it is.
const GENERIC = new Set(['call', 'calls', 'grant', 'grants', 'programme', 'program', 'programmes', 'programs', 'funding', 'fund', 'research', 'proposals', 'proposal',
  'applications', 'application', 'award', 'awards', 'scheme', 'opportunity', 'opportunities', 'open', 'for', 'and', 'the', 'with', 'from', 'new', 'request', 'support', 'round'])
const SAME_TITLE = 0.75
const SIMILAR_TITLE = 0.6
/** A word in more titles than this is too common to find candidates by. */
const MAX_POSTINGS = 400

export function titleWords(title: string): string[] {
  return [...new Set(tokens(title).filter(t => t.length > 2 && !GENERIC.has(t) && !/^\d{1,2}$/.test(t)))]
}
function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const right = new Set(b)
  const shared = a.filter(t => right.has(t)).length
  // One shared word ("fellowship") is not a twin, however short the titles.
  if (shared < Math.min(2, a.length, b.length)) return 0
  return shared / new Set([...a, ...b]).size
}
const yearOf = (title: string) => title.match(/\b20\d{2}\b/)?.[0] ?? null
/** Titles naming different years are different rounds, not duplicates. */
const otherRound = (a: string, b: string) => { const x = yearOf(a), y = yearOf(b); return Boolean(x && y && x !== y) }
function sameFunder(a: string | null, b: string | null) {
  if (!a || !b) return false
  return similarity(titleWords(a), titleWords(b)) >= 0.5 || a.trim().toLowerCase() === b.trim().toLowerCase()
}
/** The whole title, normalised: the only handle on a title made of generic words ("Request for Proposals"). */
const exactTitle = (title: string) => tokens(title).join(' ')
function urlKeys(urls: Array<string | null | undefined>) {
  return [...new Set(urls.map(u => (u ? identifyUrl(u)?.dedupKey : null)).filter((k): k is string => Boolean(k)))]
}

interface IndexedCall { id: string; title: string; words: string[]; funder: string | null; status: string; origin: CatalogueTwin['origin'] }
interface CatalogueIndex { calls: Map<string, IndexedCall>; byUrl: Map<string, string[]>; byWord: Map<string, string[]>; byTitle: Map<string, string[]>; size: number; builtAt: number }

let cached: CatalogueIndex | null = null
const TTL_MS = 5 * 60_000

/** Every catalogue call a reviewer could duplicate, indexed by page and title words. */
export async function catalogueIndex(now = Date.now()): Promise<CatalogueIndex> {
  if (cached && now - cached.builtAt < TTL_MS) return cached
  const rows = await prisma.fundingCall.findMany({
    where: { NOT: { catalog_status: { in: ['ARCHIVED', 'REJECTED'] } } },
    select: { id: true, title: true, scheme_title: true, agency_name: true, agencyName: true, source_url: true, sourceUrl: true, official_urls: true, catalog_status: true, import_run_id: true },
  })
  const index: CatalogueIndex = { calls: new Map(), byUrl: new Map(), byWord: new Map(), byTitle: new Map(), size: rows.length, builtAt: now }
  const add = (map: Map<string, string[]>, key: string, id: string) => { const list = map.get(key); if (list) list.push(id); else map.set(key, [id]) }
  for (const row of rows) {
    const title = row.scheme_title || row.title
    const words = titleWords(title)
    index.calls.set(row.id, { id: row.id, title, words, funder: row.agency_name || row.agencyName || null, status: String(row.catalog_status ?? 'DRAFT'), origin: row.import_run_id ? 'Imported' : 'Curated' })
    for (const key of urlKeys([row.source_url, row.sourceUrl, ...row.official_urls])) add(index.byUrl, key, row.id)
    for (const word of words) add(index.byWord, word, row.id)
    add(index.byTitle, exactTitle(title), row.id)
  }
  cached = index
  return index
}
/** Tests and writes that must see a call at once. */
export function forgetCatalogueIndex() { cached = null }

export function checkAgainst(index: Pick<CatalogueIndex, 'calls' | 'byUrl' | 'byWord' | 'byTitle'>, subject: DuplicateSubject): CatalogueTwin[] {
  const found = new Map<string, CatalogueTwin>()
  for (const key of urlKeys(subject.urls)) for (const id of index.byUrl.get(key) ?? []) {
    const call = index.calls.get(id)!
    if (id !== subject.ownCallId && !otherRound(subject.title, call.title)) found.set(id, { id, title: call.title, status: call.status, origin: call.origin, reason: 'Same page' })
  }
  // Word-for-word the same title from the same funder, however generic the words.
  for (const id of index.byTitle.get(exactTitle(subject.title)) ?? []) {
    const call = index.calls.get(id)!
    if (id !== subject.ownCallId && !found.has(id) && (sameFunder(subject.funder, call.funder) || titleWords(subject.title).length >= 2)) found.set(id, { id, title: call.title, status: call.status, origin: call.origin, reason: 'Same title' })
  }
  const words = titleWords(subject.title)
  const candidates = new Set<string>()
  for (const word of words) { const ids = index.byWord.get(word) ?? []; if (ids.length <= MAX_POSTINGS) ids.forEach(id => candidates.add(id)) }
  const ranked: Array<{ twin: CatalogueTwin; score: number }> = []
  for (const id of candidates) {
    if (id === subject.ownCallId || found.has(id)) continue
    const call = index.calls.get(id)!
    if (otherRound(subject.title, call.title)) continue
    const score = similarity(words, call.words)
    const reason = score >= SAME_TITLE ? 'Same title' : score >= SIMILAR_TITLE && sameFunder(subject.funder, call.funder) ? 'Similar title, same funder' : null
    if (reason) ranked.push({ twin: { id, title: call.title, status: call.status, origin: call.origin, reason }, score })
  }
  ranked.sort((a, b) => b.score - a.score)
  return [...found.values(), ...ranked.slice(0, 5).map(r => r.twin)].slice(0, 5)
}

/** Discoveries that are the same call: one page, or one title with the same (or no) deadline. */
export function discoveryTwins(subjects: DuplicateSubject[]): Map<string, DiscoveryTwin[]> {
  const out = new Map<string, DiscoveryTwin[]>()
  const push = (a: DuplicateSubject, b: DuplicateSubject, reason: DiscoveryTwin['reason']) => {
    const list = out.get(a.id) ?? []
    if (!list.some(t => t.id === b.id)) list.push({ id: b.id, title: b.title, host: b.host, reason })
    out.set(a.id, list)
  }
  const byUrl = new Map<string, DuplicateSubject[]>()
  for (const s of subjects) for (const key of urlKeys(s.urls.slice(0, 1))) byUrl.set(key, [...(byUrl.get(key) ?? []), s])
  for (const group of byUrl.values()) for (const a of group) for (const b of group) if (a.id !== b.id) push(a, b, 'Same page')
  const words = new Map(subjects.map(s => [s.id, titleWords(s.title)]))
  const byWord = new Map<string, DuplicateSubject[]>()
  for (const s of subjects) for (const w of words.get(s.id)!) byWord.set(w, [...(byWord.get(w) ?? []), s])
  for (const a of subjects) {
    const seen = new Set<string>()
    for (const w of words.get(a.id)!) for (const b of byWord.get(w) ?? []) {
      if (b.id === a.id || seen.has(b.id)) continue
      seen.add(b.id)
      const sameDeadline = !a.deadline || !b.deadline || a.deadline === b.deadline
      if (sameDeadline && !otherRound(a.title, b.title) && similarity(words.get(a.id)!, words.get(b.id)!) >= SAME_TITLE) push(a, b, 'Same title')
    }
  }
  return out
}
