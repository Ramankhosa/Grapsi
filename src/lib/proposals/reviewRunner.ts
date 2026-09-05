/**
 * Running the AI reviewer over a proposal draft, server-side.
 *
 * The officer presses a button and closes the tab. Everything after that
 * happens here: the workspace is created or reused, the draft is split into its
 * sections, each section is reviewed, and the panel report is compiled. A run
 * that dies with its worker is picked up again by the sweep.
 *
 * Two invariants make that safe:
 *
 *  1. **The claim is a conditional UPDATE.** A row moves out of QUEUED exactly
 *     once, so two workers (PM2 runs a cluster) can both try and only one wins.
 *  2. **Every step is idempotent.** Sections whose text has not changed keep
 *     their existing review, and the report is only rebuilt when stale, so a
 *     resumed run costs almost nothing and never double-charges.
 *
 * ONE reviewer workspace serves the whole proposal, every version. That is what
 * makes version 2 import as *revisions* of version 1's sections, which is what
 * lets the review answer "did they address what we said last time".
 */
import {
  createReviewerCallFromContext,
  createStandaloneReviewerCall,
} from '@/lib/reviewer/template-bridge'
import {
  mapRulesOntoDefaultSections,
  normalizeReviewerCallContext,
} from '@/lib/reviewer/callContext'
import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService'
import { hasMeaningfulSectionContent } from '@/lib/reviewer/content'
import { readFundingAssetBuffer } from '@/lib/funding/storage'
import { resolveTenantContextForUser } from '@/lib/metering/auth-bridge'
import {
  commitProposalImport,
  loadImportTargets,
  previewProposalImport,
} from '@/lib/reviewer/proposalImport'
import { generateReviewerReport, ReviewerReportError } from '@/lib/reviewer/reportGeneration'
import { groupReviewerSections } from '@/lib/reviewer/sectionGrouping'
import { reviewSectionById } from '@/lib/reviewer/sectionReviewRunner'
import { extractTextFromDocumentBytes } from '@/lib/reviewer/sourceText'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'

import { recordProposalEventQuietly } from './events'

/** How long a run may go without a heartbeat before the sweep reclaims it. */
export const STALE_RUN_MINUTES = Number(process.env.PROPOSAL_REVIEW_STALE_MINUTES) || 20

const MAX_ATTEMPTS_PER_STEP = 3
const BETWEEN_SECTIONS_MS = 4000
const RATE_LIMIT_BUFFER_MS = 2000
/**
 * Below this share of the document being placed, the split is not worth
 * reviewing: a review of two paragraphs out of forty reads like a verdict on the
 * proposal and is a verdict on the importer.
 */
const MIN_MATCHED_WORD_SHARE = 0.35

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface ProgressStep {
  key: string
  title: string
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped'
  score?: number | null
  detail?: string | null
}

interface RunState {
  steps: ProgressStep[]
  reviewed: number
  failed: number
  phase: string
  log: Array<{ at: string; message: string }>
}

/**
 * Take the row, or discover somebody else already has it.
 *
 * `heartbeat_at` and not `started_at` is the staleness test: a healthy
 * twenty-five minute run would be stolen by a rule that read the start time.
 */
async function claimRun(reviewId: string, allowStale: boolean): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000)

  const claimed = allowStale
    ? await prisma.$executeRaw`
        UPDATE "grant_proposal_reviews"
        SET status = 'IMPORTING',
            started_at = COALESCE(started_at, NOW()),
            heartbeat_at = NOW(),
            attempt = attempt + 1,
            updated_at = NOW()
        WHERE id = ${reviewId}
          AND (
            status = 'QUEUED'
            OR (status IN ('IMPORTING','REVIEWING','REPORTING')
                AND (heartbeat_at IS NULL OR heartbeat_at < ${staleBefore}))
          )
      `
    : await prisma.$executeRaw`
        UPDATE "grant_proposal_reviews"
        SET status = 'IMPORTING',
            started_at = NOW(),
            heartbeat_at = NOW(),
            attempt = attempt + 1,
            updated_at = NOW()
        WHERE id = ${reviewId} AND status = 'QUEUED'
      `

  return claimed > 0
}

async function beat(reviewId: string, state: RunState, patch: Record<string, unknown> = {}) {
  await prisma.grantProposalReview
    .update({
      where: { id: reviewId },
      data: {
        heartbeat_at: new Date(),
        progress: state as any,
        ...patch,
      },
    })
    .catch((error) => console.error('[proposals] heartbeat failed', error))
}

function say(state: RunState, message: string) {
  state.log = [...state.log.slice(-99), { at: new Date().toISOString(), message }]
  console.log(`[proposal-review] ${message}`)
}

async function fail(
  reviewId: string,
  state: RunState,
  input: { error: string; code: string; versionId: string; proposalId: string; tenantId: string; runBy: string }
) {
  state.phase = 'failed'
  await prisma.grantProposalReview
    .update({
      where: { id: reviewId },
      data: {
        status: 'FAILED',
        error: input.error.slice(0, 2000),
        error_code: input.code,
        finished_at: new Date(),
        heartbeat_at: new Date(),
        progress: state as any,
      },
    })
    .catch(() => undefined)
  await prisma.grantProposalVersion
    .update({ where: { id: input.versionId }, data: { review_status: 'FAILED' } })
    .catch(() => undefined)

  await recordProposalEventQuietly({
    tenantId: input.tenantId,
    proposalId: input.proposalId,
    actorUserId: input.runBy,
    kind: 'REVIEW_FAILED',
    payload: { error: input.error.slice(0, 500), code: input.code },
    // The mechanics of a failed run are the department's problem to fix, not
    // news for the applicant.
    visibleToFaculty: false,
  })

  await notifyQuietly({
    tenantId: input.tenantId,
    userIds: [input.runBy],
    title: 'Proposal review could not finish',
    body: input.error.slice(0, 300),
    category: 'PROPOSAL',
    linkUrl: `/funding-dept/proposals/${input.proposalId}`,
  })
}

/**
 * Make sure the proposal has a reviewer workspace, and return its id.
 *
 * A catalog call brings its own rules (template, guideline pack or the call's
 * own fields). An ad hoc call has none, so the workspace starts from the default
 * section set — the reviewer's own skeleton — rather than refusing to run.
 */
export async function ensureReviewerWorkspace(proposal: any, runByUserId: string): Promise<string> {
  if (proposal.reviewer_call_id) return proposal.reviewer_call_id

  let callId: string

  if (proposal.funding_call_id) {
    const created = await createStandaloneReviewerCall({
      userId: runByUserId,
      tenantId: proposal.tenant_id,
      fundingCallId: proposal.funding_call_id,
      projectTitle: proposal.title,
      seedSections: true,
    })
    callId = created.id
  } else {
    const context = normalizeReviewerCallContext({
      rules_source: 'call_fields',
      title: proposal.scheme_title || proposal.title,
      agency_name: proposal.agency_name,
      call_summary: `${proposal.agency_name}${proposal.scheme_title ? ` — ${proposal.scheme_title}` : ''}`,
      submission_deadline: proposal.agency_deadline_at
        ? new Date(proposal.agency_deadline_at).toISOString()
        : null,
      funding_call_id: null,
      template_sections: mapRulesOntoDefaultSections([]).sections,
    })

    const created = await createReviewerCallFromContext({
      userId: runByUserId,
      tenantId: proposal.tenant_id,
      context,
      templateSnapshot: {
        source: 'proposal_ad_hoc',
        agencyName: proposal.agency_name,
        capturedAt: new Date().toISOString(),
      },
      projectTitle: proposal.title,
      seedSections: true,
    })
    callId = created.id
  }

  await prisma.grantProposal.update({
    where: { id: proposal.id },
    data: { reviewer_call_id: callId },
  })

  return callId
}

/**
 * Run one review to completion.
 *
 * Never throws: a background job that throws into a detached promise takes the
 * information with it, so every exit lands in the row instead.
 */
export async function runProposalReview(
  reviewId: string,
  options: { allowStale?: boolean } = {}
): Promise<{ ran: boolean; status?: string }> {
  const claimed = await claimRun(reviewId, options.allowStale === true)
  if (!claimed) return { ran: false }

  const run = await prisma.grantProposalReview.findUnique({
    where: { id: reviewId },
    include: {
      version: true,
      proposal: true,
    },
  })
  if (!run || !run.proposal || !run.version) return { ran: false }

  const proposal = run.proposal
  const version = run.version
  const state: RunState = { steps: [], reviewed: 0, failed: 0, phase: 'importing', log: [] }

  const failWith = (error: string, code: string) =>
    fail(reviewId, state, {
      error,
      code,
      versionId: version.id,
      proposalId: proposal.id,
      tenantId: proposal.tenant_id,
      runBy: run.run_by_user_id,
    })

  try {
    const tenantContext = await resolveTenantContextForUser({
      tenantId: proposal.tenant_id,
      userId: run.run_by_user_id,
    })
    if (!tenantContext) {
      await failWith('This tenant is not active, so the review cannot run.', 'TENANT_INACTIVE')
      return { ran: true, status: 'FAILED' }
    }
    const llm = { tenantContext }

    const reviewerCallId = await ensureReviewerWorkspace(proposal, run.run_by_user_id)
    await prisma.grantProposalReview.update({
      where: { id: reviewId },
      data: { reviewer_call_id: reviewerCallId },
    })

    // ---- Import ---------------------------------------------------------
    let writtenIds = new Set<string>()

    if (!run.skip_import) {
      say(state, `Reading version ${version.version_no}…`)
      state.steps = [{ key: 'import', title: 'Reading the document', status: 'active' }]
      await beat(reviewId, state)

      const ctx = await loadImportTargets(reviewerCallId)
      if (!ctx) {
        await failWith('The reviewer workspace disappeared.', 'NO_WORKSPACE')
        return { ran: true, status: 'FAILED' }
      }

      let text = ''
      try {
        const bytes = await readFundingAssetBuffer(version.storage_path)
        const extracted = await extractTextFromDocumentBytes(bytes, version.file_name)
        text = extracted.text
      } catch (error: any) {
        await failWith(
          `Could not read the uploaded file: ${error?.message || 'unknown error'}`,
          'FILE_UNREADABLE'
        )
        return { ran: true, status: 'FAILED' }
      }

      if (!text.trim()) {
        await failWith(
          'No readable text was found in that file. A scanned PDF has no text layer — ask for a text-based PDF or a .docx.',
          'NO_TEXT'
        )
        return { ran: true, status: 'FAILED' }
      }

      const preview = previewProposalImport(text, ctx)
      const matchedWords = preview.words - preview.unmatchedWords
      const share = preview.words > 0 ? matchedWords / preview.words : 0

      if (preview.segments.every((segment) => !segment.targetTitle) || share < MIN_MATCHED_WORD_SHARE) {
        state.steps = [{ key: 'import', title: 'Reading the document', status: 'failed' }]
        await prisma.grantProposalReview.update({
          where: { id: reviewId },
          data: { import_summary: { ...preview, segments: undefined, targets: undefined } as any },
        })
        await failWith(
          `Only ${Math.round(share * 100)}% of the document could be matched to this call's sections. Open the reviewer workspace, map the sections by hand, then run the review again.`,
          'IMPORT_UNMAPPED'
        )
        return { ran: true, status: 'FAILED' }
      }

      const commit = await commitProposalImport(
        reviewerCallId,
        ctx,
        preview.segments
          .filter((segment) => segment.targetTitle)
          .map((segment) => ({
            targetTitle: segment.targetTitle as string,
            heading: segment.heading,
            body: segment.body,
          }))
      )
      if (!commit.ok) {
        await failWith(commit.error, 'IMPORT_FAILED')
        return { ran: true, status: 'FAILED' }
      }

      writtenIds = new Set(commit.written.map((entry) => entry.sectionId))
      state.steps = [{ key: 'import', title: 'Reading the document', status: 'done' }]
      say(state, `Placed ${commit.written.length} sections.`)

      await prisma.grantProposalReview.update({
        where: { id: reviewId },
        data: {
          import_summary: {
            written: commit.written.length,
            skipped: commit.skipped.length,
            unmatchedWords: preview.unmatchedWords,
            words: preview.words,
            splitMode: preview.splitMode,
          } as any,
        },
      })
    }

    // ---- Section reviews -------------------------------------------------
    state.phase = 'reviewing'
    await prisma.grantProposalReview.update({
      where: { id: reviewId },
      data: { status: 'REVIEWING', heartbeat_at: new Date() },
    })
    await prisma.grantProposalVersion.update({
      where: { id: version.id },
      data: { review_status: 'RUNNING' },
    })

    const allSections = await prisma.reviewerSection.findMany({ where: { call_id: reviewerCallId } })
    // One per title, newest version, in proposal order — reviewing superseded
    // drafts wastes model calls and pollutes the report.
    const current = groupReviewerSections(allSections as any)
      .map((group: any) => group.current)
      .filter((section: any) => hasMeaningfulSectionContent(section.user_input))

    const toReview = current.filter(
      (section: any) => writtenIds.has(section.id) || section.status !== 'reviewed'
    )

    if (current.length === 0) {
      await failWith('No section of this draft has any content to review.', 'NO_CONTENT')
      return { ran: true, status: 'FAILED' }
    }

    state.steps = [
      ...state.steps,
      ...toReview.map((section: any) => ({
        key: `rev:${section.id}`,
        title: section.section_title,
        status: 'pending' as const,
      })),
      { key: 'report', title: 'Panel report', status: 'pending' as const },
    ]
    await beat(reviewId, state)

    for (const [index, section] of toReview.entries()) {
      const key = `rev:${section.id}`
      state.steps = state.steps.map((step) =>
        step.key === key ? { ...step, status: 'active' as const } : step
      )
      say(state, `Reviewing ${section.section_title} (${index + 1} of ${toReview.length})…`)
      await beat(reviewId, state)

      let done = false
      let quotaExhausted = false

      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_STEP && !done; attempt++) {
        const outcome = await reviewSectionById({
          callId: reviewerCallId,
          sectionId: section.id,
          force: true,
          skipIfUnchanged: true,
          contextSectionIds: null,
          llm,
        })

        if (outcome.ok) {
          const score = outcome.review?.score
          state.steps = state.steps.map((step) =>
            step.key === key
              ? { ...step, status: 'done' as const, score: typeof score === 'number' ? score : null }
              : step
          )
          state.reviewed += 1
          done = true
          break
        }

        if (outcome.status === 429 && outcome.code !== 'SERVICE_QUOTA_EXCEEDED') {
          if (attempt < MAX_ATTEMPTS_PER_STEP) {
            const wait = (outcome.retryAfterMs || 60000) + RATE_LIMIT_BUFFER_MS
            say(state, `Rate limited. Waiting ${Math.ceil(wait / 1000)}s before retrying.`)
            state.steps = state.steps.map((step) =>
              step.key === key ? { ...step, detail: 'Rate limited — waiting' } : step
            )
            await beat(reviewId, state)
            await sleep(wait)
            continue
          }
        }

        // A quota refusal is not transient: retrying spends nothing and fixes
        // nothing, so the run stops and says why.
        if (outcome.status === 429 && outcome.code && outcome.code !== 'GEMINI_RATE_LIMITED') {
          quotaExhausted = true
        }

        state.steps = state.steps.map((step) =>
          step.key === key
            ? { ...step, status: 'failed' as const, detail: outcome.error?.slice(0, 200) }
            : step
        )
        state.failed += 1
        say(state, `Could not review ${section.section_title}.`)
        done = true
      }

      if (quotaExhausted) {
        await failWith(
          'This tenant has used its AI grant review quota for the period.',
          'QUOTA'
        )
        return { ran: true, status: 'FAILED' }
      }

      await beat(reviewId, state)
      if (index < toReview.length - 1) await sleep(BETWEEN_SECTIONS_MS)
    }

    if (state.reviewed === 0 && state.failed > 0) {
      await failWith('No section could be reviewed, so there is nothing to compile.', 'ALL_SECTIONS_FAILED')
      return { ran: true, status: 'FAILED' }
    }

    // ---- Panel report ----------------------------------------------------
    state.phase = 'reporting'
    state.steps = state.steps.map((step) =>
      step.key === 'report' ? { ...step, status: 'active' as const } : step
    )
    say(state, 'Compiling the panel report…')
    await prisma.grantProposalReview.update({
      where: { id: reviewId },
      data: { status: 'REPORTING', heartbeat_at: new Date(), progress: state as any },
    })

    let report: any = null
    let reportError = ''

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_STEP && !report; attempt++) {
      try {
        const result = await generateReviewerReport({ callId: reviewerCallId })
        report = result.report
      } catch (error: any) {
        if (isGeminiRateLimitErrorLike(error) && attempt < MAX_ATTEMPTS_PER_STEP) {
          const wait = (getGeminiRetryAfterMs(error) || 60000) + RATE_LIMIT_BUFFER_MS
          say(state, `The report is rate limited. Waiting ${Math.ceil(wait / 1000)}s.`)
          await beat(reviewId, state)
          await sleep(wait)
          continue
        }
        reportError =
          error instanceof ReviewerReportError
            ? error.message
            : error?.message || 'Could not compile the panel report'
        break
      }
    }

    if (!report) {
      state.steps = state.steps.map((step) =>
        step.key === 'report' ? { ...step, status: 'failed' as const, detail: reportError } : step
      )
      await failWith(
        `The sections were reviewed, but the panel report could not be compiled: ${reportError}`,
        'REPORT_FAILED'
      )
      return { ran: true, status: 'FAILED' }
    }

    const overallScore =
      typeof report?.score_basis?.weightedScore === 'number'
        ? report.score_basis.weightedScore
        : typeof report?.overall_score === 'number'
          ? report.overall_score
          : null
    const recommendation = report?.funding_recommendation?.decision || null

    state.steps = state.steps.map((step) =>
      step.key === 'report' ? { ...step, status: 'done' as const } : step
    )
    state.phase = 'done'

    await prisma.grantProposalReview.update({
      where: { id: reviewId },
      data: {
        status: 'DONE',
        finished_at: new Date(),
        heartbeat_at: new Date(),
        progress: state as any,
        overall_score: overallScore,
        recommendation: recommendation ? String(recommendation).slice(0, 200) : null,
        error: null,
        error_code: null,
      },
    })
    await prisma.grantProposalVersion.update({
      where: { id: version.id },
      data: { review_status: 'REVIEWED' },
    })

    await recordProposalEventQuietly({
      tenantId: proposal.tenant_id,
      proposalId: proposal.id,
      actorUserId: run.run_by_user_id,
      kind: 'REVIEW_DONE',
      payload: { versionNo: version.version_no, score: overallScore },
      // Not the applicant's news until an officer decides to send it.
      visibleToFaculty: false,
    })

    await notifyQuietly({
      tenantId: proposal.tenant_id,
      userIds: [run.run_by_user_id],
      title: 'Proposal review ready to share',
      body: `${proposal.title} — version ${version.version_no}${
        overallScore != null ? `, scored ${overallScore.toFixed(1)}` : ''
      }.`,
      category: 'PROPOSAL',
      linkUrl: `/funding-dept/proposals/${proposal.id}`,
    })

    return { ran: true, status: 'DONE' }
  } catch (error: any) {
    console.error('[proposals] review run threw', error)
    await failWith(error?.message || 'The review run stopped unexpectedly.', 'UNKNOWN')
    return { ran: true, status: 'FAILED' }
  }
}

/**
 * Start a run without waiting for it.
 *
 * The route returns as soon as the row exists; the work continues in this
 * process. If the worker dies the sweep picks it up, which is why nothing here
 * needs to be awaited by the caller.
 */
export function kickProposalReview(reviewId: string): void {
  void runProposalReview(reviewId).catch((error) => {
    console.error('[proposals] detached review run failed', error)
  })
}

/**
 * Resume runs whose worker went away. Called by the cron sweep.
 */
export async function sweepStuckReviews(limit = 10): Promise<{
  considered: number
  resumed: number
  done: number
  failed: number
}> {
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000)

  const candidates = await prisma.grantProposalReview.findMany({
    where: {
      OR: [
        { status: 'QUEUED' },
        {
          status: { in: ['IMPORTING', 'REVIEWING', 'REPORTING'] },
          OR: [{ heartbeat_at: null }, { heartbeat_at: { lt: staleBefore } }],
        },
      ],
    },
    orderBy: { created_at: 'asc' },
    take: limit,
    select: { id: true },
  })

  let resumed = 0
  let done = 0
  let failed = 0

  for (const candidate of candidates) {
    const result = await runProposalReview(candidate.id, { allowStale: true })
    if (!result.ran) continue
    resumed += 1
    if (result.status === 'DONE') done += 1
    if (result.status === 'FAILED') failed += 1
  }

  return { considered: candidates.length, resumed, done, failed }
}
