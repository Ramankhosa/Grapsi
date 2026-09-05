// @ts-nocheck
/**
 * Review one section.
 *
 * The orchestration itself lives in `src/lib/reviewer/sectionReviewRunner.ts`
 * so the proposal desk's background runner can share it — that runner has no
 * request, and passes a resolved tenant context where this handler passes its
 * headers. What stays here is what is genuinely HTTP: auth, the request body,
 * and mapping the outcome onto a status code.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import { reviewSectionById } from '@/lib/reviewer/sectionReviewRunner';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const session = await getServerSession(req, res);

  if (!session || !session.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const callId = req.query.id as string;
  const sectionId = req.query.sectionId as string;

  if (!callId || !sectionId) {
    return res.status(400).json({ error: 'Call ID and Section ID are required' });
  }

  const callAccess = await requireReviewerCallAccess(callId, session, res, 'editContent');
  if (!callAccess) return;

  const result = await reviewSectionById({
    callId,
    sectionId,
    force: req.body?.force === true,
    skipIfUnchanged: req.body?.skipIfUnchanged === true,
    contextSectionIds: Array.isArray(req.body?.contextSectionIds) ? req.body.contextSectionIds : null,
    llm: { requestHeaders: req.headers },
  });

  if (!result.ok) {
    if (result.status === 429) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.retryAfterMs || 60000) / 1000))));
    }
    return res.status(result.status).json({
      error: result.error,
      ...(result.code ? { code: result.code } : {}),
      ...(result.section ? { section: result.section } : {}),
      ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
    });
  }

  // The panel report is NOT rebuilt here. A single section review used to
  // trigger a full report regeneration (panel model + landscape + novelty +
  // searches), so a five-section revision loop paid for five complete reports.
  // The stored report now simply goes stale: the final-review page shows its
  // stale banner with a Regenerate button, and the ATR export regenerates
  // before serving — a deliverable is never stale. The response keeps
  // `report_refreshed` for API compatibility.
  return res.status(200).json({
    message: result.skippedUnchanged
      ? 'Section unchanged since its last review'
      : 'Section reviewed successfully',
    review: result.review,
    context_summary: result.contextSummary,
    prior_section_summaries: result.priorSectionSummaries,
    ...(result.skippedUnchanged ? { skipped_unchanged: true } : {}),
    report_refreshed: false,
    report_refresh_error: null,
  });
}
