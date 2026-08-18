// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService';
import { buildFallbackContextSummary, hasMeaningfulSectionContent } from '@/lib/reviewer/content';
import { ensureCurrentReport } from '@/lib/reviewer/reportGeneration';
import {
  completeReviewerUsage,
  releaseReviewerUsage,
  reserveReviewerUsage,
  reviewerSectionOperationId,
  ServiceQuotaExceededError,
} from '@/lib/reviewer/usage';
import prisma from '../../../../../../../lib/prisma';
import {
  reviewSection,
  filterRelevantContextSummaries,
  selectContextProviderTitles
} from '../../../../../../../lib/reviewerService';
import { ContextSummaryService } from '../../../../../../../lib/services/contextSummaryService';

function hasAppDraftReviewerLink(section: any): boolean {
  const mappingJson = section?.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {};
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : [];
  const declaresWorkflow = linkedSections.some((link: any) => typeof link?.workflowMode === 'string');
  return !declaresWorkflow || linkedSections.some((link: any) => String(link?.workflowMode || 'app_draft') === 'app_draft');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  
  // Get the user session
  const session = await getServerSession(req, res);
  
  // Check authentication
  if (!session || !session.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Get the call ID and section ID from the URL
  const callId = req.query.id as string;
  const sectionId = req.query.sectionId as string;
  
  if (!callId || !sectionId) {
    return res.status(400).json({ error: 'Call ID and Section ID are required' });
  }
  
  try {
    const callAccess = await requireReviewerCallAccess(callId, session, res, 'editContent');
    if (!callAccess) return;
    
    // Get the section to review
    const sections = await prisma.$queryRaw`
      SELECT * FROM "reviewer_sections" 
      WHERE id = ${sectionId} AND call_id = ${callId}
    `;
    
    if (!sections || Array.isArray(sections) && sections.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const section = sections[0];
    console.log(`Processing review for section: ${section.section_title} (ID: ${sectionId})`);
    
    // Only allow review of draft sections
    if (section.status !== 'draft') {
      return res.status(400).json({ error: 'Section has already been reviewed' });
    }

    if (!hasMeaningfulSectionContent(section.user_input)) {
      return res.status(400).json({
        error: 'Section has no meaningful content to review',
        code: 'SECTION_CONTENT_MISSING',
        section: section.section_title,
      });
    }
    
    // Get the AI model to use from call record
    const callsWithModel = await prisma.$queryRaw`
      SELECT "LLM_model_used", parsed_json, project_title, "manualRubricJson", "templateSnapshotJson", "rulesSource" FROM "reviewer_calls" 
      WHERE id = ${callId}
    `;
    
    const callData = callsWithModel[0].parsed_json || {};
    const projectTitle = callsWithModel[0].project_title;

    // A section mapped only to non-app-draft workflow content has nothing for
    // the reviewer to score.
    const mappingJson = section.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {};
    const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : [];
    const linksDeclareWorkflow = linkedSections.some((link: any) => typeof link.workflowMode === 'string');
    const hasAppDraftLink = linkedSections.some((link: any) => String(link.workflowMode || 'app_draft') === 'app_draft');
    if (linksDeclareWorkflow && !hasAppDraftLink) {
      return res.status(400).json({
        error: 'This reviewer section is not linked to app-draft content and will not be reviewed.',
        code: 'NO_APP_DRAFT_CONTENT',
        section: section.section_title,
      });
    }

    // If this is a revision, get the previous section's review. The explicit
    // previous_section_id is authoritative — it records the draft the user
    // chose to revise, which is not always the highest earlier version.
    let previousSection = null;

    if (section.previous_section_id) {
      const linked = await prisma.$queryRaw`
        SELECT * FROM "reviewer_sections"
        WHERE id = ${section.previous_section_id} AND call_id = ${callId}
      `;
      if (Array.isArray(linked) && linked.length > 0) {
        previousSection = linked[0];
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
      `;

      if (Array.isArray(prevSections) && prevSections.length > 0) {
        previousSection = prevSections[0];
      }
    }

    // A reviewed earlier draft is what makes this a revision review; an
    // unreviewed one carries no remarks to compare against.
    if (previousSection && previousSection.status !== 'reviewed') {
      console.log(`Previous version of ${section.section_title} was never reviewed; treating this as a first review.`);
      previousSection = null;
    }

    if (previousSection) {
      console.log(`Found previous version of section: ${previousSection.section_title} (version ${previousSection.version})`);
    }
    
    // Get relevant context from other sections
    let contextSection = null;
    let relevantSummaries = [];
    
    // Get sections that should be used for context based on their position in the review flow
    let priorSectionSummaries = [];
    
    // Check if context section IDs were specified in the request
    let contextSectionIds = [];
    const hasExplicitContextSectionIds = req.body.contextSectionIds && Array.isArray(req.body.contextSectionIds);
    if (hasExplicitContextSectionIds) {
      contextSectionIds = req.body.contextSectionIds;
      console.log(`Using context from specified sections: ${contextSectionIds.join(', ')}`);
    } else {
      console.log('Using context from available reviewed app-draft summaries');
    }
    
    // Fetch available context summaries
    if (hasExplicitContextSectionIds && contextSectionIds.length > 0) {
      const contextSections = await prisma.$queryRaw`
        SELECT id, section_title, context_summary, "mappingJson"
        FROM "reviewer_sections" 
        WHERE call_id = ${callId} 
        AND section_title = ANY(${contextSectionIds}::text[])
        AND context_summary IS NOT NULL
      `;
      
      if (Array.isArray(contextSections) && contextSections.length > 0) {
        for (const cs of contextSections) {
          if (cs.context_summary && hasAppDraftReviewerLink(cs)) {
            priorSectionSummaries.push({
              section_title: cs.section_title,
              context_summary: cs.context_summary
            });
          }
        }
      }
      
      console.log(`Found ${priorSectionSummaries.length} prior section summaries for context`);
    } else if (!hasExplicitContextSectionIds) {
      const contextSections = await prisma.$queryRaw`
        SELECT id, section_title, context_summary, "mappingJson"
        FROM "reviewer_sections" 
        WHERE call_id = ${callId} 
        AND id != ${sectionId}
        AND status = 'reviewed'
        AND context_summary IS NOT NULL
        ORDER BY last_reviewed_at ASC
      `;

      if (Array.isArray(contextSections) && contextSections.length > 0) {
        for (const cs of contextSections) {
          if (cs.context_summary && hasAppDraftReviewerLink(cs)) {
            priorSectionSummaries.push({
              section_title: cs.section_title,
              context_summary: cs.context_summary
            });
          }
        }
      }

      console.log(`Found ${priorSectionSummaries.length} available app-draft summaries for context`);
    }
    
    // Filter the summaries to find relevant ones for this section title
    // This uses domain knowledge about which sections are relevant to each other
    relevantSummaries = filterRelevantContextSummaries(section.section_title, priorSectionSummaries);
    console.log(`Using ${relevantSummaries.length} filtered relevant summaries for context`);
    
    if (relevantSummaries.length === 0 && priorSectionSummaries.length === 0) {
      if (section.review_linked_context) {
        // Get most recently reviewed section
        const contextSectionResult = await prisma.$queryRaw`
          SELECT id, section_title, context_summary, "mappingJson"
          FROM "reviewer_sections" 
          WHERE call_id = ${callId} 
          AND id != ${sectionId} 
          AND status = 'reviewed'
          AND context_summary IS NOT NULL
          ORDER BY last_reviewed_at DESC
          LIMIT 1
        `;
        
        if (
          Array.isArray(contextSectionResult)
          && contextSectionResult.length > 0
          && hasAppDraftReviewerLink(contextSectionResult[0])
        ) {
          contextSection = contextSectionResult[0];
          console.log(`Using fallback context section: ${contextSection.section_title}`);
        }
      }
    }
    
    // Store resume state for future recovery of the review process
    const progressState = {
      last_reviewed_section: section.section_title,
      last_reviewed_section_id: sectionId,
      timestamp: new Date().toISOString()
    };
    
    await prisma.$executeRaw`
      UPDATE "reviewer_calls"
      SET review_progress_state = ${progressState}::jsonb
      WHERE id = ${callId}
    `;
    
    // Hold a quota slot before spending on the model. The slot is released
    // again if the review fails, so a failed run costs the tenant nothing.
    let usageReservation;
    try {
      usageReservation = await reserveReviewerUsage({
        callId,
        operationId: reviewerSectionOperationId(sectionId, section.version),
        operationType: 'reviewer_section_review',
        metadata: { sectionTitle: section.section_title, version: section.version ?? 1 },
      });
    } catch (quotaError) {
      if (quotaError instanceof ServiceQuotaExceededError) {
        return res.status(429).json({
          error: quotaError.message,
          code: quotaError.code,
          section: section.section_title,
        });
      }
      throw quotaError;
    }

    console.log(`Starting AI review for ${section.section_title}`);

    // Figures, charts or workbooks the user attached to this section. Any
    // section may carry them — the title whitelist this used to apply meant an
    // uploaded figure on, say, "Expected Outcomes" was accepted by the UI and
    // then silently ignored by the review.
    let linkedAssets: { google_file_id: string }[] = [];
    try {
      const links: any[] = await prisma.reviewAssetLink.findMany({ where: { review_version_id: sectionId, attach_in_prompt: true }, orderBy: { order: 'asc' } });
      const assetIds = links.map(l => l.asset_id);
      if (assetIds.length > 0) {
        const assets: any[] = await prisma.reviewAsset.findMany({ where: { id: { in: assetIds } } });
        // Ensure google file id for each asset
        for (const asset of assets) {
          let googleId = asset.google_file_id;
          if (!googleId) {
            // Call API to ensure google file id
            try {
              const resp = await fetch(`${process.env.NEXTAUTH_URL || ''}/api/reviewer/assets/ensure-google-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asset_id: asset.id }),
              });
              if (resp.ok) {
                const data = await resp.json();
                googleId = data.google_file_id;
              }
            } catch (e) {
              console.warn('Failed to ensure google file id for asset', asset.id, e);
            }
          }
          if (googleId) linkedAssets.push({ google_file_id: googleId });
        }
      }
    } catch (e) {
      console.warn('Failed to load linked assets', e);
    }
    
    try {
      // Every section goes through the configured Grant Reviewer, whatever the
      // call's rules source.
      //
      // This replaced nine hardcoded per-title reviewers (abstract,
      // introduction, objectives, literature, methodology, timeline, budget,
      // outcomes, conclusion) that ran whenever the call was not
      // template-backed — which is three of the four rules sources, including
      // every URL-ingested call. They received only a context blurb, never the
      // prompt scope, so the section page displayed rules the model was never
      // given. They also dropped `addressed_previous_points`, which is what the
      // revision comparison is derived from, forcing a second paid model call
      // on every revision.
      const reviewResult = await reviewSection({
        section,
        previousSection,
        contextSection,
        priorSectionSummaries: relevantSummaries.length > 0 ? relevantSummaries : undefined,
        callData: {
          ...callData,
          project_title: projectTitle
        },
        modelType: 'G',
        requestHeaders: req.headers,
        stageCode: 'GRANT_REVIEWER_FULL_REVIEW',
        callId,
        attachments: linkedAssets,
      });


      console.log(`AI review completed for ${section.section_title}`);

      // Extract the context summary from the review result or generate if not available
      let contextSummary = reviewResult.review.context_summary;
      if (!contextSummary || contextSummary === "Not Available") {
        // The review normally returns its own context_summary. Only pay for a
        // separate summarisation call when another section will actually read
        // this one as review context; otherwise fall back to the draft's own
        // opening, which is all the reviewer would use it for.
        const siblingTitles: any[] = await prisma.$queryRaw`
          SELECT section_title FROM "reviewer_sections" WHERE call_id = ${callId}
        `;
        const isContextProvider = selectContextProviderTitles(
          (Array.isArray(siblingTitles) ? siblingTitles : []).map((row: any) => row.section_title)
        ).has(section.section_title);

        if (isContextProvider) {
          try {
            console.log(`Generating separate context summary for ${section.section_title} using Grant Reviewer context-summary model`);
            const contextSummaryService = new ContextSummaryService({
              requestHeaders: req.headers,
              stageCode: 'GRANT_REVIEWER_CONTEXT_SUMMARY',
            });
            contextSummary = await contextSummaryService.generateContextSummary(
              section.section_title,
              section.user_input,
              'G'
            );
          } catch (error) {
            console.error('Error generating context summary:', error);
            contextSummary = 'Not Available';
          }
        } else {
          contextSummary = buildFallbackContextSummary(section.user_input) || 'Not Available';
        }
      }
      
      console.log(`Context summary for ${section.section_title}: ${contextSummary.substring(0, 50)}...`);
      
      // Carry forward anything the review itself does not produce. A
      // `revision_comparison` computed (and paid for) before this review ran
      // lives in the same column and was being wiped by a blind overwrite.
      const priorReviewJson = section.ai_review_json && typeof section.ai_review_json === 'object'
        ? section.ai_review_json
        : {};
      const mergedReviewJson = { ...reviewResult.review };
      if (priorReviewJson.revision_comparison && !mergedReviewJson.revision_comparison) {
        mergedReviewJson.revision_comparison = priorReviewJson.revision_comparison;
      }

      // Update the section with the review result and context summary
      await prisma.$queryRaw`
        UPDATE "reviewer_sections"
        SET
          ai_review_json = ${mergedReviewJson},
          status = 'reviewed',
          "sourceStale" = false,
          last_reviewed_at = CURRENT_TIMESTAMP,
          improvement_flag = ${previousSection ? Boolean(reviewResult.isImprovement) : null},
          context_summary = ${contextSummary}
        WHERE id = ${sectionId}
      `;

      console.log(`Database updated for ${section.section_title}`);

      // The review landed, so the reserved slot becomes a counted run.
      await completeReviewerUsage(usageReservation, {
        sectionId,
        sectionTitle: section.section_title,
        version: section.version ?? 1,
      }).catch(usageError => {
        console.error('Failed to record reviewer usage:', usageError);
      });

      // Bring the panel report back in line with what was just reviewed.
      //
      // Reviewing a revision used to leave the stored report describing the
      // superseded draft: the workspace flagged it "out of date" and then
      // waited for someone to notice and press Regenerate. Anyone who exported
      // the ATR in between got the old verdict with no warning.
      //
      // Only workspaces that already have a report are refreshed — a first
      // section review must not conjure a panel verdict off one section. The
      // full auto-run passes `skipReportRefresh` because it compiles the report
      // once at the end; without that every section in the run would pay for a
      // whole report.
      let reportRefreshed = false;
      let reportRefreshError = null;
      if (req.body?.skipReportRefresh !== true) {
        const refresh = await ensureCurrentReport(callId, { createIfMissing: false });
        reportRefreshed = refresh.regenerated;
        reportRefreshError = refresh.error;
      }

      // Return success with the review data
      return res.status(200).json({
        message: 'Section reviewed successfully',
        review: mergedReviewJson,
        context_summary: contextSummary,
        prior_section_summaries: priorSectionSummaries,
        report_refreshed: reportRefreshed,
        report_refresh_error: reportRefreshError,
      });
    } catch (reviewError) {
      console.error(`Error in AI review process for ${section.section_title}:`, reviewError);
      await releaseReviewerUsage(usageReservation).catch(() => undefined);
      if (isGeminiRateLimitErrorLike(reviewError)) {
        const retryAfterMs = getGeminiRetryAfterMs(reviewError);
        return res
          .status(429)
          .setHeader('Retry-After', String(Math.max(1, Math.ceil((retryAfterMs || 60000) / 1000))))
          .json({
            error: `Failed to review section: ${reviewError.message || 'Gemini rate limited'}`,
            code: 'GEMINI_RATE_LIMITED',
            retryAfterMs: retryAfterMs || 60000,
            section: section.section_title
          });
      }
      return res.status(500).json({ 
        error: `Failed to review section: ${reviewError.message || 'Unknown error'}`,
        section: section.section_title
      });
    }
  } catch (error) {
    console.error('Error reviewing section:', error);
    return res.status(500).json({ error: 'Failed to review section' });
  }
} 
