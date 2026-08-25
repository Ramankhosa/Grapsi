// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getSession, requireReviewerCallAccess } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import { resolveSectionVersions } from '@/lib/reviewer/finalReport';
import { ensureCurrentReport } from '@/lib/reviewer/reportGeneration';
import { buildAtrDocument } from '@/lib/reviewer/atrDocument';

function asStringList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item ?? '').trim()))
    .filter(Boolean);
}

/**
 * Coerce a stored section review into the shape the document builder reads.
 * Everything the builder can render is carried through — score deltas,
 * addressed previous points, compliance flags — so a revised section's story
 * survives into the deliverable.
 */
function normalizeSectionReview(raw: unknown): Record<string, any> {
  const review = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  return {
    ...review,
    score: typeof review.score === 'number' ? review.score : Number.parseFloat(review.score) || 0,
    summary: typeof review.summary === 'string' ? review.summary : '',
    strengths: asStringList(review.strengths),
    weaknesses: asStringList(review.weaknesses),
    suggestions: asStringList(review.suggestions),
    recommendations: asStringList(review.recommendations),
    addressed_previous_points: Array.isArray(review.addressed_previous_points) ? review.addressed_previous_points : [],
    compliance_flags: Array.isArray(review.compliance_flags) ? review.compliance_flags : [],
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid call ID' });
  }

  const session = await getSession({ req });
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // The same capability check every other reviewer route uses. This used to
    // compare `call.user_id` against the session user, which locked project
    // collaborators — people who can read and even run the review — out of the
    // export alone.
    const callAccess = await requireReviewerCallAccess(id, session, res, 'read');
    if (!callAccess) return;

    // The ATR is a deliverable, so it must describe the drafts as they stand.
    // This used to serve whatever was stored: revise a section and the
    // downloaded document still carried the previous verdict and score beside
    // the current section list, with nothing on the page saying so.
    const refresh = await ensureCurrentReport(id);

    const call = await prisma.reviewerCall.findUnique({
      where: { id },
      select: {
        id: true,
        user_id: true,
        project_title: true,
        agency_name: true,
        overall_review_json: true,
        parsed_json: true,
      }
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    if (!call.overall_review_json || Object.keys(call.overall_review_json as object).length === 0) {
      return res.status(400).json({
        error: refresh.error
          || 'There is no panel report to export yet. Review at least one section, then generate the report.',
        code: 'REPORT_NOT_GENERATED',
      });
    }

    // Every draft ever submitted lives in this table, so filtering on
    // `status: 'reviewed'` alone printed a revised section once per version —
    // two "Objectives" headings, two different scores, no version labels. The
    // report and the workspace both resolve to one version per title; the
    // export has to agree with them.
    const allSections = await prisma.reviewerSection.findMany({
      where: { call_id: id },
      select: {
        id: true,
        section_title: true,
        version: true,
        status: true,
        ai_review_json: true,
      },
    });

    const reviewJson = call.overall_review_json as Record<string, any>;
    const scoredVersions = reviewJson?.score_basis?.scoredVersions || null;
    const sections = resolveSectionVersions(allSections as any, scoredVersions)
      .effective
      .filter((section: any) => section.status === 'reviewed')
      .map((section: any) => ({
        id: section.id,
        section_title: section.section_title,
        version: Number(section.version || 1),
        review: normalizeSectionReview(section.ai_review_json),
      }));

    // Only reachable when the refresh above could not run — a rate limit, or a
    // model failure. The document still ships, because a stale report beats no
    // report, but it has to say so on its own face: this file gets forwarded to
    // people who will never see the warning that was on the screen.
    const staleNotice = refresh.freshness === 'stale'
      ? 'This report was written before the latest revisions and does not describe the current drafts. Regenerate the panel report, then export again.'
      : null;

    const parsed = call.parsed_json && typeof call.parsed_json === 'object' ? (call.parsed_json as Record<string, any>) : {};
    const projectTitle = call.project_title || 'Untitled Project';

    // The whole stored report goes to the builder. Whitelisting keys here is
    // what silently dropped the scorecards and consistency flags from the
    // document for months; the builder reads defensively instead.
    const buffer = await buildAtrDocument({
      projectTitle,
      agencyName: call.agency_name || parsed.agency_name || null,
      callTitle: typeof parsed.title === 'string' ? parsed.title : null,
      generatedAt: typeof reviewJson.generated_at === 'string' ? reviewJson.generated_at : null,
      staleNotice,
      overall: {
        ...reviewJson,
        overall_score: typeof reviewJson.overall_score === 'number'
          ? reviewJson.overall_score
          : Number.parseFloat(reviewJson.overall_score) || 0,
        major_strengths: asStringList(reviewJson.major_strengths),
        major_weaknesses: asStringList(reviewJson.major_weaknesses),
        cross_sectional_recommendations: asStringList(reviewJson.cross_sectional_recommendations),
        supplementary_materials: asStringList(reviewJson.supplementary_materials),
      },
      sections,
    });

    res.setHeader('Content-Disposition', `attachment; filename="ATR-${projectTitle.replace(/[^a-zA-Z0-9]/g, '_')}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    // Lets the client tell the user the export waited on a fresh report.
    res.setHeader('X-Reviewer-Report-Regenerated', refresh.regenerated ? '1' : '0');
    res.setHeader('X-Reviewer-Report-Freshness', refresh.freshness);
    res.send(buffer);
  } catch (error) {
    console.error('Error generating ATR document:', error);
    return res.status(500).json({
      error: 'Failed to generate ATR document',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
