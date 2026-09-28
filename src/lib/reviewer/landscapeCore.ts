// Pure, dependency-free core of the reviewer's Research & Patent Landscape.
//
// Mirrors the priorWork.ts idiom: everything deterministic lives here so it can
// be unit-tested without the server import graph. The LLM only supplies facets
// and per-item facet tags; every list, count and status in the persisted object
// is computed, and every LLM step has a deterministic fallback so the landscape
// never blocks the final report.

import type { FacetStatus } from '@/lib/ideaIntelligence/callSignals'
import type { FacetAssessedItem, PriorWork } from '@/lib/ideaIntelligence/priorWork'

/** Persisted under overall_review_json.landscape — reference-only, never scored. */
export type ReviewerLandscape = {
  version: 1
  /**
   * ok = both sources searched; partial = one source errored but rows exist;
   * empty = searches ran, nothing retrieved; error = the whole step failed.
   */
  status: 'ok' | 'partial' | 'empty' | 'error'
  generated_at: string
  /** The 3–7 comparison axes each retrieved item was assessed against. */
  facets: string[]
  /** What was actually sent to both search backends. */
  semanticQuery: string
  facetSource: 'llm' | 'fallback'
  /** fallback ⇒ rows are listed untagged and signals are all UNASSESSED. */
  assessmentSource: 'llm' | 'fallback'
  priorWork: PriorWork
  sources: {
    projects: { searched: boolean; count: number; degradedMode: 'full_text_only' | null; error?: string }
    patents: { searched: boolean; status: 'ok' | 'not_configured' | 'error'; count: number; error?: string }
  }
  /**
   * Steps that degraded without failing the whole landscape (a timed-out
   * tagging call, a fallback query). A landscape carrying notes is complete
   * enough to show but is rebuilt rather than reused on the next report.
   */
  notes?: string[]
  error?: string
}

export type LandscapeDistillation = {
  facets: string[]
  keywords: string[]
  semanticQuery: string
  source: 'llm' | 'fallback'
}

// PatentNest rejects queries under 2 characters; 500 keeps the embedding query dense.
const QUERY_MIN_CHARS = 2
const QUERY_MAX_CHARS = 500
const FACET_MAX_CHARS = 180
const MIN_FACETS = 3
const MAX_FACETS = 7

const GENERIC_FACETS = [
  'Proposed technical approach',
  'Target user and deployment context',
  'Expected research outcome',
]

const VALID_STATUSES = new Set<FacetStatus>(['PRESENT', 'PARTIAL', 'ABSENT', 'UNASSESSED'])

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function clampQuery(value: string, fallback: string): string {
  const clean = normalizeText(value, QUERY_MAX_CHARS)
  if (clean.length >= QUERY_MIN_CHARS) return clean
  const fromFallback = normalizeText(fallback, QUERY_MAX_CHARS)
  return fromFallback.length >= QUERY_MIN_CHARS ? fromFallback : 'research proposal'
}

/**
 * A no-model distillation of the proposal into facets and a retrieval query.
 * Mirrors ideaIntelligence's fallbackStructure: phrase-split the text, keep
 * substantive fragments, pad with generic facets so downstream code always has
 * at least three comparison axes.
 */
export function buildFallbackDistillation(input: {
  projectTitle: string
  callDescription: string
  sectionDigests: Array<{ title: string; text: string }>
}): LandscapeDistillation {
  const combined = normalizeText(
    [input.projectTitle, ...input.sectionDigests.map((digest) => digest.text)].filter(Boolean).join('. '),
    8000
  )
  const phrases = combined
    .split(/[.;:\n]|\b(?:using|through|with|for|to)\b/i)
    .map((value) => normalizeText(value, 120))
    .filter((value) => value.length >= 12)
  const facets = Array.from(new Set(phrases)).slice(0, 5)
  if (facets.length < MIN_FACETS) {
    facets.push(...GENERIC_FACETS)
  }
  const keywords = Array.from(new Set(
    (combined.toLowerCase().match(/[a-z][a-z-]{4,}/g) || [])
      .filter((word) => !['research', 'using', 'based', 'project', 'develop', 'proposal'].includes(word))
  )).slice(0, 10)

  return {
    facets: Array.from(new Set(facets)).slice(0, MAX_FACETS),
    keywords,
    semanticQuery: clampQuery(
      [input.projectTitle, input.sectionDigests[0]?.text || '', input.callDescription].filter(Boolean).join('. '),
      input.projectTitle || 'research proposal'
    ),
    source: 'fallback',
  }
}

/** Coerce a distill-call response, falling back per-field when it is unusable. */
export function normalizeDistillation(raw: unknown, fallback: LandscapeDistillation): LandscapeDistillation {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const facets = Array.isArray(value.facets)
    ? value.facets.map((item) => normalizeText(item, FACET_MAX_CHARS)).filter(Boolean).slice(0, MAX_FACETS)
    : []
  const keywords = Array.isArray(value.keywords)
    ? value.keywords.map((item) => normalizeText(item, 80)).filter(Boolean).slice(0, 10)
    : []
  const semanticQuery = normalizeText(value.semanticQuery, QUERY_MAX_CHARS)
  const usable = facets.length >= MIN_FACETS && semanticQuery.length >= QUERY_MIN_CHARS

  if (!usable) return fallback
  return {
    facets,
    keywords: keywords.length ? keywords : fallback.keywords,
    semanticQuery,
    source: 'llm',
  }
}

function normalizeAssessedItems(
  raw: unknown,
  idField: string,
  knownIds: Set<string>,
  facets: string[]
): FacetAssessedItem[] {
  const facetLookup = new Map(facets.map((facet) => [facet.toLowerCase(), facet]))
  return (Array.isArray(raw) ? raw : [])
    .map((item: any): FacetAssessedItem | null => {
      const id = normalizeText(item?.[idField], 240)
      if (!id || !knownIds.has(id)) return null
      const assessments = (Array.isArray(item?.facetAssessments) ? item.facetAssessments : [])
        .map((cell: any) => {
          const facet = facetLookup.get(normalizeText(cell?.facet, FACET_MAX_CHARS).toLowerCase())
          if (!facet) return null
          const status = String(cell?.status || '').toUpperCase() as FacetStatus
          return { facet, status: VALID_STATUSES.has(status) ? status : 'UNASSESSED' as FacetStatus }
        })
        .filter(Boolean) as Array<{ facet: string; status: FacetStatus }>
      return { id, facetAssessments: assessments }
    })
    .filter((item): item is FacetAssessedItem => Boolean(item))
}

/**
 * Coerce the facet-map response. Items referencing unknown ids are dropped and
 * facet names are matched case-insensitively against the canonical list, so a
 * hallucinated id or a re-worded facet cannot corrupt the coverage read.
 */
export function normalizeFacetMap(raw: unknown, input: {
  projectIds: string[]
  patentIds: string[]
  facets: string[]
}): { awardAssessments: FacetAssessedItem[]; patentAssessments: FacetAssessedItem[]; assessed: boolean } {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!value) return { awardAssessments: [], patentAssessments: [], assessed: false }

  const awardAssessments = normalizeAssessedItems(value.items, 'projectId', new Set(input.projectIds), input.facets)
  const patentAssessments = normalizeAssessedItems(value.patentItems, 'evidenceId', new Set(input.patentIds), input.facets)
  const assessed = awardAssessments.length > 0 || patentAssessments.length > 0
  return { awardAssessments, patentAssessments, assessed }
}

function aggregateStatus(cells: Array<{ facet: string; status: FacetStatus }>, facet: string): FacetStatus {
  const assessed = cells.filter((cell) => cell.facet === facet && cell.status !== 'UNASSESSED')
  if (!assessed.length) return 'UNASSESSED'
  if (assessed.some((cell) => cell.status === 'PRESENT')) return 'PRESENT'
  if (assessed.some((cell) => cell.status === 'PARTIAL')) return 'PARTIAL'
  return 'ABSENT'
}

/**
 * Per-facet funded/patented status with ideaIntelligence's precedence: any
 * PRESENT wins, then PARTIAL, then an actively-assessed ABSENT; UNASSESSED
 * only when no item said anything about the facet.
 */
export function deriveFacetSignals(
  facets: string[],
  awardAssessments: FacetAssessedItem[],
  patentAssessments: FacetAssessedItem[]
): Array<{ facet: string; funded: FacetStatus; patented: FacetStatus }> {
  const awardCells = awardAssessments.flatMap((item) => item.facetAssessments)
  const patentCells = patentAssessments.flatMap((item) => item.facetAssessments)
  return facets.map((facet) => ({
    facet,
    funded: aggregateStatus(awardCells, facet),
    patented: aggregateStatus(patentCells, facet),
  }))
}

export type LandscapeSourceOutcomes = {
  projects: { searched: boolean; count: number; degradedMode: 'full_text_only' | null; error?: string }
  patents: { searched: boolean; status: 'ok' | 'not_configured' | 'error'; count: number; error?: string }
}

/** Decide the top-level status from what actually happened, never from hope. */
export function assembleLandscape(input: {
  priorWork: PriorWork
  distillation: LandscapeDistillation
  assessmentSource: 'llm' | 'fallback'
  sources: LandscapeSourceOutcomes
  now: Date
  notes?: string[]
  error?: string
}): ReviewerLandscape {
  const projectsFailed = Boolean(input.sources.projects.error)
  const patentsFailed = input.sources.patents.status === 'error'
  const hasRows = input.priorWork.rows.length > 0

  let status: ReviewerLandscape['status']
  if (input.error || (projectsFailed && patentsFailed)) status = 'error'
  else if ((projectsFailed || patentsFailed) && hasRows) status = 'partial'
  else if (!hasRows && (projectsFailed || patentsFailed)) status = 'error'
  else if (!hasRows) status = 'empty'
  else status = 'ok'

  return {
    version: 1,
    status,
    generated_at: input.now.toISOString(),
    facets: input.distillation.facets,
    semanticQuery: input.distillation.semanticQuery,
    facetSource: input.distillation.source,
    assessmentSource: input.assessmentSource,
    priorWork: input.priorWork,
    sources: input.sources,
    ...(input.notes?.length ? { notes: input.notes.map((note) => normalizeText(note, 300)).filter(Boolean) } : {}),
    ...(input.error ? { error: normalizeText(input.error, 500) } : {}),
  }
}

// ---------------------------------------------------------------------------
// Reading a stored landscape. Shared by the report pages and the Word export so
// both describe the same run in the same words.

export type LandscapeNotice = {
  tone: 'error' | 'warning' | 'info'
  text: string
}

function sourceFailure(value: string | undefined, fallback: string) {
  const clean = normalizeText(value, 200)
  return clean ? clean.replace(/\.$/, '') : fallback
}

/**
 * What a reader must be told before trusting the list — above all, that an
 * empty list after a failed search is not evidence of an open field. Returns
 * notices in reading order; an empty array means the run was clean.
 */
export function describeLandscapeRun(landscape: Partial<ReviewerLandscape> | null | undefined): LandscapeNotice[] {
  if (!landscape || typeof landscape !== 'object') return []
  const notices: LandscapeNotice[] = []
  const projects = landscape.sources?.projects
  const patents = landscape.sources?.patents
  const rows = landscape.priorWork?.rows?.length ?? 0

  if (landscape.status === 'error') {
    notices.push({
      tone: 'error',
      text: `The prior-work search did not complete for this report${landscape.error ? ` (${sourceFailure(landscape.error, 'unknown error')})` : ''}. `
        + 'An empty list here does not mean the field is open — regenerate the report to search again.',
    })
  }
  if (patents?.status === 'error' && landscape.status !== 'error') {
    notices.push({
      tone: 'warning',
      text: `Indian patent search failed for this run (${sourceFailure(patents.error, 'PatentNest was unavailable')}), so no patents are listed. Regenerate the report to search again.`,
    })
  } else if (patents?.status === 'error') {
    notices.push({ tone: 'warning', text: `Indian patent search: ${sourceFailure(patents.error, 'PatentNest was unavailable')}.` })
  }
  if (patents?.status === 'not_configured') {
    notices.push({ tone: 'info', text: 'Indian patents were not searched — patent search is not configured on this server.' })
  }
  if (projects?.error && landscape.status !== 'error') {
    notices.push({
      tone: 'warning',
      text: `Funded-project search failed for this run (${sourceFailure(projects.error, 'search unavailable')}), so no funded projects are listed.`,
    })
  }
  for (const note of landscape.notes || []) notices.push({ tone: 'info', text: note })
  if (landscape.status === 'empty' && rows === 0) {
    notices.push({
      tone: 'info',
      text: 'Both searches ran and nothing closely comparable was retrieved. Add more technical detail to the sections before treating that as an open field.',
    })
  }
  return notices
}

export type LandscapeSummary = {
  fundedCount: number
  patentCount: number
  /** Proposal aspects at least one retrieved patent already covers. */
  patentedAspects: Array<{ facet: string; numbers: string[]; unfunded: boolean }>
  /** Aspects neither corpus covers (an assessed absence, not a thin search). */
  openAspects: string[]
  /** Aspects attempted by completed awards that reported no output. */
  hardAspects: string[]
  searchFailed: boolean
}

/** Counts and headline readings for the cover, the novelty panel and the ATR. */
export function summarizeLandscape(landscape: Partial<ReviewerLandscape> | null | undefined): LandscapeSummary | null {
  if (!landscape || typeof landscape !== 'object') return null
  const rows = landscape.priorWork?.rows ?? []
  const rowByKey = new Map(rows.map((row) => [row.key, row]))
  const gaps = landscape.priorWork?.gaps ?? []
  const coverage = landscape.priorWork?.coverage ?? []
  return {
    fundedCount: rows.filter((row) => row.kind === 'funded').length,
    patentCount: rows.filter((row) => row.kind === 'patented').length,
    patentedAspects: coverage
      .filter((entry) => entry.patented.rowKeys.length > 0)
      .map((entry) => ({
        facet: entry.facet,
        numbers: entry.patented.rowKeys
          .map((key) => rowByKey.get(key)?.patent?.publicationNumber || rowByKey.get(key)?.title || '')
          .filter(Boolean)
          .slice(0, 3),
        // Patented and not yet funded is the reading that needs a design-around.
        unfunded: entry.funded.rowKeys.length === 0,
      })),
    openAspects: gaps.filter((gap) => gap.reading === 'unexplored').map((gap) => gap.facet),
    hardAspects: gaps.filter((gap) => gap.reading === 'attempted_no_output').map((gap) => gap.facet),
    searchFailed: landscape.status === 'error' || landscape.sources?.patents?.status === 'error' || Boolean(landscape.sources?.projects?.error),
  }
}
