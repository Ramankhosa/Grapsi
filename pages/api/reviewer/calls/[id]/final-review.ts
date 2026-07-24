// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import {
  ReviewerService,
  ReviewSummary,
  normalizeConsistencyFlags,
  normalizeCriterionScorecard,
  normalizeFundingRecommendation,
  normalizePriorityActions,
  normalizeSectionScorecard,
} from '../../../../../lib/services/reviewerService';
import { hasMeaningfulSectionContent, normalizeStringArray } from '@/lib/reviewer/content';
import {
  buildDeterministicSummary,
  renderDeterministicBriefing,
  resolveSectionVersions,
} from '@/lib/reviewer/finalReport';

function isScorableReviewedSection(section: any) {
  if (section.status !== 'reviewed' || !hasMeaningfulSectionContent(section.user_input)) return false;
  const mappingJson = section.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {};
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : [];
  const linksDeclareWorkflow = linkedSections.some((link: any) => typeof link.workflowMode === 'string');
  return !linksDeclareWorkflow || linkedSections.some((link: any) => String(link.workflowMode || '') === 'app_draft');
}

// Define types for the review JSON structure
interface ReviewJson {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions?: string[];
  recommendations?: string[];
}

interface OverallReviewJson {
  overall_score: number;
  executive_summary: string;
  major_strengths: string[];
  major_weaknesses: string[];
  cross_sectional_recommendations: string[];
  supplementary_materials?: string[];
  funding_recommendation?: { decision: string; competitiveness: string; rationale: string };
  criterion_scorecard?: Array<Record<string, unknown>>;
  section_scorecard?: Array<Record<string, unknown>>;
  priority_actions?: Array<Record<string, unknown>>;
  consistency_flags?: Array<Record<string, unknown>>;
  compliance?: Record<string, unknown> | null;
  score_basis?: Record<string, unknown> | null;
}

/**
 * Coerce a stored or freshly generated report into the full shape the report
 * page and the DOCX export read. Older reports predate the scorecard fields, so
 * every one of them degrades to an empty list rather than breaking the page.
 */
function toSafeOverallReview(raw: any): OverallReviewJson {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    overall_score:
      typeof source.overall_score === 'number'
        ? source.overall_score
        : typeof source.overall_score === 'string'
          ? Number.parseFloat(source.overall_score) || 0
          : 0,
    executive_summary: typeof source.executive_summary === 'string' ? source.executive_summary : '',
    major_strengths: normalizeStringArray(source.major_strengths),
    major_weaknesses: normalizeStringArray(source.major_weaknesses),
    cross_sectional_recommendations: normalizeStringArray(source.cross_sectional_recommendations),
    supplementary_materials: normalizeStringArray(source.supplementary_materials),
    funding_recommendation: source.funding_recommendation
      ? normalizeFundingRecommendation(source.funding_recommendation)
      : undefined,
    criterion_scorecard: normalizeCriterionScorecard(source.criterion_scorecard),
    section_scorecard: normalizeSectionScorecard(source.section_scorecard),
    priority_actions: normalizePriorityActions(source.priority_actions),
    consistency_flags: normalizeConsistencyFlags(source.consistency_flags),
    compliance: source.compliance && typeof source.compliance === 'object' ? source.compliance : null,
    score_basis: source.score_basis && typeof source.score_basis === 'object' ? source.score_basis : null,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get the id from the URL
  const { id } = req.query;
  
  // Check for valid ID
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid call ID' });
  }
  
  // Get the user session
  const session = await getSession({ req });
  
  // Check authentication
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if the call exists and belongs to the user
  try {
    const call = await prisma.reviewerCall.findUnique({
      where: { id },
      select: {
        user_id: true,
        project_title: true,
        overall_review_json: true,
        parsed_json: true,
        LLM_model_used: true,
        review_status: true
      }
    });
    
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    const callAccess = await requireReviewerCallAccess(id, session, res, req.method === 'GET' ? 'read' : 'editContent');
    if (!callAccess) return;

    // Handle GET request - return existing final review
    if (req.method === 'GET') {
      try {
        // Fetch all sections with their latest reviews
        const sections = await prisma.reviewerSection.findMany({
          where: { call_id: id },
        });

        // Map sections to include their latest review
        const sectionsWithLatestReview = sections.map(section => {
          return {
            ...section,
            ai_review_json: section.ai_review_json || null,
            version: section.version || 0,
          };
        });

        // Add safety to review processing in the GET handler
        // Ensure we have proper structure for ai_review_json
        const normalizedSections = sectionsWithLatestReview.map(section => {
          // Ensure ai_review_json exists and has all required fields
          const safeReviewJson: ReviewJson = {
            score: 0,
            summary: '',
            strengths: [],
            weaknesses: [],
            suggestions: [],
            recommendations: [],
            ...(section.ai_review_json as any || {})
          };
          
          // Ensure all arrays are actual arrays
          if (!Array.isArray(safeReviewJson.strengths)) safeReviewJson.strengths = [];
          if (!Array.isArray(safeReviewJson.weaknesses)) safeReviewJson.weaknesses = [];
          if (safeReviewJson.suggestions && !Array.isArray(safeReviewJson.suggestions)) safeReviewJson.suggestions = [];
          if (safeReviewJson.recommendations && !Array.isArray(safeReviewJson.recommendations)) safeReviewJson.recommendations = [];
          
          return {
            ...section,
            ai_review_json: safeReviewJson
          };
        });

        const safeOverallReview = toSafeOverallReview(call.overall_review_json);

        return res.status(200).json({
          call: {
            ...call,
            overall_review_json: safeOverallReview
          },
          sections: normalizedSections,
        });
      } catch (error) {
        console.error('Error in GET handler:', error);
        return res.status(500).json({ 
          error: 'Failed to fetch review data',
          details: error.message
        });
      }
    }

    // Handle POST request - generate new final review
    if (req.method === 'POST') {
      try {
        // Fetch all sections
        const allSections = await prisma.reviewerSection.findMany({
          where: { call_id: id },
        });

        // A revision is stored as a new row, so the raw list holds every draft
        // ever submitted. Report on one version per section — the newest, or
        // whichever the report page's version picker asked for — otherwise the
        // same section is scored twice and superseded weaknesses resurface.
        const { effective: sections, superseded, chosenVersions } = resolveSectionVersions(
          allSections,
          req.body?.versionSelections || null
        );

        // Filter to only include reviewed sections
        const reviewedSections = sections.filter(isScorableReviewedSection);

        // Check if we have reviewed sections
        if (reviewedSections.length === 0) {
          return res.status(400).json({
            error: superseded.length > 0
              ? 'The current version of every section is still awaiting review. Review the latest revisions before generating a final review.'
              : 'No reviewed sections found for this call. Please review at least one section before generating a final review.'
          });
        }

        // Prepare section summaries for the overall review
        const sectionSummaries = reviewedSections.map(section => {
          const reviewJson = section.ai_review_json as any || {
            score: 0,
            summary: 'No review available',
            strengths: [],
            weaknesses: [],
            recommendations: []
          };

          return {
            title: section.section_title,
            version: section.version || 0,
            content: section.user_input || '',
            context_summary: section.context_summary || '',
            review_json: reviewJson
          };
        });

        // Get LLM preference from call or default to Gemini
        const modelType = call.LLM_model_used === 'OPENAI' ? 'O' : 'G';

        const parsedContext = call.parsed_json && typeof call.parsed_json === 'object'
          ? (call.parsed_json as any)
          : null;
        const description = parsedContext
          ? parsedContext.reviewer_context_text || parsedContext.description || parsedContext.call_summary || ''
          : '';

        // Compliance, coverage, limit breaches, and the weighted score are
        // counted here rather than asked for. Every *authored* section counts
        // toward coverage, not only the reviewed ones, so a drafted-but-
        // unreviewed section is not reported as missing.
        const deterministic = buildDeterministicSummary(
          sections.map(section => ({
            title: section.section_title,
            version: section.version || 0,
            content: section.user_input || '',
            contextSummary: section.context_summary || '',
            review: (section.ai_review_json as any) || null,
            bucketKey: (section as any).reviewerBucketKey || null,
          })),
          parsedContext
        );
        const anchorScore = deterministic.weightedScore ?? deterministic.meanSectionScore ?? null;

        // Generate the overall review
        const reviewerService = new ReviewerService();

        try {
          console.log('⭐ Starting final review generation for call:', id);
          console.log('Using model type:', modelType);
          console.log('Number of reviewed sections:', reviewedSections.length);

          const overallReview = await reviewerService.generateOverallReview(
            call.project_title,
            description,
            sectionSummaries,
            modelType as 'O' | 'G',
            {
              deterministicBriefing: renderDeterministicBriefing(deterministic),
              anchorScore,
            }
          );

          console.log('✅ Final review generated successfully:', !!overallReview);

          const reportPayload = {
            ...overallReview,
            compliance: deterministic.compliance,
            score_basis: {
              weightedScore: deterministic.weightedScore,
              meanSectionScore: deterministic.meanSectionScore,
              anchorScore,
              criterionRollup: deterministic.criterionRollup,
              sectionScores: deterministic.sectionScores,
              complianceFlagCounts: deterministic.complianceFlagCounts,
              // Records exactly which draft each score came from, so a reader
              // can tell a v3 report from a v1 one.
              scoredVersions: chosenVersions,
              supersededVersionCount: superseded.length,
            },
            generated_at: new Date().toISOString(),
          };

          // Update the call with the overall review
          const updatedCall = await prisma.reviewerCall.update({
            where: { id },
            data: {
              overall_review_json: reportPayload as any,
              updated_at: new Date()
            },
          });

          console.log('✅ Call updated successfully with overall review');

          const safeOverallReview = toSafeOverallReview(reportPayload);

          return res.status(200).json({
            call: {
              ...updatedCall,
              overall_review_json: safeOverallReview
            },
            // Every version is returned so the report page can keep offering
            // its version picker; `score_basis.scoredVersions` says which ones
            // this report was actually built from.
            sections: allSections.map(section => ({
              ...section,
              ai_review_json: section.ai_review_json || null,
              version: section.version || 0,
            })),
            scoredVersions: chosenVersions,
          });
        } catch (error) {
          console.error('Error generating overall review:', error);
          return res.status(500).json({ 
            error: 'Failed to generate the final review. There may be an issue with the AI model. Please try again.',
            details: error.message
          });
        }
      } catch (error) {
        console.error('Error in POST handler:', error);
        return res.status(500).json({ 
          error: 'Failed to generate review',
          details: error.message
        });
      }
    }
    
    // Return method not allowed for other HTTP methods
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    
  } catch (error) {
    console.error('Error in handler:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred',
      details: error.message
    });
  }
} 
