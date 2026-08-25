import type { ReviewerCallContext, ReviewerTemplateSectionRule } from '@/lib/reviewer/callContext'
import { normalizeStringArray } from '@/lib/reviewer/content'

export interface ReviewerSectionInput {
  title: string
  version: number
  content: string
  contextSummary?: string | null
  review: Record<string, any> | null
  bucketKey?: string | null
}

export interface ReviewerLimitCheck {
  section: string
  rule: string
  limit: number
  unit: 'words' | 'characters'
  actual: number
  overBy: number
  status: 'within' | 'over' | 'near'
}

export interface ReviewerComplianceReport {
  requiredSections: {
    covered: string[]
    missing: string[]
    unmatched: string[]
    coveragePercent: number
  }
  limits: ReviewerLimitCheck[]
  deadline: { date: string | null; daysRemaining: number | null; status: 'open' | 'closing' | 'passed' | 'unknown' }
  reviewedSectionCount: number
  totalSectionCount: number
  emptySectionTitles: string[]
}

export interface ReviewerCriterionRollup {
  criterion: string
  weight: number | null
  score: number | null
  sectionCount: number
  evidenceSections: string[]
}

export interface ReviewerDeterministicSummary {
  compliance: ReviewerComplianceReport
  criterionRollup: ReviewerCriterionRollup[]
  sectionScores: Array<{ title: string; score: number | null; version: number }>
  meanSectionScore: number | null
  weightedScore: number | null
  complianceFlagCounts: Record<string, number>
  openHighPriorityActions: Array<{ section: string; issue: string; recommendation: string }>
}

const WORD_PATTERN = /\S+/g

export function countWords(text: string): number {
  return (String(text || '').match(WORD_PATTERN) || []).length
}

export interface ReviewerVersionedSection {
  id: string
  section_title: string
  version?: number | null
  [key: string]: unknown
}

export interface ReviewerVersionResolution<T extends ReviewerVersionedSection> {
  /** One section per title — what the report is actually about. */
  effective: T[]
  /** Older versions that the report must ignore. */
  superseded: T[]
  /** Version chosen per title, so the report can state what it scored. */
  chosenVersions: Record<string, number>
  /**
   * Titles whose newest row is an unreviewed draft newer than the version
   * chosen — the report describes the older reviewed draft and should say so.
   */
  pendingDrafts: Record<string, number>
  /** Titles the caller asked to leave out of the report entirely. */
  excludedTitles: string[]
}

/**
 * Coerce a client-supplied selection map to `{ title: version }`.
 *
 * The report page's compare mode used to post keys shaped `"Title|2"`, which
 * no server code ever matched — selections made there were silently ignored.
 * Both shapes are accepted; when several versions of a title are named, the
 * newest wins, because a report scores one draft per section.
 */
export function normalizeVersionSelections(raw: unknown): Record<string, number> {
  const selections: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return selections
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const version = Number(value)
    if (!Number.isFinite(version) || version < 1) continue
    const title = String(key).includes('|') ? String(key).slice(0, String(key).lastIndexOf('|')).trim() : String(key).trim()
    if (!title) continue
    selections[title] = Math.max(selections[title] ?? 0, version)
  }
  return selections
}

function isReviewedRow(section: ReviewerVersionedSection): boolean {
  return (section as { status?: unknown }).status === 'reviewed'
}

/**
 * Reduce a section list to one version per title.
 *
 * A revised section is stored as a new row, so the raw list contains every
 * draft the user ever submitted. Reporting over all of them double-counts the
 * section, averages a superseded score into the total, and feeds the model
 * stale weaknesses the revision already fixed.
 *
 * The newest *reviewed* version wins unless the caller pins a specific one
 * (the report page's version picker). Picking the newest row regardless of
 * status used to evict a section from the report the moment the user saved
 * an unreviewed revision — v1's full review vanished until v2 was reviewed.
 * A title with no reviewed version at all still resolves to its newest draft
 * so coverage and compliance can count it.
 */
export function resolveSectionVersions<T extends ReviewerVersionedSection>(
  sections: T[],
  versionSelections?: Record<string, unknown> | null,
  options?: { excludedTitles?: string[] | null }
): ReviewerVersionResolution<T> {
  const byTitle = new Map<string, T[]>()
  for (const section of sections) {
    const title = String(section.section_title || '').trim()
    if (!title) continue
    const bucket = byTitle.get(title) || []
    bucket.push(section)
    byTitle.set(title, bucket)
  }

  const pins = normalizeVersionSelections(versionSelections)
  const excluded = new Set((options?.excludedTitles || []).map((title) => String(title).trim().toLowerCase()).filter(Boolean))

  const effective: T[] = []
  const superseded: T[] = []
  const chosenVersions: Record<string, number> = {}
  const pendingDrafts: Record<string, number> = {}
  const excludedTitles: string[] = []

  for (const [title, candidates] of byTitle.entries()) {
    const ordered = [...candidates].sort((left, right) => Number(right.version || 1) - Number(left.version || 1))

    if (excluded.has(title.toLowerCase())) {
      excludedTitles.push(title)
      superseded.push(...ordered)
      continue
    }

    const requested = pins[title]
    const pinned = Number.isFinite(requested)
      ? ordered.find((section) => Number(section.version || 1) === requested)
      : undefined
    const newestReviewed = ordered.find(isReviewedRow)
    const picked = pinned || newestReviewed || ordered[0]

    if (!pinned && newestReviewed && ordered[0].id !== newestReviewed.id) {
      pendingDrafts[title] = Number(ordered[0].version || 1)
    }

    chosenVersions[title] = Number(picked.version || 1)
    effective.push(picked)
    superseded.push(...ordered.filter((section) => section.id !== picked.id))
  }

  return { effective, superseded, chosenVersions, pendingDrafts, excludedTitles }
}

function normalizeTitle(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function titlesOverlap(left: string, right: string): boolean {
  const a = normalizeTitle(left)
  const b = normalizeTitle(right)
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true

  const aTokens = new Set(a.split(' ').filter((token) => token.length > 3))
  const bTokens = b.split(' ').filter((token) => token.length > 3)
  return bTokens.some((token) => aTokens.has(token))
}

function checkLimits(
  sections: ReviewerSectionInput[],
  rules: ReviewerTemplateSectionRule[]
): ReviewerLimitCheck[] {
  const checks: ReviewerLimitCheck[] = []

  for (const rule of rules) {
    if (!rule.wordLimit && !rule.charLimit) continue
    const match = sections.find(
      (section) => titlesOverlap(section.title, rule.label) || (rule.bucketKey && section.bucketKey === rule.bucketKey)
    )
    if (!match || !match.content?.trim()) continue

    if (rule.wordLimit) {
      const actual = countWords(match.content)
      checks.push({
        section: match.title,
        rule: rule.label,
        limit: rule.wordLimit,
        unit: 'words',
        actual,
        overBy: Math.max(0, actual - rule.wordLimit),
        status: actual > rule.wordLimit ? 'over' : actual > rule.wordLimit * 0.9 ? 'near' : 'within',
      })
    }

    if (rule.charLimit) {
      const actual = match.content.length
      checks.push({
        section: match.title,
        rule: rule.label,
        limit: rule.charLimit,
        unit: 'characters',
        actual,
        overBy: Math.max(0, actual - rule.charLimit),
        status: actual > rule.charLimit ? 'over' : actual > rule.charLimit * 0.9 ? 'near' : 'within',
      })
    }
  }

  return checks
}

function deadlineStatus(deadline: string | null): ReviewerComplianceReport['deadline'] {
  if (!deadline) return { date: null, daysRemaining: null, status: 'unknown' }
  const parsed = new Date(deadline)
  if (Number.isNaN(parsed.getTime())) return { date: deadline, daysRemaining: null, status: 'unknown' }

  const daysRemaining = Math.ceil((parsed.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return {
    date: parsed.toISOString(),
    daysRemaining,
    status: daysRemaining < 0 ? 'passed' : daysRemaining <= 14 ? 'closing' : 'open',
  }
}

/**
 * Everything about the final report that can be established by counting rather
 * than by asking a model: which required sections exist, which limits are
 * blown, how the criterion scores roll up, and where the deadline sits.
 *
 * Computing these here rather than in the prompt makes them exact (a word count
 * is a word count) and keeps them out of the token budget entirely.
 */
export function buildDeterministicSummary(
  sections: ReviewerSectionInput[],
  context: Partial<ReviewerCallContext> | null
): ReviewerDeterministicSummary {
  const mandatory = normalizeStringArray(context?.mandatory_sections)
  const rules = Array.isArray(context?.template_sections) ? context!.template_sections! : []

  const covered: string[] = []
  const missing: string[] = []
  for (const required of mandatory) {
    const match = sections.find(
      (section) => titlesOverlap(section.title, required) && Boolean(section.content?.trim())
    )
    if (match) covered.push(required)
    else missing.push(required)
  }

  const unmatched = sections
    .filter((section) => section.content?.trim() && !mandatory.some((required) => titlesOverlap(section.title, required)))
    .map((section) => section.title)

  // Roll criterion scores up across sections. A criterion assessed by several
  // sections gets the mean of those assessments.
  const rollupBuckets = new Map<string, { label: string; scores: number[]; sections: string[] }>()
  for (const section of sections) {
    const criterionScores = Array.isArray(section.review?.criterion_scores) ? section.review!.criterion_scores : []
    for (const entry of criterionScores) {
      const label = String(entry?.criterion || '').trim()
      const score = typeof entry?.score === 'number' ? entry.score : Number.parseFloat(String(entry?.score ?? ''))
      if (!label || !Number.isFinite(score)) continue
      const key = normalizeTitle(label)
      const bucket = rollupBuckets.get(key) || { label, scores: [], sections: [] }
      bucket.scores.push(score)
      if (!bucket.sections.includes(section.title)) bucket.sections.push(section.title)
      rollupBuckets.set(key, bucket)
    }
  }

  const declaredCriteria = Array.isArray(context?.scoring_criteria) ? context!.scoring_criteria! : []
  const criterionRollup: ReviewerCriterionRollup[] = declaredCriteria.map((criterion) => {
    const bucket = rollupBuckets.get(normalizeTitle(criterion.label))
    return {
      criterion: criterion.label,
      weight: criterion.weight ?? null,
      score: bucket ? bucket.scores.reduce((total, value) => total + value, 0) / bucket.scores.length : null,
      sectionCount: bucket?.scores.length || 0,
      evidenceSections: bucket?.sections || [],
    }
  })

  // Criteria the reviewer surfaced that the call never declared still belong in
  // the scorecard — they are usually agency language the extractor missed.
  for (const [key, bucket] of rollupBuckets.entries()) {
    if (declaredCriteria.some((criterion) => normalizeTitle(criterion.label) === key)) continue
    criterionRollup.push({
      criterion: bucket.label,
      weight: null,
      score: bucket.scores.reduce((total, value) => total + value, 0) / bucket.scores.length,
      sectionCount: bucket.scores.length,
      evidenceSections: bucket.sections,
    })
  }

  const sectionScores = sections.map((section) => ({
    title: section.title,
    version: section.version,
    score: typeof section.review?.score === 'number' ? section.review.score : null,
  }))

  const scored = sectionScores.map((entry) => entry.score).filter((score): score is number => score !== null)
  const meanSectionScore = scored.length > 0 ? scored.reduce((total, value) => total + value, 0) / scored.length : null

  const weighted = criterionRollup.filter((entry) => entry.score !== null && (entry.weight ?? 0) > 0)
  const weightTotal = weighted.reduce((total, entry) => total + (entry.weight || 0), 0)
  const weightedScore =
    weightTotal > 0
      ? weighted.reduce((total, entry) => total + (entry.score || 0) * (entry.weight || 0), 0) / weightTotal
      : null

  const complianceFlagCounts: Record<string, number> = { met: 0, partial: 0, missing: 0, unverifiable: 0 }
  for (const section of sections) {
    for (const flag of Array.isArray(section.review?.compliance_flags) ? section.review!.compliance_flags : []) {
      const status = String(flag?.status || 'unverifiable')
      complianceFlagCounts[status] = (complianceFlagCounts[status] || 0) + 1
    }
  }

  const openHighPriorityActions: ReviewerDeterministicSummary['openHighPriorityActions'] = []
  for (const section of sections) {
    for (const item of Array.isArray(section.review?.section_recommendations)
      ? section.review!.section_recommendations
      : []) {
      if (String(item?.priority || '').toLowerCase() !== 'high') continue
      openHighPriorityActions.push({
        section: section.title,
        issue: String(item?.issue || '').trim(),
        recommendation: String(item?.recommendation || '').trim(),
      })
    }
  }

  return {
    compliance: {
      requiredSections: {
        covered,
        missing,
        unmatched,
        coveragePercent: mandatory.length > 0 ? Math.round((covered.length / mandatory.length) * 100) : 100,
      },
      limits: checkLimits(sections, rules),
      deadline: deadlineStatus(context?.submission_deadline || null),
      reviewedSectionCount: sections.filter((section) => section.review?.score !== undefined).length,
      totalSectionCount: sections.length,
      emptySectionTitles: sections.filter((section) => !section.content?.trim()).map((section) => section.title),
    },
    criterionRollup,
    sectionScores,
    meanSectionScore,
    weightedScore,
    complianceFlagCounts,
    openHighPriorityActions: openHighPriorityActions.slice(0, 20),
  }
}

/**
 * A compact, model-readable rendering of the deterministic findings. Costs a
 * few hundred tokens and spares the model from re-deriving facts it would get
 * wrong (counting words, matching section names, doing weighted arithmetic).
 */
export function renderDeterministicBriefing(summary: ReviewerDeterministicSummary): string {
  const { compliance } = summary
  const lines: string[] = []

  lines.push('### VERIFIED FACTS (computed, not estimated — treat as ground truth)')
  lines.push(
    `Section coverage: ${compliance.requiredSections.covered.length}/${
      compliance.requiredSections.covered.length + compliance.requiredSections.missing.length
    } required sections drafted (${compliance.requiredSections.coveragePercent}%).`
  )
  if (compliance.requiredSections.missing.length > 0) {
    lines.push(`Missing required sections: ${compliance.requiredSections.missing.join('; ')}`)
  }
  if (compliance.emptySectionTitles.length > 0) {
    lines.push(`Sections present but empty: ${compliance.emptySectionTitles.join('; ')}`)
  }

  const breaches = compliance.limits.filter((check) => check.status !== 'within')
  if (breaches.length > 0) {
    lines.push(
      `Length limits: ${breaches
        .map(
          (check) =>
            `${check.section} is ${check.actual} ${check.unit} against a ${check.limit} ${check.unit} limit${
              check.overBy > 0 ? ` (over by ${check.overBy})` : ' (close to the cap)'
            }`
        )
        .join('; ')}`
    )
  } else if (compliance.limits.length > 0) {
    lines.push(`Length limits: all ${compliance.limits.length} checked sections are within their stated caps.`)
  }

  if (compliance.deadline.status !== 'unknown') {
    lines.push(
      `Deadline: ${compliance.deadline.date?.slice(0, 10)} (${
        compliance.deadline.status === 'passed'
          ? 'already passed'
          : `${compliance.deadline.daysRemaining} days remaining`
      }).`
    )
  }

  if (summary.sectionScores.length > 0) {
    lines.push(
      `Section scores: ${summary.sectionScores
        .map((entry) => `${entry.title} ${entry.score !== null ? entry.score.toFixed(1) : 'not reviewed'}`)
        .join('; ')}`
    )
  }
  if (summary.meanSectionScore !== null) {
    lines.push(`Unweighted mean section score: ${summary.meanSectionScore.toFixed(2)}.`)
  }
  if (summary.weightedScore !== null) {
    lines.push(
      `Criterion-weighted score using the call's published weights: ${summary.weightedScore.toFixed(2)}. Use this as the anchor for overall_score unless you can justify departing from it.`
    )
  }

  const scoredCriteria = summary.criterionRollup.filter((entry) => entry.score !== null)
  if (scoredCriteria.length > 0) {
    lines.push(
      `Criterion rollup: ${scoredCriteria
        .map(
          (entry) =>
            `${entry.criterion}${entry.weight !== null ? ` [w=${entry.weight}]` : ''} = ${entry.score!.toFixed(1)} (from ${entry.evidenceSections.join(', ')})`
        )
        .join('; ')}`
    )
  }
  const unscoredCriteria = summary.criterionRollup.filter((entry) => entry.score === null)
  if (unscoredCriteria.length > 0) {
    lines.push(
      `Criteria no section evidenced: ${unscoredCriteria.map((entry) => entry.criterion).join('; ')}. Treat these as unevidenced, not as failures.`
    )
  }

  if (summary.openHighPriorityActions.length > 0) {
    lines.push(
      `High-priority issues already raised at section level: ${summary.openHighPriorityActions
        .map((action) => `${action.section}: ${action.issue}`)
        .join('; ')}`
    )
  }

  return lines.join('\n')
}
