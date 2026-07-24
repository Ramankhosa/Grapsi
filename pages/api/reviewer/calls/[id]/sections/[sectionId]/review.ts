// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService';
import { buildFallbackContextSummary, hasMeaningfulSectionContent, parseReviewerScore } from '@/lib/reviewer/content';
import prisma from '../../../../../../../lib/prisma';
import {
  reviewSection,
  getSectionPosition,
  SECTION_ORDER,
  SECTION_DEPENDENCIES,
  filterRelevantContextSummaries,
  selectContextProviderTitles
} from '../../../../../../../lib/reviewerService';
import { ContextSummaryService } from '../../../../../../../lib/services/contextSummaryService';
import { ReviewerService } from '../../../../../../../lib/services/reviewerService';

// Export SECTION_ORDER and getSectionPosition from reviewerService.ts

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
    const normalizedSectionTitle = String(section.section_title || '').trim().toLowerCase();
    
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
    
    // Always use Gemini 2.0 Flash regardless of what's stored in the database
    const model = 'G'; // Force Gemini for all reviews
    const callData = callsWithModel[0].parsed_json || {};
    const useTemplateBackedReviewer =
      callsWithModel[0].rulesSource === 'template_manual'
      || callData.rules_source === 'template_manual'
      || Array.isArray(callData.template_sections);
    const reviewerContextText = callData.reviewer_context_text || callData.call_summary || callData.agency_name || "Funding opportunity";
    const projectTitle = callsWithModel[0].project_title;

    if (useTemplateBackedReviewer) {
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
    }
    
    console.log(`Using ${useTemplateBackedReviewer ? 'configured Grant Reviewer full-review model' : 'legacy specialized reviewer model'} for review of ${section.section_title}`);
    
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
    
    console.log(`Starting AI review for ${section.section_title}`);

    // Load assets linked to this section (only for Methodology, Project Timeline, Budget Justification)
    let linkedAssets: { google_file_id: string }[] = [];
    try {
      const isTargetSection = ['method', 'timeline', 'budget'].some(k => normalizedSectionTitle.includes(k));
      if (isTargetSection) {
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
      }
    } catch (e) {
      console.warn('Failed to load linked assets', e);
    }
    
    try {
      // Initialize the reviewer service
      const reviewerService = new ReviewerService();
      
      // Determine which review function to use based on section title
      let reviewResult;
      // normalizedSectionTitle declared earlier
      
      if (!useTemplateBackedReviewer && normalizedSectionTitle.includes('abstract')) {
        console.log('Using specialized Abstract review function with Gemini 2.0 Flash');
        
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const abstractReview = await reviewerService.generateAbstractReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          previousVersion
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(abstractReview.section_score),
            summary: abstractReview.section_summary || "No summary provided.",
            strengths: abstractReview.section_strengths || [],
            weaknesses: abstractReview.section_weaknesses || [],
            suggestions: abstractReview.suggestions_for_improvement || [],
            improvement_over_previous: abstractReview.improvement_over_previous || false,
            context_summary: abstractReview.context_summary || "Not available"
          },
          isImprovement: abstractReview.improvement_over_previous || false
        };
      } else if (!useTemplateBackedReviewer && normalizedSectionTitle.includes('introduction')) {
        console.log('Using specialized Introduction review function with Gemini 2.0 Flash');
        
        const abstractSummary = relevantSummaries.find(s => 
          s.section_title.toLowerCase().includes('abstract'))?.context_summary;
          
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const introReview = await reviewerService.generateIntroductionReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          abstractSummary,
          previousVersion
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(introReview.score),
            summary: introReview.summary || "No summary provided.",
            strengths: introReview.strengths || [],
            weaknesses: introReview.weaknesses || [],
            suggestions: introReview.suggestions || [],
            improvement_over_previous: introReview.improvement_over_previous || false,
            context_summary: introReview.context_summary || "Not available"
          },
          isImprovement: introReview.improvement_over_previous || false
        };
      } else if (!useTemplateBackedReviewer && normalizedSectionTitle.includes('objective')) {
        console.log('Using specialized Objectives review function with Gemini 2.0 Flash');
        try {
          // Check if this is a revision and get previous version data
          let previousVersion = null;
          if (previousSection) {
            previousVersion = {
              content: previousSection.user_input,
              review: previousSection.ai_review_json
            };
          }
          
          const objectivesReview = await reviewerService.generateObjectivesReview(
            section.user_input,
            projectTitle,
            reviewerContextText,
            'G', // Force Gemini for all reviews
            relevantSummaries,
            previousVersion
          );
          
          console.log('Objectives review generated successfully');
          console.log('Objectives review score:', objectivesReview.score);
          
          if (!objectivesReview || !objectivesReview.score) {
            console.error('Invalid objectives review generated:', objectivesReview);
            throw new Error('Generated objectives review is invalid');
          }
          
          // Convert to standard review format
          reviewResult = {
            review: {
              score: parseReviewerScore(objectivesReview.score),
              summary: objectivesReview.summary || "No summary provided.",
              strengths: objectivesReview.strengths || [],
              weaknesses: objectivesReview.weaknesses || [],
              suggestions: objectivesReview.suggestions || [],
              improvement_over_previous: objectivesReview.improvement_over_previous || false,
              context_summary: objectivesReview.context_summary || "Not available"
            },
            isImprovement: objectivesReview.improvement_over_previous || false
          };
        } catch (objectivesError) {
          console.error('Error generating objectives review:', objectivesError);
          throw objectivesError;
        }
      } else if (!useTemplateBackedReviewer && normalizedSectionTitle.includes('literature')) {
        console.log('Using specialized Literature Review review function with Gemini 2.0 Flash');
        
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const litReview = await reviewerService.generateLiteratureReviewReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          relevantSummaries,
          previousVersion
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(litReview.score),
            summary: litReview.summary || "No summary provided.",
            strengths: litReview.strengths || [],
            weaknesses: litReview.weaknesses || [],
            suggestions: litReview.suggestions || [],
            improvement_over_previous: litReview.improvement_over_previous || false,
            context_summary: litReview.context_summary || "Not available"
          },
          isImprovement: litReview.improvement_over_previous || false
        };
      } else if (!useTemplateBackedReviewer && normalizedSectionTitle.includes('method')) {
        console.log('Using specialized Methodology review function with Gemini 2.0 Flash');
        
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const methodReview = await reviewerService.generateMethodologyReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          relevantSummaries,
          previousVersion,
          linkedAssets.map(a => a.google_file_id)
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(methodReview.score),
            summary: methodReview.summary || "No summary provided.",
            strengths: methodReview.strengths || [],
            weaknesses: methodReview.weaknesses || [],
            suggestions: methodReview.suggestions || [],
            improvement_over_previous: methodReview.improvement_over_previous || false,
            context_summary: methodReview.context_summary || "Not available"
          },
          isImprovement: methodReview.improvement_over_previous || false
        };
      } else if (!useTemplateBackedReviewer && (normalizedSectionTitle.includes('timeline') || normalizedSectionTitle.includes('schedule'))) {
        console.log('Using specialized Project Timeline review function with Gemini 2.0 Flash');
        
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const timelineReview = await reviewerService.generateProjectTimelineReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          relevantSummaries,
          previousVersion,
          linkedAssets.map(a => a.google_file_id)
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(timelineReview.score),
            summary: timelineReview.summary || "No summary provided.",
            strengths: timelineReview.strengths || [],
            weaknesses: timelineReview.weaknesses || [],
            suggestions: timelineReview.suggestions || [],
            improvement_over_previous: timelineReview.improvement_over_previous || false,
            context_summary: timelineReview.context_summary || "Not available"
          },
          isImprovement: timelineReview.improvement_over_previous || false
        };
      } else if (!useTemplateBackedReviewer && normalizedSectionTitle.includes('budget')) {
        console.log('Using specialized Budget Justification review function with Gemini 2.0 Flash');
        
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const budgetReview = await reviewerService.generateBudgetJustificationReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          relevantSummaries,
          previousVersion,
          linkedAssets.map(a => a.google_file_id)
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(budgetReview.score),
            summary: budgetReview.summary || "No summary provided.",
            strengths: budgetReview.strengths || [],
            weaknesses: budgetReview.weaknesses || [],
            suggestions: budgetReview.suggestions || [],
            non_scoring_reminders: budgetReview.non_scoring_reminders || [],
            supplementary_materials: budgetReview.supplementary_materials || [],
            improvement_over_previous: budgetReview.improvement_over_previous || false,
            context_summary: budgetReview.context_summary || "Not available"
          },
          isImprovement: budgetReview.improvement_over_previous || false
        };
      } else if (!useTemplateBackedReviewer && (normalizedSectionTitle.includes('outcome') || normalizedSectionTitle.includes('result'))) {
        console.log('Using specialized Expected Outcomes review function with Gemini 2.0 Flash');
        
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const outcomesReview = await reviewerService.generateExpectedOutcomesReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          relevantSummaries,
          previousVersion
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(outcomesReview.score),
            summary: outcomesReview.summary || "No summary provided.",
            strengths: outcomesReview.strengths || [],
            weaknesses: outcomesReview.weaknesses || [],
            suggestions: outcomesReview.suggestions || [],
            improvement_over_previous: outcomesReview.improvement_over_previous || false,
            context_summary: outcomesReview.context_summary || "Not available"
          },
          isImprovement: outcomesReview.improvement_over_previous || false
        };
      } else if (!useTemplateBackedReviewer && (normalizedSectionTitle.includes('conclusion') || normalizedSectionTitle.includes('summary'))) {
        console.log('Using specialized Conclusion review function with Gemini 2.0 Flash');
        
        // Check if this is a revision and get previous version data
        let previousVersion = null;
        if (previousSection) {
          previousVersion = {
            content: previousSection.user_input,
            review: previousSection.ai_review_json
          };
        }
        
        const conclusionReview = await reviewerService.generateConclusionReview(
          section.user_input,
          projectTitle,
          reviewerContextText,
          'G', // Force Gemini for all reviews
          relevantSummaries,
          previousVersion
        );
        
        // Convert to standard review format
        reviewResult = {
          review: {
            score: parseReviewerScore(conclusionReview.score),
            summary: conclusionReview.summary || "No summary provided.",
            strengths: conclusionReview.strengths || [],
            weaknesses: conclusionReview.weaknesses || [],
            suggestions: conclusionReview.suggestions || [],
            improvement_over_previous: conclusionReview.improvement_over_previous || false,
            context_summary: conclusionReview.context_summary || "Not available"
          },
          isImprovement: conclusionReview.improvement_over_previous || false
        };
      } else {
        // Use the generic review function for other sections
        console.log('Using configured Grant Reviewer full-review function');
        reviewResult = await reviewSection({
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
        });
      }

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
      
      // Update the section with the review result and context summary
      await prisma.$queryRaw`
        UPDATE "reviewer_sections" 
        SET 
          ai_review_json = ${reviewResult.review},
          status = 'reviewed',
          "sourceStale" = false,
          last_reviewed_at = CURRENT_TIMESTAMP,
          improvement_flag = ${reviewResult.isImprovement || null},
          context_summary = ${contextSummary}
        WHERE id = ${sectionId}
      `;
      
      console.log(`Database updated for ${section.section_title}`);
      
      // Update review progress state to mark this section as reviewed
      try {
        const callData = await prisma.$queryRaw`
          SELECT review_progress_state FROM "reviewer_calls" WHERE id = ${callId}
        `;
        
        if (callData && Array.isArray(callData) && callData.length > 0) {
          let progressState = callData[0].review_progress_state || {};
          
          // Update the progress state based on section title
          if (normalizedSectionTitle.includes('abstract')) {
            progressState.abstract_reviewed = true;
          } else if (normalizedSectionTitle.includes('introduction')) {
            progressState.introduction_reviewed = true;
          } else if (normalizedSectionTitle.includes('objective')) {
            progressState.objectives_reviewed = true;
          } else if (normalizedSectionTitle.includes('literature')) {
            progressState.literature_reviewed = true;
          } else if (normalizedSectionTitle.includes('method')) {
            progressState.methodology_reviewed = true;
          } else if (normalizedSectionTitle.includes('budget')) {
            progressState.budget_reviewed = true;
          } else if (normalizedSectionTitle.includes('outcome')) {
            progressState.outcomes_reviewed = true;
          }
          
          // Always update the last section reviewed
          progressState.last_section_reviewed = section.section_title;
          progressState.last_review_timestamp = new Date().toISOString();
          
          await prisma.$queryRaw`
            UPDATE "reviewer_calls"
            SET review_progress_state = ${progressState}
            WHERE id = ${callId}
          `;
          
          console.log(`Updated call review progress state for ${section.section_title}`);
        }
      } catch (progressError) {
        console.error(`Error updating progress state for ${section.section_title}:`, progressError);
        // Don't fail the request if progress state update fails
      }
      
      // Return success with the review data
      return res.status(200).json({ 
        message: 'Section reviewed successfully',
        review: reviewResult.review,
        context_summary: contextSummary,
        prior_section_summaries: priorSectionSummaries
      });
    } catch (reviewError) {
      console.error(`Error in AI review process for ${section.section_title}:`, reviewError);
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
