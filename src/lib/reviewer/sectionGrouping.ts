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

import {
  BUCKET_ORDER,
  normalizeBucketText,
  resolveBucketKey,
  type SectionBucketSource,
} from '@/lib/reviewer/buckets'

/**
 * Proposal order, by bucket rather than by title.
 *
 * This used to be a list of fourteen exact title strings compared with
 * `indexOf`. That only worked if every section was named from that one list —
 * and nothing enforced it. The seeder names sections from `BUCKET_LABELS`, the
 * picker from its own list, and users type whatever they like; none of the
 * seeded labels appeared in the ordering list at all, so every seeded section
 * scored -1 and the whole workspace sorted alphabetically. Budget was reviewed
 * first and the abstract sixth.
 *
 * Ordering now keys off the section's bucket, which all three vocabularies
 * resolve to, so a section sorts by what it *is* rather than by what it is
 * called.
 */
const BUCKET_RANK: Record<string, number> = BUCKET_ORDER.reduce(
  (rank, key, index) => ({ ...rank, [key]: index }),
  {} as Record<string, number>
)

/**
 * Order *within* a bucket, for the buckets that genuinely hold several
 * sections. Unlisted titles sit at 50, so a custom section lands after the
 * conventional ones but before an explicit tail like a conclusion.
 */
const WITHIN_BUCKET_RANK: Record<string, Record<string, number>> = {
  problem_need: {
    introduction: 10,
    background: 15,
    motivation: 20,
    significance: 25,
    novelty: 30,
    innovation: 35,
    literature: 40,
    'state of the art': 45,
  },
  impact_outcomes: {
    'expected outcomes': 10,
    outcomes: 12,
    outputs: 15,
    deliverables: 20,
    impact: 30,
    'societal impact': 32,
    dissemination: 40,
  },
  sustainability_risk: {
    risk: 10,
    mitigation: 15,
    contingency: 20,
    sustainability: 30,
    'exit strategy': 40,
  },
  other: {
    ethics: 10,
    'intellectual property': 20,
    ip: 20,
    commercialization: 25,
    annex: 30,
    appendix: 30,
    conclusion: 90,
  },
}

function withinBucketRank(bucketKey: string, title: string): number {
  const table = WITHIN_BUCKET_RANK[bucketKey]
  if (!table) return 50
  const norm = normalizeBucketText(title)
  if (!norm) return 50
  let best: number | null = null
  let bestLength = 0
  for (const [phrase, rank] of Object.entries(table)) {
    if (norm !== phrase && !norm.includes(phrase)) continue
    if (phrase.length > bestLength) {
      best = rank
      bestLength = phrase.length
    }
  }
  return best ?? 50
}

function titleOf(section: SectionBucketSource | string): string {
  return typeof section === 'string' ? section : String(section?.section_title || '')
}

/**
 * Proposal order: bucket first, then position within the bucket, then title.
 *
 * `ReviewerSection` has no `created_at`, and `last_reviewed_at` defaults to
 * `now()` on insert, so neither is a meaningful tiebreak for unreviewed rows —
 * the title is the only stable one available.
 */
export function compareSections(
  a: SectionBucketSource | string,
  b: SectionBucketSource | string
): number {
  const aBucket = resolveBucketKey(a)
  const bBucket = resolveBucketKey(b)
  const byBucket = (BUCKET_RANK[aBucket] ?? BUCKET_ORDER.length) - (BUCKET_RANK[bBucket] ?? BUCKET_ORDER.length)
  if (byBucket !== 0) return byBucket

  const aTitle = titleOf(a)
  const bTitle = titleOf(b)
  const byWithin = withinBucketRank(aBucket, aTitle) - withinBucketRank(bBucket, bTitle)
  if (byWithin !== 0) return byWithin

  return String(aTitle).localeCompare(String(bTitle))
}

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
  /** Semantic identity. Nullable — `resolveBucketKey` falls back to the title. */
  reviewerBucketKey?: string | null
  mappingJson?: unknown
}

export interface ReviewerSectionGroup<T extends ReviewerSectionLike> {
  title: string
  /** What kind of section this is — what ordering and rule scoping key off. */
  bucketKey: string
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
 * Proposal order for bare titles, where no stored bucket key is available.
 * Resolves the bucket from the title, so it agrees with `compareSections`.
 */
export function compareSectionTitles(a: string, b: string): number {
  return compareSections(a, b)
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
      bucketKey: resolveBucketKey(current),
      current,
      history,
      versionCount: history.length,
      status: sectionStatus(current),
      score: scoreOf(current),
      hasReview: hasStoredReview(current) && current.status === 'reviewed',
    })
  }

  // Compare the rows, not the titles, so a stored bucket key wins over a title
  // that was renamed away from it.
  return groups.sort((a, b) => compareSections(a.current, b.current))
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
function isReviewedRow(section: ReviewerSectionLike): boolean {
  return section?.status === 'reviewed' && hasStoredReview(section)
}

/**
 * The version the report generator would score for this title right now:
 * the pinned version when the picker named one that is still reviewed,
 * otherwise the newest reviewed version. Mirrors `resolveSectionVersions`,
 * so the badge on the page and the server's regenerate decision agree.
 */
export function expectedScoredVersion(
  group: ReviewerSectionGroup<ReviewerSectionLike>,
  pinnedVersions?: Record<string, unknown> | null
): number | null {
  const pinned = pinnedVersions ? Number(pinnedVersions[group.title]) : Number.NaN
  if (Number.isFinite(pinned)) {
    const pinnedRow = group.history.find(section => versionOf(section) === pinned)
    if (pinnedRow && isReviewedRow(pinnedRow)) return pinned
  }
  const newestReviewed = group.history.find(isReviewedRow)
  return newestReviewed ? versionOf(newestReviewed) : null
}

export function reportFreshness(
  overallReviewJson: any,
  sections: ReviewerSectionLike[]
): ReportFreshness {
  if (!overallReviewJson || typeof overallReviewJson !== 'object') return 'missing'
  if (!Object.keys(overallReviewJson).length) return 'missing'

  const scoreBasis = overallReviewJson?.score_basis && typeof overallReviewJson.score_basis === 'object'
    ? overallReviewJson.score_basis
    : null
  const excluded = new Set(
    (Array.isArray(scoreBasis?.excludedTitles) ? scoreBasis.excludedTitles : [])
      .map((title: unknown) => String(title).trim().toLowerCase())
  )
  const allGroups = groupReviewerSections(sections)
  // A title counts once any of its versions carries a review — a group whose
  // newest row is an unreviewed draft still has a reviewed draft the report
  // describes, so it is judged on that draft rather than skipped.
  const groups = allGroups.filter(
    g => !excluded.has(g.title.toLowerCase()) && g.history.some(isReviewedRow)
  )
  // A report over sections that have since all been reset to draft no longer
  // describes anything reviewed; it must not read as current.
  if (groups.length === 0) return allGroups.length === 0 ? 'fresh' : 'stale'

  const scoredVersions = scoreBasis?.scoredVersions
  if (scoredVersions && typeof scoredVersions === 'object') {
    const pins = scoreBasis?.pinnedVersions && typeof scoreBasis.pinnedVersions === 'object'
      ? scoreBasis.pinnedVersions
      : null
    for (const group of groups) {
      const scored = scoredVersions[group.title]
      if (typeof scored !== 'number' || scored !== expectedScoredVersion(group, pins)) return 'stale'
    }
    return 'fresh'
  }

  const generatedAt = overallReviewJson?.generated_at
  if (typeof generatedAt === 'string') {
    const generatedMs = new Date(generatedAt).getTime()
    if (Number.isFinite(generatedMs)) {
      const newestReview = groups.reduce((max, group) => {
        const reviewed = group.history.find(isReviewedRow) || group.current
        const ms = new Date(reviewed.last_reviewed_at || 0).getTime()
        return Number.isFinite(ms) && ms > max ? ms : max
      }, 0)
      return newestReview > generatedMs ? 'stale' : 'fresh'
    }
  }

  return 'fresh'
}
