import crypto from 'crypto'

import prisma from '@/lib/prisma'
import { isPatentNestConfigured } from '@/lib/patentnest/client'
import { hasMeaningfulSectionContent } from '@/lib/reviewer/content'
import {
  buildDeterministicSummary,
  renderDeterministicBriefing,
  resolveSectionVersions,
} from '@/lib/reviewer/finalReport'
import { normalizeVersionSelections } from '@/lib/reviewer/finalReport'
import { buildReviewerLandscape, buildSectionDigests } from '@/lib/reviewer/landscape'
import { assessNovelty } from '@/lib/reviewer/novelty'
import { buildPriorWorkFlags } from '@/lib/reviewer/priorWorkFlags'
import {
  reportFreshness,
  scoredTitlesAwaitingReview,
  type ReportFreshness,
} from '@/lib/reviewer/sectionGrouping'
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
  /**
   * Titles the report scored that were edited in place and have not been
   * reviewed again. Regenerating now would silently drop them from the report.
   */
  awaitingReviewSections: string[]
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
  const scoredStamps = scoreBasis?.scoredReviewStamps && typeof scoreBasis.scoredReviewStamps === 'object'
    ? scoreBasis.scoredReviewStamps
    : null
  const pinnedVersions = normalizeVersionSelections(scoreBasis?.pinnedVersions)
  const excludedTitles: string[] = Array.isArray(scoreBasis?.excludedTitles)
    ? scoreBasis.excludedTitles.map((title: unknown) => String(title || '').trim()).filter(Boolean)
    : []
  const outdatedSections: string[] = []

  if (freshness === 'stale' && scoredVersions && typeof scoredVersions === 'object') {
    const { effective } = resolveSectionVersions(sections as any, pinnedVersions, { excludedTitles })
    for (const section of effective) {
      const scored = scoredVersions[section.section_title]
      const stamp = scoredStamps?.[section.section_title]
      const reviewedAt = section.last_reviewed_at ? new Date(section.last_reviewed_at as any).toISOString() : null
      if (
        typeof scored !== 'number'
        || scored !== Number(section.version || 1)
        || (typeof stamp === 'string' && reviewedAt && stamp !== reviewedAt)
      ) {
        outdatedSections.push(section.section_title)
      }
    }
  }

  return {
    freshness,
    outdatedSections,
    awaitingReviewSections: scoredTitlesAwaitingReview(call?.overall_review_json, sections as any),
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
 * Whether a landscape built at `builtAt` can stand in for a fresh build: same
 * inputs, every source actually answered, recent enough that the search corpus
 * has not moved on, and reuse not disabled by the kill switch.
 *
 * "Not an errored build" used to be the only quality bar, so a run where the
 * patent search failed but projects came back (`partial`) — or where patent
 * search was not configured yet — was reused for a week, and regenerating the
 * report never searched for patents again.
 */
export function landscapeIsReusable(
  landscape: any,
  builtAt: unknown,
  hash: string,
  now: Date,
  options: { patentSearchConfigured?: boolean } = {}
): boolean {
  if (!reviewerLandscapeReuseEnabled()) return false
  if (!landscape || typeof landscape !== 'object') return false
  if (landscape.input_hash !== hash) return false
  if (landscape.status === 'error' || landscape.status === 'partial') return false
  const sources = landscape.sources && typeof landscape.sources === 'object' ? landscape.sources : {}
  if (sources.patents?.status === 'error' || sources.projects?.error) return false
  const patentSearchConfigured = options.patentSearchConfigured ?? isPatentNestConfigured()
  if (sources.patents?.status === 'not_configured' && patentSearchConfigured) return false
  // A step that degraded (timed-out tagging, fallback query) is worth one more try.
  if (Array.isArray(landscape.notes) && landscape.notes.length > 0) return false

  const builtAtMs = Date.parse(String(builtAt || ''))
  if (!Number.isFinite(builtAtMs)) return false
  const ageMs = now.getTime() - builtAtMs
  return ageMs >= 0 && ageMs <= REVIEWER_LANDSCAPE_REUSE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Whether the previous report's landscape can stand in for a fresh build.
 */
export function shouldReuseLandscape(
  prevReport: any,
  hash: string,
  now: Date,
  options: { patentSearchConfigured?: boolean } = {}
): boolean {
  return landscapeIsReusable(prevReport?.landscape, prevReport?.generated_at, hash, now, options)
}

/** A stored novelty verdict worth keeping — the `unassessed` fallback is not. */
export function reusableNoveltyOf(novelty: unknown): any | null {
  if (!novelty || typeof novelty !== 'object') return null
  return (novelty as any).verdict && (novelty as any).verdict !== 'unassessed' ? novelty : null
}

/**
 * Where a landscape is parked when the panel model fails after it was built.
 *
 * The landscape costs a distillation call, a facet-mapping call and two
 * searches, and it is started before the panel report so the two run together.
 * When the panel call then failed, all of that was thrown away with it and the
 * user's retry paid for it again — the exact charge behind "we regenerate three
 * or four times and it costs us tokens". Parking it means a retry pays only for
 * the panel report.
 */
export function landscapeCacheOf(parsedJson: unknown): { landscape: any; novelty: any | null; built_at: string } | null {
  const parsed = parsedJson && typeof parsedJson === 'object' ? (parsedJson as Record<string, any>) : null
  const cache = parsed?.landscape_cache
  if (!cache || typeof cache !== 'object' || !cache.landscape) return null
  return { landscape: cache.landscape, novelty: cache.novelty || null, built_at: String(cache.built_at || '') }
}

/**
 * Park a landscape (and the novelty verdict built on it) that a failed run
 * already paid for. Best effort by design.
 */
async function parkLandscape(callId: string, landscape: any, novelty: any, hash: string): Promise<void> {
  if (!landscape || typeof landscape !== 'object' || landscape.status === 'error') return

  const call = await prisma.reviewerCall.findUnique({ where: { id: callId }, select: { parsed_json: true } })
  const parsed = call?.parsed_json && typeof call.parsed_json === 'object'
    ? (call.parsed_json as Record<string, any>)
    : {}

  await prisma.reviewerCall.update({
    where: { id: callId },
    data: {
      parsed_json: {
        ...parsed,
        landscape_cache: {
          landscape: { ...landscape, input_hash: hash },
          ...(reusableNoveltyOf(novelty) ? { novelty } : {}),
          built_at: new Date().toISOString(),
        },
      } as any,
    },
  })
  console.log('[Reviewer] Panel report failed — kept the landscape so a retry does not rebuild it')
}

/** Drop a parked landscape once a report has been stored with its own copy. */
function withoutLandscapeCache(parsedJson: unknown): Record<string, any> | null {
  const parsed = parsedJson && typeof parsedJson === 'object' ? (parsedJson as Record<string, any>) : null
  if (!parsed || !('landscape_cache' in parsed)) return null
  const { landscape_cache: _dropped, ...rest } = parsed
  return rest
}

// ---------------------------------------------------------------------------
// One generation at a time, and a daily ceiling
//
// The quota ledger charges one report per workspace — regenerating after a
// revision is meant to be free — which left the most expensive call in the
// module (a 16k-token panel report, plus landscape and novelty) unmetered and
// unlimited. Nothing stopped two runs at once either: the auto-run's last step
// and a click on Regenerate both paid, and the last write won.
//
// Both guards live in `review_progress_state` so no migration is needed. The
// section runner merges into that column rather than overwriting it, so the
// lock survives section reviews running alongside. The web tier runs in PM2
// cluster mode, which rules out an in-process lock.
// ---------------------------------------------------------------------------

const REPORT_LOCK_TTL_MS = 10 * 60 * 1000
const REPORT_RUN_WINDOW_MS = 24 * 60 * 60 * 1000

export function reviewerReportDailyLimit(): number {
  const configured = Number(process.env.REVIEWER_REPORT_DAILY_LIMIT)
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 15
}

/** Report runs recorded in the last 24 hours, oldest first. Pure. */
export function recentReportRuns(progressState: unknown, now: Date): string[] {
  const state = progressState && typeof progressState === 'object' ? (progressState as Record<string, any>) : {}
  const runs = Array.isArray(state.report_runs) ? state.report_runs : []
  return runs
    .map((value: unknown) => String(value || ''))
    .filter((value: string) => {
      const at = Date.parse(value)
      return Number.isFinite(at) && now.getTime() - at < REPORT_RUN_WINDOW_MS && at <= now.getTime()
    })
}

export async function acquireReportLock(callId: string): Promise<string | null> {
  const token = crypto.randomUUID()
  const until = new Date(Date.now() + REPORT_LOCK_TTL_MS).toISOString()
  const claimed = await prisma.$executeRaw`
    UPDATE "reviewer_calls"
    SET review_progress_state =
      (CASE WHEN jsonb_typeof(review_progress_state) = 'object' THEN review_progress_state ELSE '{}'::jsonb END)
      || jsonb_build_object('report_lock', jsonb_build_object('token', ${token}::text, 'until', ${until}::text))
    WHERE id = ${callId}
      AND (
        review_progress_state IS NULL
        OR jsonb_typeof(review_progress_state) <> 'object'
        OR review_progress_state->'report_lock' IS NULL
        OR (review_progress_state->'report_lock'->>'until')::timestamptz < now()
      )
  `
  return claimed > 0 ? token : null
}

export async function releaseReportLock(callId: string, token: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "reviewer_calls"
    SET review_progress_state = review_progress_state - 'report_lock'
    WHERE id = ${callId}
      AND jsonb_typeof(review_progress_state) = 'object'
      AND review_progress_state->'report_lock'->>'token' = ${token}
  `
}

export async function recordReportRun(callId: string, runs: string[]): Promise<void> {
  const payload = JSON.stringify(runs.slice(-50))
  await prisma.$executeRaw`
    UPDATE "reviewer_calls"
    SET review_progress_state =
      (CASE WHEN jsonb_typeof(review_progress_state) = 'object' THEN review_progress_state ELSE '{}'::jsonb END)
      || jsonb_build_object('report_runs', ${payload}::jsonb)
    WHERE id = ${callId}
  `
}

/** The panel prompt's call context gets the same ceiling as a section review. */
const REPORT_CALL_CONTEXT_MAX_CHARS = Number(process.env.REVIEWER_CALL_CONTEXT_MAX_CHARS) || 24_000

export function capCallContext(text: string): string {
  if (text.length <= REPORT_CALL_CONTEXT_MAX_CHARS) return text
  return `${text.slice(0, REPORT_CALL_CONTEXT_MAX_CHARS)}\n[Call context truncated for the panel report]`
}

/** When each scored section was last reviewed — the freshness fingerprint. */
function reviewStampsOf(sections: any[]): Record<string, string> {
  const stamps: Record<string, string> = {}
  for (const section of sections) {
    const at = section?.last_reviewed_at ? new Date(section.last_reviewed_at) : null
    if (at && Number.isFinite(at.getTime())) stamps[section.section_title] = at.toISOString()
  }
  return stamps
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

interface GenerateReviewerReportInput {
  callId: string
  versionSelections?: Record<string, unknown> | null
  /** Section titles to leave out of the report entirely (the picker's unchecked rows). */
  excludedTitles?: string[] | null
}

/**
 * Build and persist the panel report for a reviewer workspace.
 *
 * Throws `ReviewerReportError` for conditions the caller should surface rather
 * than log: nothing reviewed yet, another generation already running, the
 * daily ceiling reached, or the model returning something unusable.
 */
export async function generateReviewerReport(input: GenerateReviewerReportInput): Promise<GenerateReviewerReportResult> {
  const lockToken = await acquireReportLock(input.callId)
  if (!lockToken) {
    const exists = await prisma.reviewerCall.findUnique({ where: { id: input.callId }, select: { id: true } })
    if (!exists) throw new ReviewerReportError('Reviewer workspace not found', 'CALL_NOT_FOUND', 404)
    throw new ReviewerReportError(
      'The panel report for this proposal is already being generated. It will appear when that run finishes — check back in a minute.',
      'REPORT_IN_PROGRESS',
      409
    )
  }

  try {
    return await generateReviewerReportLocked(input)
  } finally {
    await releaseReportLock(input.callId, lockToken).catch((error) => {
      console.warn('[Reviewer] Could not release the report lock (it expires on its own):', error)
    })
  }
}

async function generateReviewerReportLocked(input: GenerateReviewerReportInput): Promise<GenerateReviewerReportResult> {
  const call = await prisma.reviewerCall.findUnique({
    where: { id: input.callId },
    select: {
      id: true,
      project_title: true,
      parsed_json: true,
      LLM_model_used: true,
      overall_review_json: true,
      review_progress_state: true,
    },
  })

  if (!call) {
    throw new ReviewerReportError('Reviewer workspace not found', 'CALL_NOT_FOUND', 404)
  }

  const now = new Date()
  const recentRuns = recentReportRuns(call.review_progress_state, now)
  if (recentRuns.length >= reviewerReportDailyLimit()) {
    throw new ReviewerReportError(
      `This proposal's panel report has been generated ${recentRuns.length} times in the last 24 hours, which is the daily limit. The current report stays available; try again tomorrow.`,
      'REPORT_DAILY_LIMIT',
      429
    )
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
  // Section reviews cap the call context; the panel prompt used to receive it
  // whole, so a long URL-extracted call made the costliest prompt costlier.
  const description = capCallContext(String(
    parsedContext
      ? parsedContext.reviewer_context_text || parsedContext.description || parsedContext.call_summary || ''
      : ''
  ))

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

  // Hold the quota slot before anything is spent — the landscape included. It
  // used to start first, so a tenant already out of quota still paid for a
  // distill call, a tagging call and two searches on every click, and the
  // result was thrown away. A failed report releases the slot again.
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

  // Past the quota check, this run will spend: it counts toward the ceiling.
  await recordReportRun(input.callId, [...recentRuns, now.toISOString()]).catch((error) => {
    console.warn('[Reviewer] Could not record the report run:', error)
  })

  // Reference-only prior work: the landscape (similar funded projects + Indian
  // patents) and the novelty verdict built on it. Both start now and run
  // alongside the panel model; neither is ever passed to it, so they cannot
  // influence the score. Novelty used to wait for the panel to finish, adding
  // up to 45s to a request that is already the slowest in the module.
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
  // Either the landscape stored with the last report, or one parked by a run
  // whose panel model failed after the landscape had already been paid for.
  const parkedLandscape = landscapeCacheOf(call.parsed_json)
  const reuseSource: 'report' | 'parked' | null = shouldReuseLandscape(prevReport, landscapeInputHash, now)
    ? 'report'
    : parkedLandscape && landscapeIsReusable(parkedLandscape.landscape, parkedLandscape.built_at, landscapeInputHash, now)
      ? 'parked'
      : null
  const reusableLandscape = reuseSource === 'report'
    ? prevReport.landscape
    : reuseSource === 'parked'
      ? parkedLandscape!.landscape
      : null
  // An `unassessed` stored verdict is the failure fallback: one fresh attempt
  // against the (reused) landscape is worth its single call.
  const reusableNovelty = reuseSource === 'report'
    ? reusableNoveltyOf(prevReport?.novelty_assessment)
    : reuseSource === 'parked'
      ? reusableNoveltyOf(parkedLandscape!.novelty)
      : null
  if (reuseSource) {
    console.log(`[Reviewer] Landscape inputs unchanged — reusing the ${reuseSource === 'report' ? 'stored' : 'parked'} landscape`)
  }

  const landscapePromise: Promise<any> = reuseSource
    ? Promise.resolve(reusableLandscape)
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
  // Pre-caught: a panel failure below must not leave an unhandled rejection.
  const noveltyPromise: Promise<any> = landscapePromise
    .then((landscape) => {
      if (!landscape) return null
      if (reusableNovelty) return reusableNovelty
      return assessNovelty({
        callId: input.callId,
        projectTitle: call.project_title || '',
        parsedContext,
        modelType: modelType as 'O' | 'G',
        sections: digestSections,
        landscape,
      })
    })
    .catch((error) => {
      console.error('[Reviewer] Novelty assessment rejected unexpectedly:', error)
      return null
    })

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
    // Park whatever the prior-work steps produced alongside the failed report,
    // so the retry the user is about to make does not pay for them again.
    if (reuseSource !== 'report') {
      const [parkable, parkableNovelty] = await Promise.all([landscapePromise, noveltyPromise])
      await parkLandscape(input.callId, parkable, parkableNovelty, landscapeInputHash).catch(() => undefined)
    }
    throw error
  }

  const [landscape, noveltyAssessment] = await Promise.all([landscapePromise, noveltyPromise])

  // Where the panel's own words and the prior-work evidence disagree, or a
  // proposal aspect is already patented — computed, never scored.
  const priorWorkFlags = landscape || noveltyAssessment
    ? buildPriorWorkFlags({ overall: overallReview, novelty: noveltyAssessment, landscape })
    : []

  const report = {
    ...overallReview,
    compliance: deterministic.compliance,
    // input_hash records what the landscape was built from, so the next
    // regeneration can prove the inputs unchanged and reuse it.
    ...(landscape ? { landscape: { ...landscape, input_hash: landscapeInputHash } } : {}),
    ...(noveltyAssessment ? { novelty_assessment: noveltyAssessment } : {}),
    ...(landscape || noveltyAssessment ? { prior_work_flags: priorWorkFlags } : {}),
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
      // When each scored draft was last reviewed. A section edited in place
      // keeps its version number, so the version alone never noticed that the
      // text — and its review — had changed underneath the report.
      scoredReviewStamps: reviewStampsOf(reviewedSections),
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
    // The stored report now carries its own landscape, so any parked copy is
    // dead weight. Re-read first: the run took minutes, and writing back the
    // snapshot taken at the start would undo a share or a saved preference
    // made meanwhile.
    const current = await prisma.reviewerCall.findUnique({
      where: { id: input.callId },
      select: { parsed_json: true },
    })
    const parsedWithoutCache = withoutLandscapeCache(current?.parsed_json)
    await prisma.reviewerCall.update({
      where: { id: input.callId },
      data: {
        overall_review_json: report as any,
        updated_at: new Date(),
        ...(parsedWithoutCache ? { parsed_json: parsedWithoutCache as any } : {}),
      },
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
  // A section the report scored is being edited and has not been reviewed
  // again. Regenerating now would score the proposal without it — a quieter
  // and worse error than shipping the stale report with its warning.
  if (status.awaitingReviewSections.length > 0) {
    return {
      regenerated: false,
      freshness: status.freshness,
      error: `Edited sections are awaiting review (${status.awaitingReviewSections.join(', ')}). Review them, then regenerate the report.`,
    }
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
