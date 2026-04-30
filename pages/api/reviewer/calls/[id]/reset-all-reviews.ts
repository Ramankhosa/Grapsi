// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';

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
  
  // Get the call ID from the URL
  const callId = req.query.id as string;
  
  if (!callId) {
    return res.status(400).json({ error: 'Call ID is required' });
  }
  
  try {
    const callAccess = await requireReviewerCallAccess(callId, session, res, 'editContent');
    if (!callAccess) return;
    
    // Reset all sections to 'draft' status to force re-review
    const result = await prisma.$queryRaw`
      UPDATE "reviewer_sections"
      SET 
        status = 'draft',
        improvement_flag = NULL
      WHERE call_id = ${callId} 
      AND (status = 'reviewed' OR status = 'revised')
    `;

    // Reset the review progress state as well
    await prisma.$queryRaw`
      UPDATE "reviewer_calls"
      SET review_progress_state = NULL
      WHERE id = ${callId}
    `;
    
    // Return success
    return res.status(200).json({ 
      message: 'All section reviews reset successfully'
    });
    
  } catch (error) {
    console.error('Error resetting all section reviews:', error);
    return res.status(500).json({ error: 'Failed to reset all section reviews' });
  }
} 
