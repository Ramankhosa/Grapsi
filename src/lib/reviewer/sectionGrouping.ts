/**
 * Client-safe section ordering and version grouping for the reviewer workspace.
 *
 * A revision is stored as a new `ReviewerSection` row, so the raw list the API
 * returns holds every draft ever submitted. Navigation, counts and progress all
 * want one entry per section *title*; only the version history wants the rest.
 * `src/lib/reviewer/finalReport.ts` solves the same problem server-side for the
 * report — this is its counterpart for the UI.
 *
 * Kept free of Prisma and server imports so pages can use it directly.
 */

/**
 * Canonical proposal order. This used to be copy-pasted into six files, which
 * had already drifted: the final-review page listed 'Timeline' where the
 * section picker creates 'Project Timeline', so that section scored an
 * `indexOf` of -1 and was sorted to the bottom of the report, after Conclusion.
 */
export const SECTION_ORDER = [
  'Abstract',
  'Introduction',
  'Objectives',
  'Literature Review',
  'Methodology',
  'Project Timeline',
  'Budget Justification',
  'Team Expertise',
  'Expected Outcomes',
  'Societal Impact',
  'Sustainability',
  'Risk & Mitigation',
  'IP & Commercialization',
  'Conclusion',
] as const

export type ReviewerSectionStatus = 'draft' | 'reviewed' | 'stale'

export interface ReviewerSectionLike {
  id: string
  section_title: string
  status?: string | null
  version?: number | null
  ai_review_json?: any
  user_input?: string | null
  last_reviewed_at?: string | Date | null
  previous_section_id?: string | null
  is_revision?: boolean | null
  improvement_flag?: boolean | null
  sourceStale?: boolean | null
  context_summary?: string | null
}

export interface ReviewerSectionGroup<T extends ReviewerSectionLike> {
  title: string
  /** Newest version — what the nav points at and the workspace edits. */
  current: T
  /** Every version of this title, newest first. Includes `current`. */
  history: T[]
  versionCount: number
  status: ReviewerSectionStatus
  score: number | null
  hasReview: boolean
}

/**
 * Position in the canonical order; -1 for a title the order does not name
 * (custom sections, or template sections from a specific funder).
 */
export function sectionOrderIndex(title: string): number {
  return SECTION_ORDER.indexOf(String(title || '').trim() as (typeof SECTION_ORDER)[number])
}

/** Canonical order first, then unknown titles alphabetically at the end. */
export function compareSectionTitles(a: string, b: string): number {
  const aIndex = sectionOrderIndex(a)
  const bIndex = sectionOrderIndex(b)
  if (aIndex === -1 && bIndex === -1) return String(a).localeCompare(String(b))
  if (aIndex === -1) return 1
  if (bIndex === -1) return -1
  return aIndex - bIndex
}

function versionOf(section: ReviewerSectionLike): number {
  return typeof section.version === 'number' && Number.isFinite(section.version) ? section.version : 1
}

function scoreOf(section: ReviewerSectionLike): number | null {
  const raw = section?.ai_review_json?.score
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function hasStoredReview(section: ReviewerSectionLike): boolean {
  const review = section?.ai_review_json
  return Boolean(review && typeof review === 'object' && Object.keys(review).length > 0)
}

/**
 * `stale` means the text was edited after it was reviewed: the stored remarks
 * are still worth showing but no longer describe the current draft.
 */
export function sectionStatus(section: ReviewerSectionLike): ReviewerSectionStatus {
  if (section.sourceStale && hasStoredReview(section)) return 'stale'
  return section.status === 'reviewed' ? 'reviewed' : 'draft'
}

/**
 * One group per section title, in proposal order, each carrying its full
 * version history newest-first.
 */
export function groupReviewerSections<T extends ReviewerSectionLike>(
  sections: T[]
): ReviewerSectionGroup<T>[] {
  const byTitle = new Map<string, T[]>()

  for (const section of Array.isArray(sections) ? sections : []) {
    if (!section?.section_title) continue
    const title = String(section.section_title).trim()
    const bucket = byTitle.get(title)
    if (bucket) bucket.push(section)
    else byTitle.set(title, [section])
  }

  const groups: ReviewerSectionGroup<T>[] = []

  for (const [title, versions] of byTitle) {
    // Newest first. Ties on version fall back to recency so a group is never
    // left picking an arbitrary row as `current`.
    const history = [...versions].sort((a, b) => {
      const byVersion = versionOf(b) - versionOf(a)
      if (byVersion !== 0) return byVersion
      return new Date(b.last_reviewed_at || 0).getTime() - new Date(a.last_reviewed_at || 0).getTime()
    })

    const current = history[0]
    groups.push({
      title,
      current,
      history,
      versionCount: history.length,
      status: sectionStatus(current),
      score: scoreOf(current),
      hasReview: hasStoredReview(current) && current.status === 'reviewed',
    })
  }

  return groups.sort((a, b) => compareSectionTitles(a.title, b.title))
}

export interface ReviewerSectionCounts {
  /** Distinct section titles — the number a user thinks of as "my sections". */
  total: number
  reviewed: number
  draft: number
  stale: number
  /** Total rows including superseded versions. */
  versions: number
}

export function countReviewerSections(sections: ReviewerSectionLike[]): ReviewerSectionCounts {
  const groups = groupReviewerSections(sections)
  return {
    total: groups.length,
    reviewed: groups.filter(g => g.status === 'reviewed').length,
    draft: groups.filter(g => g.status === 'draft').length,
    stale: groups.filter(g => g.status === 'stale').length,
    versions: Array.isArray(sections) ? sections.length : 0,
  }
}

export type ReportFreshness = 'missing' | 'fresh' | 'stale'

/**
 * Whether the stored report still describes the current drafts.
 *
 * Compares against `score_basis.scoredVersions`, which the final-review API
 * records per title, rather than timestamps — it survives clock skew and says
 * exactly which drafts were scored. Reports written before that field existed
 * fall back to comparing review times against `generated_at`.
 */
export function reportFreshness(
  overallReviewJson: any,
  sections: ReviewerSectionLike[]
): ReportFreshness {
  if (!overallReviewJson || typeof overallReviewJson !== 'object') return 'missing'
  if (!Object.keys(overallReviewJson).length) return 'missing'

  const groups = groupReviewerSections(sections).filter(g => g.hasReview)
  if (groups.length === 0) return 'fresh'

  const scoredVersions = overallReviewJson?.score_basis?.scoredVersions
  if (scoredVersions && typeof scoredVersions === 'object') {
    for (const group of groups) {
      const scored = scoredVersions[group.title]
      if (typeof scored !== 'number' || scored !== versionOf(group.current)) return 'stale'
    }
    return 'fresh'
  }

  const generatedAt = overallReviewJson?.generated_at
  if (typeof generatedAt === 'string') {
    const generatedMs = new Date(generatedAt).getTime()
    if (Number.isFinite(generatedMs)) {
      const newestReview = groups.reduce((max, group) => {
        const ms = new Date(group.current.last_reviewed_at || 0).getTime()
        return Number.isFinite(ms) && ms > max ? ms : max
      }, 0)
      return newestReview > generatedMs ? 'stale' : 'fresh'
    }
  }

  return 'fresh'
}
