// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../../../lib/prisma';
import { ReviewerService } from '../../../../../../../lib/services/reviewerService';
import { summarizeAddressedPoints } from '../../../../../../../lib/reviewerService';

const ADDRESSED_LABEL = {
  addressed: 'Addressed',
  partially: 'Partly addressed',
  not_addressed: 'Not addressed',
};

/**
 * Build the comparison from the revision review that already ran.
 *
 * A revision review is told to account for every earlier remark in
 * `addressed_previous_points`, so the comparison is already paid for. Calling a
 * separate comparison model would re-read both drafts to produce the same
 * judgement at roughly the cost of a second full review.
 */
function comparisonFromReview(section: any, previousSection: any) {
  const review = section?.ai_review_json && typeof section.ai_review_json === 'object'
    ? section.ai_review_json
    : null;
  const points = Array.isArray(review?.addressed_previous_points) ? review.addressed_previous_points : [];
  if (!review || points.length === 0) return null;

  const tally = review.addressed_summary || summarizeAddressedPoints(points);
  const previousScore = typeof previousSection?.ai_review_json?.score === 'number'
    ? previousSection.ai_review_json.score
    : null;

  const resolved = points.filter((point: any) => point.status === 'addressed');
  const outstanding = points.filter((point: any) => point.status !== 'addressed');

  const scoreDelta =
    review.score_delta
    ?? (previousScore !== null ? Number((review.score - previousScore).toFixed(2)) : null);

  // Describe the revision, not the section. This used to hand back
  // `review.summary` — the section's own summary, which never mentions the
  // earlier draft — under a heading that promised an account of what changed.
  const movement =
    typeof scoreDelta === 'number' && scoreDelta !== 0
      ? ` The score moved ${scoreDelta > 0 ? 'up' : 'down'} ${Math.abs(scoreDelta).toFixed(1)}, to ${review.score}.`
      : typeof review.score === 'number'
        ? ` The score is unchanged at ${review.score}.`
        : '';

  const partly = points.filter((point: any) => point.status === 'partially').length;
  const untouched = points.filter((point: any) => point.status === 'not_addressed').length;
  const leftover = [
    partly ? `${partly} only partly` : '',
    untouched ? `${untouched} not at all` : '',
  ].filter(Boolean).join(', ');

  const improvementSummary =
    `This revision fully addresses ${tally.addressed} of the ${tally.total} points the previous review raised`
    + (leftover ? ` — ${leftover}.` : '.')
    + movement;

  return {
    source: 'revision_review',
    score: review.score,
    previous_score: previousScore,
    score_delta: scoreDelta,
    improvement_summary: improvementSummary,
    /** The section's own summary, kept but never passed off as a change log. */
    section_summary: review.summary || null,
    addressed_points: points.map((point: any) => ({
      ...point,
      label: ADDRESSED_LABEL[point.status] || point.status,
    })),
    addressed_summary: tally,
    key_changes: resolved.map((point: any) => point.evidence).filter(Boolean),
    improvements: resolved.map((point: any) => point.point),
    remaining_issues: outstanding.map((point: any) =>
      point.evidence ? `${point.point} — ${point.evidence}` : point.point
    ),
    further_recommendations: Array.isArray(review.suggestions) ? review.suggestions.slice(0, 5) : [],
    is_significant_improvement: review.improvement_over_previous === true,
  };
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

    // Get the section to compare
    const section = await prisma.reviewerSection.findFirst({
      where: {
        id: sectionId,
        call_id: callId
      }
    });

    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (!section.previous_section_id) {
      return res.status(400).json({ error: 'This section has no previous version to compare against' });
    }

    // Get the previous section
    const previousSection = await prisma.reviewerSection.findUnique({
      where: { id: section.previous_section_id }
    });

    if (!previousSection) {
      return res.status(404).json({ error: 'Previous section not found' });
    }

    // Check if the previous section has a review
    if (previousSection.status !== 'reviewed') {
      return res.status(400).json({ error: 'Previous section has not been reviewed yet' });
    }

    const forceRefresh = req.body?.forceRefresh === true;
    const storedReview = section.ai_review_json && typeof section.ai_review_json === 'object'
      ? (section.ai_review_json as any)
      : {};

    // 1. A comparison computed on an earlier request, stored alongside the review.
    if (!forceRefresh && storedReview.revision_comparison) {
      return res.status(200).json({
        success: true,
        comparison: storedReview.revision_comparison,
        cached: true,
        previous_version: previousSection.version,
        current_version: section.version,
        section_title: section.section_title,
      });
    }

    // 2. The revision review's own account of the earlier remarks — free.
    if (!forceRefresh) {
      const derived = comparisonFromReview(section, previousSection);
      if (derived) {
        await prisma.reviewerSection.update({
          where: { id: sectionId },
          data: {
            ai_review_json: { ...storedReview, revision_comparison: derived } as any,
            improvement_flag: derived.is_significant_improvement,
          },
        });

        return res.status(200).json({
          success: true,
          comparison: derived,
          cached: false,
          derived: true,
          previous_version: previousSection.version,
          current_version: section.version,
          section_title: section.section_title,
        });
      }
    }

    console.log(`Comparing section ${section.section_title} (V${section.version}) with previous version (V${previousSection.version})`);

    // 3. Fall back to a dedicated comparison call — needed when the current
    //    draft has not been reviewed yet, or the caller asked for a refresh.
    const reviewerService = new ReviewerService();
    const modelType = req.body.modelType === 'O' ? 'O' : 'G';

    try {
      const comparison = await reviewerService.compareRevision(
        section.section_title,
        previousSection.user_input,
        section.user_input,
        previousSection.ai_review_json,
        modelType
      );

      const improvementFlag = comparison.is_significant_improvement !== undefined
        ? comparison.is_significant_improvement
        : comparison.score > ((previousSection.ai_review_json as any)?.score ?? 0);

      // Persist so reopening the comparison does not pay for it again.
      await prisma.reviewerSection.update({
        where: { id: sectionId },
        data: {
          ai_review_json: {
            ...storedReview,
            revision_comparison: { ...comparison, source: 'comparison_model' },
          } as any,
          improvement_flag: improvementFlag,
        },
      });

      return res.status(200).json({
        success: true,
        comparison,
        cached: false,
        derived: false,
        previous_version: previousSection.version,
        current_version: section.version,
        section_title: section.section_title
      });

    } catch (error) {
      console.error('Error generating revision comparison:', error);
      return res.status(500).json({ error: 'Failed to compare revisions' });
    }
  } catch (error) {
    console.error('Error in revision comparison endpoint:', error);
    return res.status(500).json({ error: 'Failed to process revision comparison' });
  }
}
