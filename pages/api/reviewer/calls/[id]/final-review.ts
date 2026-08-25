// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import {
  normalizeConsistencyFlags,
  normalizeCriterionScorecard,
  normalizeFundingRecommendation,
  normalizePriorityActions,
  normalizeSectionScorecard,
} from '../../../../../lib/services/reviewerService';
import { normalizeStringArray } from '@/lib/reviewer/content';
import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService';
import { normalizeVersionSelections } from '@/lib/reviewer/finalReport';
import {
  ReviewerReportError,
  generateReviewerReport,
} from '@/lib/reviewer/reportGeneration';

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
  landscape?: Record<string, unknown> | null;
  novelty_assessment?: Record<string, unknown> | null;
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
    // Reference-only prior-work landscape; computed server-side, passed through whole.
    landscape: source.landscape && typeof source.landscape === 'object' ? source.landscape : null,
    // Novelty & positioning verdict, evidence-bounded; reference only.
    novelty_assessment: source.novelty_assessment && typeof source.novelty_assessment === 'object' ? source.novelty_assessment : null,
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
        // Accept both `{ title: version }` and the legacy `{ "title|version": version }`
        // shape; the latter was posted by compare mode and never matched anything.
        const versionSelections = normalizeVersionSelections(req.body?.versionSelections);
        const excludedTitles = Array.isArray(req.body?.excludedTitles)
          ? req.body.excludedTitles.map((title: unknown) => String(title || '').trim()).filter(Boolean)
          : [];
        const displayMode = req.body?.displayMode === 'parallel' ? 'parallel' : 'single';
        const hasPreferences = Boolean(req.body?.versionSelections || req.body?.excludedTitles || req.body?.displayMode);

        const result = await generateReviewerReport({
          callId: id,
          versionSelections: Object.keys(versionSelections).length ? versionSelections : null,
          excludedTitles,
        });

        // Remember the picker's choices so the page restores them after the
        // reload that follows generation. The share endpoint writes the same
        // block; until now this route never did, so the picker always reset.
        if (hasPreferences) {
          const parsed = call.parsed_json && typeof call.parsed_json === 'object' ? (call.parsed_json as Record<string, any>) : {};
          await prisma.reviewerCall.update({
            where: { id },
            data: {
              parsed_json: {
                ...parsed,
                report_preferences: {
                  ...(parsed.report_preferences || {}),
                  displayMode,
                  versionSelections,
                  excludedTitles,
                  lastUpdated: new Date().toISOString(),
                },
              } as any,
            },
          });
        }

        const updatedCall = await prisma.reviewerCall.findUnique({ where: { id } });

        return res.status(200).json({
          call: {
            ...updatedCall,
            overall_review_json: toSafeOverallReview(result.report),
          },
          // Every version is returned so the report page can keep offering its
          // version picker; score_basis.scoredVersions says which ones this
          // report was actually built from.
          sections: result.allSections.map(section => ({
            ...section,
            ai_review_json: section.ai_review_json || null,
            version: section.version || 0,
          })),
          scoredVersions: result.scoredVersions,
        });
      } catch (error) {
        if (error instanceof ReviewerReportError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }

        // A rate-limited report is a wait, not a failure. Returning 500 here
        // meant the auto-run's last step died on a transient limit with no
        // retry and no report, throwing away every section review before it.
        if (isGeminiRateLimitErrorLike(error)) {
          const retryAfterMs = getGeminiRetryAfterMs(error) || 60000;
          return res
            .status(429)
            .setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
            .json({
              error: error.message || 'The reviewer model is rate limited.',
              code: 'GEMINI_RATE_LIMITED',
              retryAfterMs,
            });
        }

        console.error('Error generating overall review:', error);
        return res.status(500).json({
          error: 'Failed to generate the final review. There may be an issue with the AI model. Please try again.',
          details: error.message,
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
