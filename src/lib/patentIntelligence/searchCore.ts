/**
 * Pure helpers for Patent Search. No network, no Prisma, no next/server — this
 * file is bundled into the client pages as well as used by the API routes, and
 * it is unit-tested without the server import graph (see
 * src/tests/unit/patent-intelligence-core.test.ts).
 */

import type { PatentEvidence } from '@/lib/ideaIntelligence/evidenceSources'
import { jurisdictionOf } from '@/lib/ideaIntelligence/priorWork'
import type { IndianPatentRecord } from '@/lib/patentnest/types'
import type {
  PatentFacetItem,
  PatentFacets,
  PatentFilters,
  PatentSearchItem,
  PatentShortlistItemDto,
  PatentSort,
} from './types'

export const PATENT_SEARCH_LIMITS = { min: 1, max: 50, default: 30 } as const
export const PATENT_QUERY_BOUNDS = { min: 2, max: 2000 } as const
export const PATENT_SEARCH_LIMIT_CHOICES = [20, 30, 50] as const

const FACET_APPLICANT_LIMIT = 15
const HIGHLIGHT_TERM_LIMIT = 12
const FIND_SIMILAR_ABSTRACT_CHARS = 600

const HIGHLIGHT_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'using', 'used', 'use', 'are',
  'was', 'were', 'has', 'have', 'had', 'not', 'but', 'can', 'may', 'will', 'its', 'our', 'their',
  'which', 'where', 'when', 'while', 'than', 'then', 'also', 'such', 'each', 'any', 'all', 'one',
  'two', 'via', 'per', 'upon', 'over', 'under', 'between', 'within', 'without', 'through', 'about',
  'these', 'those', 'there', 'here', 'being', 'been', 'more', 'most', 'less', 'very', 'both', 'either',
  'other', 'based', 'method', 'methods', 'system', 'systems', 'device', 'devices', 'thereof', 'wherein',
  'comprising', 'comprises', 'said', 'least', 'present', 'invention', 'provides', 'provided',
])

export function normalizeQuery(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

export function isValidQuery(query: string): boolean {
  const length = Array.from(query).length
  return length >= PATENT_QUERY_BOUNDS.min && length <= PATENT_QUERY_BOUNDS.max
}

export function clampLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return PATENT_SEARCH_LIMITS.default
  return Math.min(PATENT_SEARCH_LIMITS.max, Math.max(PATENT_SEARCH_LIMITS.min, Math.round(parsed)))
}

export function normalizePublicationNumberKey(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed : null
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const text = cleanString(item)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function yearOf(date: string | null): number | null {
  const match = date ? /^(\d{4})/.exec(date) : null
  if (!match) return null
  const year = Number(match[1])
  return year >= 1800 && year <= 2200 ? year : null
}

/**
 * PatentNest returns IPC/CPC codes in the compact "full symbol" form
 * (C02F0001720000). Render those as the familiar C02F 1/72; anything already
 * human-readable passes through untouched. Data keeps the raw code.
 */
export function formatClassification(code: string): string {
  const compact = String(code ?? '').replace(/\s+/g, '').toUpperCase()
  const match = /^([A-H]\d{2}[A-Z])(\d{4})(\d{6})$/.exec(compact)
  if (!match) return String(code ?? '').trim()
  const mainGroup = String(Number(match[2]))
  const subgroup = match[3].replace(/0+$/, '').padEnd(2, '0')
  return `${match[1]} ${mainGroup}/${subgroup}`
}

/** "A61K 31/00" → "A61K"; falls back to the first four compact characters. */
export function classificationGroupOf(classification: string): string | null {
  const compact = classification.replace(/\s+/g, '').toUpperCase()
  const match = /^([A-H]\d{2}[A-Z])/.exec(compact)
  if (match) return match[1]
  return compact.length >= 3 ? compact.slice(0, 4) : null
}

/** Normalize a raw PatentNest record into the shape the UI and shortlist use. Returns null without a publication number. */
export function toPatentSearchItem(record: IndianPatentRecord | null | undefined): PatentSearchItem | null {
  if (!record || typeof record !== 'object') return null
  const publicationNumber = cleanString(record.publicationNumber)
  if (!publicationNumber) return null
  const publicationNumberKey = normalizePublicationNumberKey(publicationNumber)
  if (!publicationNumberKey) return null

  const country = cleanString(record.country)?.toUpperCase() ?? null
  const jurisdiction = country && /^[A-Z]{2}$/.test(country) ? country : jurisdictionOf(publicationNumber)
  const filingDate = cleanString(record.filingDate)
  const publicationDate = cleanString(record.publicationDate)
  const classifications = cleanStringList(record.classifications)
  const classificationGroups = Array.from(new Set(
    classifications.map(classificationGroupOf).filter((group): group is string => Boolean(group)),
  ))

  const applicants = Array.isArray(record.applicants)
    ? record.applicants
      .map((applicant) => {
        if (typeof applicant === 'string') return { name: cleanString(applicant), address: null }
        if (!applicant || typeof applicant !== 'object') return { name: null, address: null }
        return { name: cleanString(applicant.name), address: cleanString(applicant.address) }
      })
      .filter((applicant): applicant is { name: string; address: string | null } => Boolean(applicant.name))
    : []

  const relevance = record.relevance && typeof record.relevance === 'object'
    ? {
      score: cleanNumber(record.relevance.score),
      semanticScore: cleanNumber(record.relevance.semanticScore),
      textScore: cleanNumber(record.relevance.textScore),
      matchedFields: cleanStringList(record.relevance.matchedFields),
    }
    : null

  const sourceName = record.source && typeof record.source === 'object' ? cleanString(record.source.name) : null
  const source = sourceName && record.source
    ? {
      name: sourceName,
      document: cleanString(record.source.document),
      page: cleanNumber(record.source.page),
    }
    : null

  return {
    id: publicationNumberKey,
    publicationNumber,
    publicationNumberKey,
    applicationNumber: cleanString(record.applicationNumber),
    kind: cleanString(record.kind)?.toUpperCase() ?? null,
    country,
    jurisdiction,
    title: cleanString(record.title) || 'Untitled patent',
    abstract: typeof record.abstract === 'string' && record.abstract.trim() ? record.abstract.trim() : null,
    applicants,
    inventors: cleanStringList(record.inventors),
    classifications,
    classificationGroups,
    filingDate,
    publicationDate,
    filingYear: yearOf(filingDate),
    publicationYear: yearOf(publicationDate),
    numberOfPages: cleanNumber(record.numberOfPages),
    numberOfClaims: cleanNumber(record.numberOfClaims),
    extractionConfidence: cleanNumber(record.extractionConfidence),
    source,
    relevance,
  }
}

export function patentYear(item: Pick<PatentSearchItem, 'publicationYear' | 'filingYear'>): number | null {
  return item.publicationYear ?? item.filingYear ?? null
}

function countFacet(values: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return counts
}

function toFacetItems(counts: Map<string, number>, compare?: (a: PatentFacetItem, b: PatentFacetItem) => number): PatentFacetItem[] {
  const items = Array.from(counts.entries()).map(([value, count]) => ({ value, count }))
  items.sort(compare || ((a, b) => b.count - a.count || a.value.localeCompare(b.value)))
  return items
}

/** Facets are derived from the (unfiltered) result page, so counts stay fixed while the user toggles filters. */
export function derivePatentFacets(items: PatentSearchItem[]): PatentFacets {
  const jurisdictions = countFacet(items.flatMap((item) => (item.jurisdiction ? [item.jurisdiction] : [])))
  const applicants = countFacet(items.flatMap((item) => Array.from(new Set(item.applicants.map((applicant) => applicant.name)))))
  const years = countFacet(items.flatMap((item) => {
    const year = patentYear(item)
    return year ? [String(year)] : []
  }))
  const classifications = countFacet(items.flatMap((item) => item.classificationGroups))
  const kinds = countFacet(items.flatMap((item) => (item.kind ? [item.kind] : [])))

  return {
    jurisdictions: toFacetItems(jurisdictions),
    applicants: toFacetItems(applicants).slice(0, FACET_APPLICANT_LIMIT),
    years: toFacetItems(years, (a, b) => Number(b.value) - Number(a.value)),
    classifications: toFacetItems(classifications),
    kinds: toFacetItems(kinds),
  }
}

export const EMPTY_PATENT_FILTERS: PatentFilters = {
  jurisdictions: [],
  applicants: [],
  years: [],
  classifications: [],
  kinds: [],
}

export function countActivePatentFilters(filters: PatentFilters): number {
  return filters.jurisdictions.length + filters.applicants.length + filters.years.length
    + filters.classifications.length + filters.kinds.length
}

/** AND across facets, OR within a facet. Empty filters are the identity. */
export function applyPatentFilters(items: PatentSearchItem[], filters: PatentFilters): PatentSearchItem[] {
  const jurisdictions = new Set(filters.jurisdictions)
  const applicants = new Set(filters.applicants)
  const years = new Set(filters.years)
  const classifications = new Set(filters.classifications)
  const kinds = new Set(filters.kinds)

  return items.filter((item) => {
    if (jurisdictions.size && !(item.jurisdiction && jurisdictions.has(item.jurisdiction))) return false
    if (applicants.size && !item.applicants.some((applicant) => applicants.has(applicant.name))) return false
    if (years.size) {
      const year = patentYear(item)
      if (!year || !years.has(String(year))) return false
    }
    if (classifications.size && !item.classificationGroups.some((group) => classifications.has(group))) return false
    if (kinds.size && !(item.kind && kinds.has(item.kind))) return false
    return true
  })
}

function sortDate(item: PatentSearchItem): string | null {
  return item.publicationDate ?? item.filingDate ?? null
}

/** Stable; `relevance` keeps PatentNest's ranking, date sorts put undated records last. */
export function sortPatents(items: PatentSearchItem[], sort: PatentSort): PatentSearchItem[] {
  if (sort === 'relevance') return [...items]
  const direction = sort === 'newest' ? -1 : 1
  return items
    .map((item, index) => ({ item, index, date: sortDate(item) }))
    .sort((a, b) => {
      // ISO dates compare lexically; ascending order flipped for "newest".
      if (a.date && b.date && a.date !== b.date) return (a.date < b.date ? -1 : 1) * direction
      if (a.date && !b.date) return -1
      if (!a.date && b.date) return 1
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

export function tokenizeHighlightTerms(query: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const token of normalizeQuery(query).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 3 || HIGHLIGHT_STOPWORDS.has(token) || seen.has(token)) continue
    seen.add(token)
    terms.push(token)
    if (terms.length >= HIGHLIGHT_TERM_LIMIT) break
  }
  return terms
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type HighlightChunk = { text: string; hit: boolean }

export function splitForHighlight(text: string | null | undefined, terms: string[]): HighlightChunk[] {
  if (!text) return []
  if (!terms.length) return [{ text, hit: false }]
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu')
  const lookup = new Set(terms.map((term) => term.toLowerCase()))
  return text
    .split(pattern)
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => ({ text: chunk, hit: lookup.has(chunk.toLowerCase()) }))
}

export function buildFindSimilarQuery(item: Pick<PatentSearchItem, 'title' | 'abstract'>): string {
  const abstractHead = item.abstract ? normalizeQuery(item.abstract).slice(0, FIND_SIMILAR_ABSTRACT_CHARS) : ''
  const combined = normalizeQuery([item.title, abstractHead].filter(Boolean).join('. '))
  return Array.from(combined).slice(0, PATENT_QUERY_BOUNDS.max).join('')
}

function applicantNames(item: PatentSearchItem): string {
  return item.applicants.map((applicant) => applicant.name).join('; ')
}

/**
 * A citation line a grant writer can paste into the prior-art / IP section.
 * Missing pieces are omitted rather than printed as "null".
 */
export function formatPatentCitation(item: PatentSearchItem, style: 'plain' | 'markdown' = 'plain'): string {
  const number = [item.publicationNumber, item.kind ? `(kind ${item.kind})` : null].filter(Boolean).join(' ')
  const numberText = style === 'markdown' ? `\`${number}\`` : number
  const parts: string[] = []
  parts.push(style === 'markdown' ? `**${item.title}**` : item.title)
  const applicants = applicantNames(item)
  if (applicants) parts.push(applicants)
  parts.push(`Publication No. ${numberText}${item.jurisdiction ? `, ${item.jurisdiction}` : ''}`)
  const dates = [
    item.filingDate ? `Filed ${item.filingDate}` : null,
    item.publicationDate ? `published ${item.publicationDate}` : null,
  ].filter(Boolean)
  if (dates.length) parts.push(dates.join('; '))
  if (item.classifications.length) parts.push(`IPC/CPC: ${item.classifications.slice(0, 6).map(formatClassification).join('; ')}`)
  const sourceBits = [item.source?.document, item.source?.page != null ? `p. ${item.source.page}` : null].filter(Boolean)
  parts.push(`Source: PatentNest${sourceBits.length ? ` (${sourceBits.join(', ')})` : ''}`)
  if (style === 'markdown') return `- ${parts[0]} — ${parts.slice(1).join('. ')}.`
  return `${parts.join('. ')}.`
}

export function formatShortlistMarkdown(items: PatentShortlistItemDto[], options: { heading?: string } = {}): string {
  const heading = options.heading ?? 'Related patents'
  const lines = [`## ${heading}`, '']
  if (!items.length) lines.push('_No patents shortlisted yet._')
  for (const item of items) {
    lines.push(formatPatentCitation(item.record, 'markdown'))
    if (item.note) lines.push(`  - Note: ${item.note.replace(/\s+/g, ' ').trim()}`)
  }
  return `${lines.join('\n')}\n`
}

export const SHORTLIST_CSV_COLUMNS = [
  'publication_number', 'title', 'applicants', 'inventors', 'kind', 'jurisdiction', 'filing_date',
  'publication_date', 'classifications', 'relevance_score', 'note', 'saved_at', 'source',
] as const

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildShortlistCsv(items: PatentShortlistItemDto[]): string {
  const rows = items.map((item) => [
    item.record.publicationNumber,
    item.record.title,
    applicantNames(item.record),
    item.record.inventors.join('; '),
    item.record.kind,
    item.record.jurisdiction,
    item.record.filingDate,
    item.record.publicationDate,
    item.record.classifications.map(formatClassification).join('; '),
    item.record.relevance?.score ?? null,
    item.note,
    item.createdAt,
    item.record.source?.name || 'PatentNest',
  ].map(csvCell).join(','))
  return [SHORTLIST_CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n'
}

export function buildSearchCacheKey(query: string, limit: number, jurisdictions: string[] = []): string {
  const normalizedJurisdictions = Array.from(new Set(jurisdictions.map((value) => value.trim().toUpperCase()).filter(Boolean))).sort()
  return `${normalizeQuery(query).toLowerCase()}|${clampLimit(limit)}|${normalizedJurisdictions.join(',')}`
}

// --- URL state -------------------------------------------------------------
// Facet values (applicant names!) can contain commas, so lists are pipe-joined.

const FILTER_PARAM_KEYS: Record<keyof PatentFilters, string> = {
  jurisdictions: 'j',
  applicants: 'a',
  years: 'y',
  classifications: 'c',
  kinds: 'k',
}
const LIST_SEPARATOR = '|'

function parseList(value: string | null): string[] {
  return value ? value.split(LIST_SEPARATOR).map((item) => item.trim()).filter(Boolean) : []
}

export function readPatentFiltersFromParams(get: (key: string) => string | null): PatentFilters {
  return {
    jurisdictions: parseList(get(FILTER_PARAM_KEYS.jurisdictions)),
    applicants: parseList(get(FILTER_PARAM_KEYS.applicants)),
    years: parseList(get(FILTER_PARAM_KEYS.years)),
    classifications: parseList(get(FILTER_PARAM_KEYS.classifications)),
    kinds: parseList(get(FILTER_PARAM_KEYS.kinds)),
  }
}

export function writePatentFiltersToParams(params: URLSearchParams, filters: PatentFilters): void {
  for (const key of Object.keys(FILTER_PARAM_KEYS) as Array<keyof PatentFilters>) {
    const values = filters[key]
    if (values.length) params.set(FILTER_PARAM_KEYS[key], values.join(LIST_SEPARATOR))
    else params.delete(FILTER_PARAM_KEYS[key])
  }
}

export function readPatentSort(value: string | null | undefined): PatentSort {
  return value === 'newest' || value === 'oldest' ? value : 'relevance'
}

/**
 * Phase-2 bridge: lets a shortlisted patent feed the idea-intelligence prior-work
 * merge (`buildPriorWork`) and the future "Compare with my idea" flow. Not called
 * anywhere in v1 — kept here so the adapter lives next to the shape it maps.
 */
export function toPatentEvidence(item: PatentSearchItem): PatentEvidence {
  return {
    id: item.publicationNumberKey,
    title: item.title,
    abstract: item.abstract,
    publicationNumber: item.publicationNumber,
    assignee: item.applicants[0]?.name ?? null,
    inventor: item.inventors.length ? item.inventors.join(', ') : null,
    priorityDate: null,
    filingDate: item.filingDate,
    publicationDate: item.publicationDate,
    url: null,
    source: 'patentnest',
  }
}
