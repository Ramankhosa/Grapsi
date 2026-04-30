// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../lib/prisma';
import { createStandaloneReviewerCall } from '@/lib/reviewer/template-bridge';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check authentication
  const session = await getServerSession(req, res);
  if (!session || !session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const userId = session.user.id;
  
  // GET request - List reviewer calls
  if (req.method === 'GET') {
    try {
      const { projectTitle } = req.query;
      
      // Build the query
      const queryConditions: any = { 
        user_id: userId 
      };
      
      // Add project title filter if provided
      if (projectTitle && typeof projectTitle === 'string') {
        queryConditions.project_title = {
          contains: projectTitle,
          mode: 'insensitive' // Case insensitive search
        };
      }
      
      // Fetch the calls
      const calls = await prisma.reviewerCall.findMany({
        where: queryConditions,
        orderBy: { created_at: 'desc' },
      });
      
      return res.status(200).json({ calls });
    } catch (error) {
      console.error('Error fetching reviewer calls:', error);
      return res.status(500).json({ error: 'Failed to fetch reviewer calls' });
    }
  }
  
  // POST request - Create a new reviewer call
  else if (req.method === 'POST') {
    try {
      const { fundingCallId, project_title, manualRubric, seedSections } = req.body || {};
      
      // Validate required fields
      if (!project_title || !fundingCallId) {
        return res.status(400).json({ error: 'Project title and fundingCallId are required' });
      }

      const fundingCall = await prisma.fundingCall.findFirst({
        where: {
          id: String(fundingCallId),
          OR: [
            { visibility: 'GLOBAL_PUBLISHED' },
            ...(session.user.tenantId ? [{ tenantId: session.user.tenantId }] : []),
          ],
        },
        select: { id: true },
      });

      if (!fundingCall) {
        return res.status(404).json({ error: 'Funding call not found or not accessible' });
      }
      
      // Create a new reviewer call from the approved funding template.
      const newCall = await createStandaloneReviewerCall({
        userId,
        tenantId: session.user.tenantId || null,
        fundingCallId: String(fundingCallId),
        projectTitle: String(project_title),
        manualRubric,
        seedSections: seedSections === true,
      });
      
      return res.status(201).json({ call: newCall });
    } catch (error) {
      console.error('Error creating reviewer call:', error);
      return res.status(500).json({ error: 'Failed to create reviewer call' });
    }
  }
  
  // Method not allowed
  else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
} 
