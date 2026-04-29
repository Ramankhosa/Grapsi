// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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
  
  // Handle GET request
  if (req.method === 'GET') {
    try {
      // Find the call and check ownership using raw query
      const calls = await prisma.$queryRaw`
        SELECT user_id, review_status 
        FROM "reviewer_calls" 
        WHERE id = ${callId}
      `;
      
      const call = calls[0];
      
      // Check if call exists
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      // Check ownership
      if (call.user_id !== session.user.id) {
        return res.status(403).json({ error: 'Not authorized to access this call' });
      }
      
      // Return the status
      return res.status(200).json({ status: call.review_status });
    } catch (error) {
      console.error('Error fetching call status:', error);
      return res.status(500).json({ error: 'Failed to fetch call status' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 