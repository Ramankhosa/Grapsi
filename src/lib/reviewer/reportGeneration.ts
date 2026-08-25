import crypto from 'crypto'

import prisma from '@/lib/prisma'
import { hasMeaningfulSectionContent } from '@/lib/reviewer/content'
import {
  buildDeterministicSummary,
  renderDeterministicBriefing,
  resolveSectionVersions,
} from '@/lib/reviewer/finalReport'
import { normalizeVersionSelections } from '@/lib/reviewer/finalReport'
import { buildReviewerLandscape, buildSectionDigests } from '@/lib/reviewer/landscape'
import { assessNovelty } from '@/lib/reviewer/novelty'
import { reportFreshness, type ReportFreshness } from '@/lib/reviewer/sectionGrouping'
import {
  completeReviewerUsage,
  releaseReviewerUsage,
  reserveReviewerUsage,
  resolveReviewerCallOwner,
  reviewerReportOperationId,
  ServiceQuotaExceededError,
} from '@/lib/reviewer/usage'
import { ReviewerService } from '../../../lib/services/reviewerService'

/**
 * Server-side generation of the panel report (the source of the ATR).
 *
 * This used to live inline in the `final-review` API handler, which meant it
 * could only be produced by a user clicking a button on a page. Every other
 * caller that needs a current report — the ATR export, the automatic refresh
 * after a revision is reviewed — had no way to reach it, so the report drifted
 * out of date and nothing in the system could correct it. Lifting it here gives
 * all three callers one implementation and one definition of "current".
 */

export class ReviewerReportError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'ReviewerReportError'
    this.code = code
    this.status = status
  }
}

/**
 * A section is scorable when it was reviewed, actually has text, and is not
 * mapped exclusively to content the applicant supplies outside the app.
 */
export function isScorableReviewedSection(section: any): boolean {
  if (section?.status !== 'reviewed' || !hasMeaningfulSectionContent(section?.user_input)) return false
  const mappingJson = section.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {}
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : []
  const linksDeclareWorkflow = linkedSections.some((link: any) => typeof link?.workflowMode === 'string')
  return !linksDeclareWorkflow || linkedSections.some((link: any) => String(link?.workflowMode || '') === 'app_draft')
}

export interface ReviewerReportStatus {
  freshness: ReportFreshness
  /** Titles whose current draft is newer than the version the report scored. */
  outdatedSections: string[]
  reviewedSectionCount: number
  /** The picker's pins recorded with the stored report, honoured on regeneration. */
  pinnedVersions: Record<string, number>
  /** Titles the stored report deliberately left out, honoured on regeneration. */
  excludedTitles: string[]
}

/**
 * Whether the stored report still describes the current drafts, and which
 * sections moved on. Shares `reportFreshness` with the UI so the badge on the
 * page and the server's decision to regenerate can never disagree.
 */
export async function getReportStatus(callId: string): Promise<ReviewerReportStatus> {
  const [call, sections] = await Promise.all([
    prisma.reviewerCall.findUnique({ where: { id: callId }, select: { overall_review_json: true } }),
    prisma.reviewerSection.findMany({ where: { call_id: callId } }),
  ])

  const freshness = reportFreshness(call?.overall_review_json, sections as any)
  const scoreBasis = (call?.overall_review_json as any)?.score_basis
  const scoredVersions = scoreBasis?.scoredVersions
  const pinnedVersions = normalizeVersionSelections(scoreBasis?.pinnedVersions)
  const excludedTitles: string[] = Array.isArray(scoreBasis?.excludedTitles)
    ? scoreBasis.excludedTitles.map((title: unknown) => String(title || '').trim()).filter(Boolean)
    : []
  const outdatedSections: string[] = []

  if (freshness === 'stale' && scoredVersions && typeof scoredVersions === 'object') {
    const { effective } = resolveSectionVersions(sections as any, pinnedVersions, { excludedTitles })
    for (const section of effective) {
      const scored = scoredVersions[section.section_title]
      if (typeof scored !== 'number' || scored !== Number(section.version || 1)) {
        outdatedSections.push(section.section_title)
      }
    }
  }

  return {
    freshness,
    outdatedSections,
    reviewedSectionCount: (sections as any[]).filter(isScorableReviewedSection).length,
    pinnedVersions,
    excludedTitles,
  }
}

// ---------------------------------------------------------------------------
// Landscape & novelty reuse
//
// Both depend only on the section digests and the call context — never on
// review scores — so regenerating the report after a re-review of unchanged
// text can reuse them instead of paying for a distill call, a facet-map call,
// a novelty call, and two searches.
// ---------------------------------------------------------------------------

const REVIEWER_LANDSCAPE_REUSE_MAX_AGE_DAYS =
  Number(process.env.REVIEWER_LANDSCAPE_REUSE_MAX_AGE_DAYS) || 7

export function reviewerLandscapeReuseEnabled(): boolean {
  return String(process.env.REVIEWER_LANDSCAPE_REUSE || '').toLowerCase() !== 'false'
}

/**
 * Stable fingerprint of everything the landscape and novelty steps read.
 * `callDescription` is normalized the same way the landscape itself clips it,
 * so cosmetic whitespace changes do not invalidate the cache.
 */
export function landscapeNoveltyInputHash(input: {
  projectTitle: string
  callDescription: string
  digests: Array<{ title: string; text: string }>
}): string {
  const normalizedDescription = String(input.callDescription || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
  const payload = JSON.stringify({
    title: String(input.projectTitle || ''),
    description: normalizedDescription,
    digests: input.digests.map((digest) => [digest.title, digest.text]),
  })
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

/**
 * Whether the previous report's landscape can stand in for a fresh build:
 * same inputs, not an errored build, recent enough that the search corpus has
 * not moved on, and reuse not disabled by the kill switch.
 */
export function shouldReuseLandscape(prevReport: any, hash: string, now: Date): boolean {
  if (!reviewerLandscapeReuseEnabled()) return false
  const landscape = prevReport?.landscape
  if (!landscape || typeof landscape !== 'object') return false
  if (landscape.input_hash !== hash) return false
  if (landscape.status === 'error') return false

  const generatedAt = Date.parse(String(prevReport?.generated_at || ''))
  if (!Number.isFinite(generatedAt)) return false
  const ageMs = now.getTime() - generatedAt
  return ageMs >= 0 && ageMs <= REVIEWER_LANDSCAPE_REUSE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
}

export interface GenerateReviewerReportResult {
  /** The payload written to `reviewer_calls.overall_review_json`. */
  report: Record<string, any>
  scoredVersions: Record<string, number>
  supersededVersionCount: number
  reviewedSectionCount: number
  /** Every section row, so callers can return the version picker's options. */
  allSections: any[]
}

/**
 * Build and persist the panel report for a reviewer workspace.
 *
 * Throws `ReviewerReportError` for conditions the caller should surface rather
 * than log: nothing reviewed yet, or the model returning something unusable.
 */
export async function generateReviewerReport(input: {
  callId: string
  versionSelections?: Record<string, unknown> | null
  /** Section titles to leave out of the report entirely (the picker's unchecked rows). */
  excludedTitles?: string[] | null
}): Promise<GenerateReviewerReportResult> {
  const call = await prisma.reviewerCall.findUnique({
    where: { id: input.callId },
    select: {
      id: true,
      project_title: true,
      parsed_json: true,
      LLM_model_used: true,
      overall_review_json: true,
    },
  })

  if (!call) {
    throw new ReviewerReportError('Reviewer workspace not found', 'CALL_NOT_FOUND', 404)
  }

  const allSections = await prisma.reviewerSection.findMany({ where: { call_id: input.callId } })

  // A revision is stored as a new row, so the raw list holds every draft ever
  // submitted. Report on one version per section — the newest, or whichever the
  // report page's version picker asked for — otherwise the same section is
  // scored twice and superseded weaknesses resurface.
  const { effective: sections, superseded, chosenVersions, pendingDrafts, excludedTitles } = resolveSectionVersions(
    allSections as any,
    input.versionSelections || null,
    { excludedTitles: input.excludedTitles || null }
  )

  const reviewedSections = sections.filter(isScorableReviewedSection)

  if (reviewedSections.length === 0) {
    throw new ReviewerReportError(
      superseded.length > 0
        ? 'The current version of every section is still awaiting review. Review the latest revisions before generating a final review.'
        : 'No reviewed sections found for this call. Please review at least one section before generating a final review.',
      'NO_REVIEWED_SECTIONS',
      400
    )
  }

  const sectionSummaries = reviewedSections.map((section: any) => ({
    title: section.section_title,
    version: section.version || 0,
    content: section.user_input || '',
    context_summary: section.context_summary || '',
    review_json: (section.ai_review_json as any) || {
      score: 0,
      summary: 'No review available',
      strengths: [],
      weaknesses: [],
      recommendations: [],
    },
  }))

  const modelType = call.LLM_model_used === 'OPENAI' ? 'O' : 'G'
  const parsedContext = call.parsed_json && typeof call.parsed_json === 'object' ? (call.parsed_json as any) : null
  const description = parsedContext
    ? parsedContext.reviewer_context_text || parsedContext.description || parsedContext.call_summary || ''
    : ''

  // Compliance, coverage, limit breaches, and the weighted score are counted
  // here rather than asked for. Every *authored* section counts toward
  // coverage, not only the reviewed ones, so a drafted-but-unreviewed section
  // is not reported as missing.
  const deterministic = buildDeterministicSummary(
    sections.map((section: any) => ({
      title: section.section_title,
      version: section.version || 0,
      content: section.user_input || '',
      contextSummary: section.context_summary || '',
      review: (section.ai_review_json as any) || null,
      bucketKey: section.reviewerBucketKey || null,
    })),
    parsedContext
  )
  const anchorScore = deterministic.weightedScore ?? deterministic.meanSectionScore ?? null

  // Reference-only prior-work landscape (similar funded projects + Indian
  // patents), started here so it runs alongside the panel model. It is awaited
  // only after the panel review returns and is never passed to it, so it
  // cannot influence the score. Pre-caught: a panel failure below must not
  // leave an unhandled rejection behind.
  //
  // When the digests and call context are unchanged since the stored report,
  // the previous landscape (and novelty verdict) are reused outright — they
  // read section content, never scores, so a re-review of unchanged text
  // cannot change them.
  const digestSections = reviewedSections.map((section: any) => ({
    title: section.section_title,
    contextSummary: section.context_summary || null,
    userInput: section.user_input || '',
  }))
  const prevReport = call.overall_review_json && typeof call.overall_review_json === 'object'
    ? (call.overall_review_json as any)
    : null
  const landscapeInputHash = landscapeNoveltyInputHash({
    projectTitle: call.project_title || '',
    callDescription: description,
    digests: buildSectionDigests(digestSections),
  })
  const reuseLandscape = shouldReuseLandscape(prevReport, landscapeInputHash, new Date())
  if (reuseLandscape) {
    console.log('[Reviewer] Landscape inputs unchanged — reusing the stored landscape and novelty assessment')
  }
  const landscapePromise = reuseLandscape
    ? Promise.resolve(prevReport.landscape)
    : buildReviewerLandscape({
        callId: input.callId,
        projectTitle: call.project_title || '',
        parsedContext,
        modelType: modelType as 'O' | 'G',
        sections: digestSections,
      }).catch((error) => {
        console.error('[Reviewer] Landscape build rejected unexpectedly:', error)
        return null
      })

  // Hold the quota slot before the panel model runs; a failed report releases
  // it again so the tenant is only charged for reports it actually received.
  let reportUsage
  try {
    reportUsage = await reserveReviewerUsage({
      callId: input.callId,
      operationId: reviewerReportOperationId(input.callId),
      operationType: 'reviewer_final_report',
      metadata: { projectTitle: call.project_title },
    })
  } catch (error) {
    if (error instanceof ServiceQuotaExceededError) {
      throw new ReviewerReportError(error.message, error.code, 429)
    }
    throw error
  }

  const reviewerService = new ReviewerService()
  const owner = await resolveReviewerCallOwner(input.callId)
  let overallReview
  try {
    overallReview = await reviewerService.generateOverallReview(
      call.project_title,
      description,
      sectionSummaries,
      modelType as 'O' | 'G',
      {
        deterministicBriefing: renderDeterministicBriefing(deterministic),
        anchorScore,
        owner,
      }
    )
  } catch (error) {
    await releaseReviewerUsage(reportUsage).catch(() => undefined)
    throw error
  }

  const landscape = await landscapePromise

  // Novelty & positioning: evidence-bounded verdict over the landscape. Runs
  // after the panel report, never feeds it, and is reference-only for the PI.
  // Reused together with the landscape when inputs are unchanged — unless the
  // stored verdict is the `unassessed` failure fallback, in which case one
  // fresh attempt against the (reused) landscape is worth its single call.
  const reusableNovelty = reuseLandscape
    && prevReport?.novelty_assessment
    && typeof prevReport.novelty_assessment === 'object'
    && prevReport.novelty_assessment.verdict !== 'unassessed'
      ? prevReport.novelty_assessment
      : null
  const noveltyAssessment = reusableNovelty
    ? reusableNovelty
    : landscape
      ? await assessNovelty({
          callId: input.callId,
          projectTitle: call.project_title || '',
          parsedContext,
          modelType: modelType as 'O' | 'G',
          sections: digestSections,
          landscape,
        }).catch((error) => {
          console.error('[Reviewer] Novelty assessment rejected unexpectedly:', error)
          return null
        })
      : null

  const report = {
    ...overallReview,
    compliance: deterministic.compliance,
    // input_hash records what the landscape was built from, so the next
    // regeneration can prove the inputs unchanged and reuse it.
    ...(landscape ? { landscape: { ...landscape, input_hash: landscapeInputHash } } : {}),
    ...(noveltyAssessment ? { novelty_assessment: noveltyAssessment } : {}),
    score_basis: {
      weightedScore: deterministic.weightedScore,
      meanSectionScore: deterministic.meanSectionScore,
      anchorScore,
      criterionRollup: deterministic.criterionRollup,
      sectionScores: deterministic.sectionScores,
      complianceFlagCounts: deterministic.complianceFlagCounts,
      // Records exactly which draft each score came from, so a reader can tell
      // a v3 report from a v1 one — and so freshness is decided by version
      // rather than by clock comparison.
      scoredVersions: chosenVersions,
      supersededVersionCount: superseded.length,
      // What the picker asked for, kept apart from what was scored, so an
      // automatic regeneration can honour the same pins and exclusions instead
      // of silently reverting to the newest versions.
      pinnedVersions: normalizeVersionSelections(input.versionSelections),
      excludedTitles,
      // Titles where a newer unreviewed draft exists — the report describes
      // the older reviewed draft, and the page says so.
      pendingDrafts,
    },
    generated_at: new Date().toISOString(),
  }

  try {
    await prisma.reviewerCall.update({
      where: { id: input.callId },
      data: { overall_review_json: report as any, updated_at: new Date() },
    })
  } catch (error) {
    // The tenant must not be charged for a report that was never stored.
    await releaseReviewerUsage(reportUsage).catch(() => undefined)
    throw error
  }

  // One counted run per workspace: the operation id is keyed by call, so
  // regenerating a report after a revision does not bill the tenant twice.
  await completeReviewerUsage(reportUsage, {
    callId: input.callId,
    reviewedSectionCount: reviewedSections.length,
  }).catch(usageError => {
    console.error('[Reviewer] Failed to record report usage:', usageError)
  })

  return {
    report,
    scoredVersions: chosenVersions,
    supersededVersionCount: superseded.length,
    reviewedSectionCount: reviewedSections.length,
    allSections,
  }
}

/**
 * Regenerate only when the stored report no longer describes the current
 * drafts. Used by the callers that want a current report as a side effect
 * (the ATR export, the post-review refresh) rather than as the user's request.
 *
 * Never throws: a caller in this position wants the best report available, not
 * a failed operation. The result says what actually happened so the caller can
 * be honest about it.
 */
export async function ensureCurrentReport(
  callId: string,
  options?: {
    /**
     * Whether a workspace that has never had a report should get one.
     *
     * True for the export, where the user is asking for the document and an
     * absent report is the thing to fix. False after a single section review,
     * where generating a whole panel report off one reviewed section would
     * spend the user's money on a verdict nobody asked for.
     */
    createIfMissing?: boolean
  }
): Promise<{
  regenerated: boolean
  freshness: ReportFreshness
  error: string | null
}> {
  const createIfMissing = options?.createIfMissing !== false

  let status: ReviewerReportStatus
  try {
    status = await getReportStatus(callId)
  } catch (error) {
    console.error('[Reviewer] Could not read report status:', error)
    return { regenerated: false, freshness: 'missing', error: 'Could not read the report status' }
  }

  if (status.freshness === 'fresh') {
    return { regenerated: false, freshness: 'fresh', error: null }
  }
  if (status.freshness === 'missing' && !createIfMissing) {
    return { regenerated: false, freshness: 'missing', error: null }
  }
  if (status.reviewedSectionCount === 0) {
    return { regenerated: false, freshness: status.freshness, error: null }
  }

  try {
    // Regenerate under the same pins and exclusions the stored report used —
    // an automatic refresh used to drop them and silently revert a pinned
    // report to the newest versions.
    await generateReviewerReport({
      callId,
      versionSelections: Object.keys(status.pinnedVersions).length ? status.pinnedVersions : null,
      excludedTitles: status.excludedTitles,
    })
    return { regenerated: true, freshness: 'fresh', error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not regenerate the report'
    console.error('[Reviewer] Automatic report regeneration failed:', error)
    return { regenerated: false, freshness: status.freshness, error: message }
  }
}
