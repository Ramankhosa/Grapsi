// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getSession, requireReviewerCallAccess } from '@/lib/reviewer-auth-api';
import { buildAtrForCall } from '@/lib/reviewer/atrExport';

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
    const result = await buildAtrForCall(id, { refresh: true });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    // Lets the client tell the user the export waited on a fresh report.
    res.setHeader('X-Reviewer-Report-Regenerated', result.regenerated ? '1' : '0');
    res.setHeader('X-Reviewer-Report-Freshness', result.freshness);
    res.send(result.buffer);
  } catch (error) {
    console.error('Error generating ATR document:', error);
    return res.status(500).json({
      error: 'Failed to generate ATR document',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
