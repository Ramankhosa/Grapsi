/**
 * Conservative duplicate detection between imported and existing calls.
 *
 * Nothing here merges anything. It only sorts suspicious pairs into tiers for
 * a human: LIKELY and POSSIBLE block the imported call's release until
 * reviewed; RELATED (sibling awards on one programme page, another round of
 * the same series) is recorded but does not block.
 *
 * A shared URL is a signal, not proof: 26 Melanoma Research Alliance records
 * share one RFP page while being different awards. Different rounds of an
 * annual programme are different opportunities, not duplicates.
 *
 * Pure module (no database).
 */
import crypto from 'node:crypto'

import { matchKey, normalizeUrl } from './normalize/text'
import { seriesTitle } from './normalize/titles'

export type DuplicateTier = 'LIKELY_DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'RELATED'

export interface DedupCall {
  id: string
  kind: 'imported' | 'existing'
  title: string
  funderKeys: string[]
  urlKeys: string[]
  finalDeadline: string | null
  year: number | null
  descriptionHash: string | null
  seriesKey: string | null
}

export interface DuplicatePair {
  subjectId: string
  candidateId: string
  candidateKind: 'imported' | 'existing'
  tier: DuplicateTier
  score: number
  signals: {
    titleSimilarity: number
    sameFunder: boolean
    sameUrl: boolean
    sameDescription: boolean
    sameSeries: boolean
    round: 'same' | 'different' | 'unknown'
    deadlineGapDays: number | null
    /**
     * Same funder, same page, identical title apart from the source's
     * "(topic | scope)" tag: the listing site published one opportunity once
     * per eligibility group. Still a duplicate for review, grouped so it can
     * be resolved in bulk.
     */
    listingVariant: boolean
  }
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'in', 'on', 'to', 'at', 'by', 'with', 'from', 'call', 'grant', 'grants', 'program', 'programme', 'award', 'awards', 'fund', 'funding'])

interface Prepared {
  call: DedupCall
  tokens: Set<string>
  trigrams: Set<string>
}

function prepare(call: DedupCall): Prepared {
  const key = seriesTitle(call.title)
  const tokens = new Set(key.split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t)))
  const compact = ` ${key} `
  const trigrams = new Set<string>()
  for (let i = 0; i + 3 <= compact.length; i++) trigrams.add(compact.slice(i, i + 3))
  return { call, tokens, trigrams }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export function titleSimilarity(a: string, b: string): number {
  const pa = prepare({ id: '', kind: 'existing', title: a, funderKeys: [], urlKeys: [], finalDeadline: null, year: null, descriptionHash: null, seriesKey: null })
  const pb = prepare({ id: '', kind: 'existing', title: b, funderKeys: [], urlKeys: [], finalDeadline: null, year: null, descriptionHash: null, seriesKey: null })
  return Math.max(jaccard(pa.tokens, pb.tokens), jaccard(pa.trigrams, pb.trigrams))
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

function intersects(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(a)
  return b.some((x) => set.has(x))
}

export function descriptionHash(description: string | null | undefined): string | null {
  const key = matchKey(description || '')
  return key.length >= 200 ? crypto.createHash('sha1').update(key).digest('hex') : null
}

export function urlKeys(urls: Array<string | null | undefined>): string[] {
  return Array.from(new Set(urls.map((u) => normalizeUrl(u)).filter((u): u is string => Boolean(u))))
}

export function classifyPair(a: Prepared, b: Prepared): DuplicatePair | null {
  const titleSim = Math.max(jaccard(a.tokens, b.tokens), jaccard(a.trigrams, b.trigrams))
  const sameFunder = intersects(a.call.funderKeys, b.call.funderKeys)
  const sameUrl = intersects(a.call.urlKeys, b.call.urlKeys)
  const sameDescription = Boolean(a.call.descriptionHash && a.call.descriptionHash === b.call.descriptionHash)
  const sameSeries = Boolean(a.call.seriesKey && a.call.seriesKey === b.call.seriesKey)
  let round: 'same' | 'different' | 'unknown' = 'unknown'
  let gap: number | null = null
  if (a.call.finalDeadline && b.call.finalDeadline) {
    gap = daysBetween(a.call.finalDeadline, b.call.finalDeadline)
    round = gap <= 14 ? 'same' : gap > 60 ? 'different' : 'unknown'
  } else if (a.call.year && b.call.year && a.call.year !== b.call.year) {
    round = 'different'
  }
  const listingVariant = sameFunder && sameUrl && round !== 'different' && seriesTitle(a.call.title) === seriesTitle(b.call.title) && a.call.title !== b.call.title
  const signals = { titleSimilarity: Number(titleSim.toFixed(3)), sameFunder, sameUrl, sameDescription, sameSeries, round, deadlineGapDays: gap === null ? null : Math.round(gap), listingVariant }

  let tier: DuplicateTier | null = null
  if (round !== 'different') {
    if ((sameFunder && titleSim >= 0.85 && round === 'same') || (sameDescription && sameFunder) || (sameUrl && sameFunder && titleSim >= 0.7)) {
      tier = 'LIKELY_DUPLICATE'
    } else if ((sameFunder && titleSim >= 0.6) || (sameUrl && titleSim >= 0.5) || (sameDescription && titleSim >= 0.5)) {
      tier = 'POSSIBLE_DUPLICATE'
    }
  }
  if (!tier && (sameUrl || (sameSeries && sameFunder) || (sameFunder && titleSim >= 0.85))) tier = 'RELATED'
  if (!tier) return null
  const score = Number((0.5 * titleSim + (sameFunder ? 0.2 : 0) + (sameUrl ? 0.15 : 0) + (sameDescription ? 0.15 : 0)).toFixed(3))
  return { subjectId: a.call.id, candidateId: b.call.id, candidateKind: b.call.kind, tier, score, signals }
}

function blockIndex(items: Prepared[], keysOf: (p: Prepared) => string[]) {
  const index = new Map<string, Prepared[]>()
  for (const item of items) {
    for (const key of keysOf(item)) {
      const bucket = index.get(key)
      if (bucket) bucket.push(item)
      else index.set(key, [item])
    }
  }
  return index
}

/** Rarest two title tokens: a cheap block that catches same-title calls whose funder name differs. */
function rareTokenKeys(prepared: Prepared[]): (p: Prepared) => string[] {
  const df = new Map<string, number>()
  for (const p of prepared) for (const t of p.tokens) df.set(t, (df.get(t) || 0) + 1)
  return (p) => Array.from(p.tokens).filter((t) => t.length > 3).sort((x, y) => (df.get(x) || 0) - (df.get(y) || 0)).slice(0, 2).map((t) => `t:${t}`)
}

const MAX_BLOCK = 600

/**
 * imported ↔ existing and imported ↔ imported pairs. For imported pairs the
 * lower id is the subject; both sides are blocked if the tier blocks.
 */
export function findDuplicatePairs(imported: DedupCall[], existing: DedupCall[]): DuplicatePair[] {
  const pi = imported.map(prepare)
  const pe = existing.map(prepare)
  const all = [...pi, ...pe]
  const rare = rareTokenKeys(all)
  const keysOf = (p: Prepared) => [
    ...p.call.funderKeys.map((k) => `f:${k}`),
    ...p.call.urlKeys.map((k) => `u:${k}`),
    ...(p.call.descriptionHash ? [`d:${p.call.descriptionHash}`] : []),
    ...rare(p),
  ]
  const existingIndex = blockIndex(pe, keysOf)
  const importedIndex = blockIndex(pi, keysOf)
  const pairs = new Map<string, DuplicatePair>()
  for (const a of pi) {
    const seen = new Set<string>()
    for (const key of keysOf(a)) {
      for (const b of [...(existingIndex.get(key) || []).slice(0, MAX_BLOCK), ...(importedIndex.get(key) || []).slice(0, MAX_BLOCK)]) {
        if (b === a || seen.has(b.call.id)) continue
        seen.add(b.call.id)
        if (b.call.kind === 'imported' && b.call.id < a.call.id) continue // each imported pair once
        const pair = classifyPair(a, b)
        if (!pair) continue
        const pairKey = `${pair.subjectId}|${pair.candidateId}`
        const prev = pairs.get(pairKey)
        if (!prev || rankTier(pair.tier) > rankTier(prev.tier)) pairs.set(pairKey, pair)
      }
    }
  }
  return Array.from(pairs.values())
}

/** existing ↔ existing, report only. */
export function findExistingDuplicatePairs(existing: DedupCall[]): DuplicatePair[] {
  const pe = existing.map(prepare)
  const rare = rareTokenKeys(pe)
  const keysOf = (p: Prepared) => [...p.call.funderKeys.map((k) => `f:${k}`), ...p.call.urlKeys.map((k) => `u:${k}`), ...rare(p)]
  const index = blockIndex(pe, keysOf)
  const pairs = new Map<string, DuplicatePair>()
  for (const a of pe) {
    for (const key of keysOf(a)) {
      for (const b of (index.get(key) || []).slice(0, MAX_BLOCK)) {
        if (b.call.id <= a.call.id) continue
        const pair = classifyPair(a, b)
        if (!pair || pair.tier === 'RELATED') continue
        pairs.set(`${a.call.id}|${b.call.id}`, pair)
      }
    }
  }
  return Array.from(pairs.values())
}

export function rankTier(tier: DuplicateTier): number {
  return tier === 'LIKELY_DUPLICATE' ? 3 : tier === 'POSSIBLE_DUPLICATE' ? 2 : 1
}

export function tierBlocksRelease(tier: DuplicateTier): boolean {
  return tier === 'LIKELY_DUPLICATE' || tier === 'POSSIBLE_DUPLICATE'
}
