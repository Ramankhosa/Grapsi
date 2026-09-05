// @ts-nocheck
/**
 * Reviewing one section, without a request.
 *
 * This is the body of `pages/api/reviewer/calls/[id]/sections/[sectionId]/review.ts`
 * lifted out unchanged, so two callers can share it: the HTTP handler (which
 * keeps its auth and maps the outcomes back to status codes) and the proposal
 * desk's background runner, which has no request at all and passes a
 * `tenantContext` instead of headers.
 *
 * Everything downstream already accepted either shape — `reviewSection` and
 * `ContextSummaryService` both take `requestHeaders` OR `tenantContext` — so
 * the only thing that had to change to make a server-side run possible was
 * where this code lives.
 */
import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService'
import {
  buildFallbackContextSummary,
  hasMeaningfulSectionContent,
  sectionContentHash,
} from '@/lib/reviewer/content'
import {
  completeReviewerUsage,
  releaseReviewerUsage,
  reserveReviewerUsage,
  reviewerSectionOperationId,
  ServiceQuotaExceededError,
} from '@/lib/reviewer/usage'
import prisma from '@/lib/prisma'
import {
  reviewSection,
  filterRelevantContextSummaries,
  selectContextProviderTitles,
} from '../../../lib/reviewerService'
import { ContextSummaryService } from '../../../lib/services/contextSummaryService'

/** Either half of the LLM identity the gateway accepts. */
export type ReviewerLlmAuth =
  | { requestHeaders: Record<string, string | string[] | undefined> }
  | { tenantContext: any }

export interface ReviewSectionInput {
  callId: string
  sectionId: string
  /** Re-review a section that already has one (the "review all again" run). */
  force?: boolean
  /** Keep an existing review when the text has not changed since it was made. */
  skipIfUnchanged?: boolean
  /**
   * Section titles to read as context. `null` (the default) takes the
   * "every available reviewed summary" branch, which is what a fresh proposal
   * version wants.
   */
  contextSectionIds?: string[] | null
  llm: ReviewerLlmAuth
}

export type ReviewSectionOutcome =
  | {
      ok: true
      review: any
      contextSummary: string
      priorSectionSummaries: Array<{ section_title: string; context_summary: string }>
      skippedUnchanged: boolean
    }
  | {
      ok: false
      status: 400 | 404 | 429 | 500
      error: string
      code?: string
      section?: string
      retryAfterMs?: number
    }

function hasAppDraftReviewerLink(section: any): boolean {
  const mappingJson = section?.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {}
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : []
  const declaresWorkflow = linkedSections.some((link: any) => typeof link?.workflowMode === 'string')
  return !declaresWorkflow || linkedSections.some((link: any) => String(link?.workflowMode || 'app_draft') === 'app_draft')
}

export async function reviewSectionById(input: ReviewSectionInput): Promise<ReviewSectionOutcome> {
  const { callId, sectionId } = input

  try {
    const sections = await prisma.$queryRaw`
      SELECT * FROM "reviewer_sections"
      WHERE id = ${sectionId} AND call_id = ${callId}
    `

    if (!sections || (Array.isArray(sections) && sections.length === 0)) {
      return { ok: false, status: 404, error: 'Section not found' }
    }

    const section = sections[0]
    console.log(`Processing review for section: ${section.section_title} (ID: ${sectionId})`)

    // Only allow review of draft sections — unless the caller explicitly asks
    // to re-review. Status only changes when a review lands, so an interrupted
    // run never strands a reviewed section as a draft.
    const forceReview = input.force === true
    if (section.status !== 'draft' && !forceReview) {
      return { ok: false, status: 400, error: 'Section has already been reviewed' }
    }

    if (!hasMeaningfulSectionContent(section.user_input)) {
      return {
        ok: false,
        status: 400,
        error: 'Section has no meaningful content to review',
        code: 'SECTION_CONTENT_MISSING',
        section: section.section_title,
      }
    }

    // A force re-run does not pay for sections whose text is identical to what
    // was already reviewed. The hash is stamped into ai_review_json at review
    // time; reviews that predate it simply miss and re-review.
    if (input.skipIfUnchanged === true && section.status === 'reviewed') {
      const storedHash =
        section.ai_review_json && typeof section.ai_review_json === 'object'
          ? section.ai_review_json.reviewed_input_hash
          : null
      if (storedHash && storedHash === sectionContentHash(section.user_input)) {
        console.log(`Section ${section.section_title} unchanged since its last review — keeping the existing review.`)
        return {
          ok: true,
          review: section.ai_review_json,
          contextSummary: section.context_summary,
          priorSectionSummaries: [],
          skippedUnchanged: true,
        }
      }
    }

    const callsWithModel = await prisma.$queryRaw`
      SELECT "LLM_model_used", parsed_json, project_title, "manualRubricJson", "templateSnapshotJson", "rulesSource" FROM "reviewer_calls"
      WHERE id = ${callId}
    `

    const callData = callsWithModel[0].parsed_json || {}
    const projectTitle = callsWithModel[0].project_title

    // A section mapped only to non-app-draft workflow content has nothing for
    // the reviewer to score.
    const mappingJson = section.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {}
    const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : []
    const linksDeclareWorkflow = linkedSections.some((link: any) => typeof link.workflowMode === 'string')
    const hasAppDraftLink = linkedSections.some((link: any) => String(link.workflowMode || 'app_draft') === 'app_draft')
    if (linksDeclareWorkflow && !hasAppDraftLink) {
      return {
        ok: false,
        status: 400,
        error: 'This reviewer section is not linked to app-draft content and will not be reviewed.',
        code: 'NO_APP_DRAFT_CONTENT',
        section: section.section_title,
      }
    }

    // If this is a revision, get the previous section's review. The explicit
    // previous_section_id is authoritative — it records the draft the user
    // chose to revise, which is not always the highest earlier version.
    let previousSection = null

    if (section.previous_section_id) {
      const linked = await prisma.$queryRaw`
        SELECT * FROM "reviewer_sections"
        WHERE id = ${section.previous_section_id} AND call_id = ${callId}
      `
      if (Array.isArray(linked) && linked.length > 0) {
        previousSection = linked[0]
      }
    }

    if (!previousSection && section.version && section.version > 1) {
      const prevSections = await prisma.$queryRaw`
        SELECT * FROM "reviewer_sections"
        WHERE call_id = ${callId}
        AND section_title = ${section.section_title}
        AND version < ${section.version}
        ORDER BY version DESC
        LIMIT 1
      `
      if (Array.isArray(prevSections) && prevSections.length > 0) {
        previousSection = prevSections[0]
      }
    }

    // A reviewed earlier draft is what makes this a revision review; an
    // unreviewed one carries no remarks to compare against.
    if (previousSection && previousSection.status !== 'reviewed') {
      console.log(`Previous version of ${section.section_title} was never reviewed; treating this as a first review.`)
      previousSection = null
    }

    if (previousSection) {
      console.log(`Found previous version of section: ${previousSection.section_title} (version ${previousSection.version})`)
    }

    let contextSection = null
    let relevantSummaries = []
    let priorSectionSummaries = []

    const contextSectionIds = input.contextSectionIds
    const hasExplicitContextSectionIds = Array.isArray(contextSectionIds)

    // One row per title (the newest reviewed version) and never this section's
    // own title. Superseded v1 rows keep status 'reviewed', so without
    // DISTINCT ON the v1 and v2 summaries of the same section both entered the
    // prompt and contradicted each other.
    if (hasExplicitContextSectionIds && contextSectionIds.length > 0) {
      const contextSections = await prisma.$queryRaw`
        SELECT DISTINCT ON (section_title) id, section_title, context_summary, "mappingJson"
        FROM "reviewer_sections"
        WHERE call_id = ${callId}
        AND section_title = ANY(${contextSectionIds}::text[])
        AND section_title <> ${section.section_title}
        AND status = 'reviewed'
        AND context_summary IS NOT NULL
        ORDER BY section_title, version DESC, last_reviewed_at DESC
      `

      if (Array.isArray(contextSections) && contextSections.length > 0) {
        for (const cs of contextSections) {
          if (cs.context_summary && hasAppDraftReviewerLink(cs)) {
            priorSectionSummaries.push({
              section_title: cs.section_title,
              context_summary: cs.context_summary,
            })
          }
        }
      }

      console.log(`Found ${priorSectionSummaries.length} prior section summaries for context`)
    } else if (!hasExplicitContextSectionIds) {
      const contextSections = await prisma.$queryRaw`
        SELECT id, section_title, context_summary, "mappingJson", last_reviewed_at
        FROM (
          SELECT DISTINCT ON (section_title) id, section_title, context_summary, "mappingJson", last_reviewed_at
          FROM "reviewer_sections"
          WHERE call_id = ${callId}
          AND section_title <> ${section.section_title}
          AND status = 'reviewed'
          AND context_summary IS NOT NULL
          ORDER BY section_title, version DESC, last_reviewed_at DESC
        ) newest
        ORDER BY last_reviewed_at ASC
      `

      if (Array.isArray(contextSections) && contextSections.length > 0) {
        for (const cs of contextSections) {
          if (cs.context_summary && hasAppDraftReviewerLink(cs)) {
            priorSectionSummaries.push({
              section_title: cs.section_title,
              context_summary: cs.context_summary,
            })
          }
        }
      }

      console.log(`Found ${priorSectionSummaries.length} available app-draft summaries for context`)
    }

    relevantSummaries = filterRelevantContextSummaries(section.section_title, priorSectionSummaries)
    console.log(`Using ${relevantSummaries.length} filtered relevant summaries for context`)

    if (relevantSummaries.length === 0 && priorSectionSummaries.length === 0) {
      if (section.review_linked_context) {
        const contextSectionResult = await prisma.$queryRaw`
          SELECT id, section_title, context_summary, "mappingJson"
          FROM "reviewer_sections"
          WHERE call_id = ${callId}
          AND id != ${sectionId}
          AND status = 'reviewed'
          AND context_summary IS NOT NULL
          ORDER BY last_reviewed_at DESC
          LIMIT 1
        `

        if (
          Array.isArray(contextSectionResult) &&
          contextSectionResult.length > 0 &&
          hasAppDraftReviewerLink(contextSectionResult[0])
        ) {
          contextSection = contextSectionResult[0]
          console.log(`Using fallback context section: ${contextSection.section_title}`)
        }
      }
    }

    // Hold a quota slot before spending on the model. The slot is released
    // again if the review fails, so a failed run costs the tenant nothing.
    let usageReservation
    try {
      usageReservation = await reserveReviewerUsage({
        callId,
        operationId: reviewerSectionOperationId(sectionId, section.version),
        operationType: 'reviewer_section_review',
        metadata: { sectionTitle: section.section_title, version: section.version ?? 1 },
      })
    } catch (quotaError) {
      if (quotaError instanceof ServiceQuotaExceededError) {
        return {
          ok: false,
          status: 429,
          error: quotaError.message,
          code: quotaError.code,
          section: section.section_title,
        }
      }
      throw quotaError
    }

    console.log(`Starting AI review for ${section.section_title}`)

    // Figures, charts or workbooks attached to this section.
    let linkedAssets: { google_file_id: string }[] = []
    try {
      const links: any[] = await prisma.reviewAssetLink.findMany({
        where: { review_version_id: sectionId, attach_in_prompt: true },
        orderBy: { order: 'asc' },
      })
      const assetIds = links.map((l) => l.asset_id)
      if (assetIds.length > 0) {
        const assets: any[] = await prisma.reviewAsset.findMany({ where: { id: { in: assetIds } } })
        for (const asset of assets) {
          let googleId = asset.google_file_id
          if (!googleId) {
            try {
              const resp = await fetch(`${process.env.NEXTAUTH_URL || ''}/api/reviewer/assets/ensure-google-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asset_id: asset.id }),
              })
              if (resp.ok) {
                const data = await resp.json()
                googleId = data.google_file_id
              }
            } catch (e) {
              console.warn('Failed to ensure google file id for asset', asset.id, e)
            }
          }
          if (googleId) linkedAssets.push({ google_file_id: googleId })
        }
      }
    } catch (e) {
      console.warn('Failed to load linked assets', e)
    }

    try {
      // Every section goes through the configured Grant Reviewer, whatever the
      // call's rules source.
      const reviewResult = await reviewSection({
        section,
        previousSection,
        contextSection,
        priorSectionSummaries: relevantSummaries.length > 0 ? relevantSummaries : undefined,
        callData: {
          ...callData,
          project_title: projectTitle,
        },
        modelType: 'G',
        ...input.llm,
        stageCode: 'GRANT_REVIEWER_FULL_REVIEW',
        callId,
        attachments: linkedAssets,
      })

      console.log(`AI review completed for ${section.section_title}`)

      let contextSummary = reviewResult.review.context_summary
      if (!contextSummary || contextSummary === 'Not Available') {
        // Only pay for a separate summarisation call when another section will
        // actually read this one as review context.
        const siblingTitles: any[] = await prisma.$queryRaw`
          SELECT section_title FROM "reviewer_sections" WHERE call_id = ${callId}
        `
        const isContextProvider = selectContextProviderTitles(
          (Array.isArray(siblingTitles) ? siblingTitles : []).map((row: any) => row.section_title)
        ).has(section.section_title)

        if (isContextProvider) {
          try {
            console.log(`Generating separate context summary for ${section.section_title}`)
            const contextSummaryService = new ContextSummaryService({
              ...input.llm,
              stageCode: 'GRANT_REVIEWER_CONTEXT_SUMMARY',
            })
            contextSummary = await contextSummaryService.generateContextSummary(
              section.section_title,
              section.user_input,
              'G'
            )
          } catch (error) {
            console.error('Error generating context summary:', error)
            contextSummary = 'Not Available'
          }
        } else {
          contextSummary = buildFallbackContextSummary(section.user_input) || 'Not Available'
        }
      }

      // Carry forward anything the review itself does not produce. A
      // `revision_comparison` computed before this review ran lives in the same
      // column and was being wiped by a blind overwrite.
      const priorReviewJson =
        section.ai_review_json && typeof section.ai_review_json === 'object' ? section.ai_review_json : {}
      const mergedReviewJson = { ...reviewResult.review }
      if (priorReviewJson.revision_comparison && !mergedReviewJson.revision_comparison) {
        mergedReviewJson.revision_comparison = priorReviewJson.revision_comparison
      }
      mergedReviewJson.reviewed_input_hash = sectionContentHash(section.user_input)

      await prisma.$executeRaw`
        UPDATE "reviewer_sections"
        SET
          ai_review_json = ${mergedReviewJson},
          status = 'reviewed',
          "sourceStale" = false,
          last_reviewed_at = CURRENT_TIMESTAMP,
          improvement_flag = ${previousSection ? Boolean(reviewResult.isImprovement) : null},
          context_summary = ${contextSummary}
        WHERE id = ${sectionId}
      `

      console.log(`Database updated for ${section.section_title}`)

      // Progress is recorded on success, not on attempt.
      const progressState = {
        last_reviewed_section: section.section_title,
        last_reviewed_section_id: sectionId,
        version: section.version ?? 1,
        timestamp: new Date().toISOString(),
      }
      await prisma.$executeRaw`
        UPDATE "reviewer_calls"
        SET review_progress_state = ${progressState}::jsonb
        WHERE id = ${callId}
      `.catch((progressError) => console.warn('Could not record review progress:', progressError))

      await completeReviewerUsage(usageReservation, {
        sectionId,
        sectionTitle: section.section_title,
        version: section.version ?? 1,
      }).catch((usageError) => {
        console.error('Failed to record reviewer usage:', usageError)
      })

      return {
        ok: true,
        review: mergedReviewJson,
        contextSummary,
        priorSectionSummaries,
        skippedUnchanged: false,
      }
    } catch (reviewError: any) {
      console.error(`Error in AI review process for ${section.section_title}:`, reviewError)
      await releaseReviewerUsage(usageReservation).catch(() => undefined)
      if (isGeminiRateLimitErrorLike(reviewError)) {
        const retryAfterMs = getGeminiRetryAfterMs(reviewError)
        return {
          ok: false,
          status: 429,
          error: `Failed to review section: ${reviewError.message || 'Gemini rate limited'}`,
          code: 'GEMINI_RATE_LIMITED',
          retryAfterMs: retryAfterMs || 60000,
          section: section.section_title,
        }
      }
      return {
        ok: false,
        status: 500,
        error: `Failed to review section: ${reviewError.message || 'Unknown error'}`,
        section: section.section_title,
      }
    }
  } catch (error) {
    console.error('Error reviewing section:', error)
    return { ok: false, status: 500, error: 'Failed to review section' }
  }
}
