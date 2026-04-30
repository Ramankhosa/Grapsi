// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../../../lib/prisma';
import { ReviewerService } from '../../../../../../../lib/services/reviewerService';

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
    
    // Check if this is a revision and has a previous section ID
    if (!section.is_revision || !section.previous_section_id) {
      return res.status(400).json({ error: 'This section is not a revision or has no previous version' });
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
    
    console.log(`Comparing section ${section.section_title} (V${section.version}) with previous version (V${previousSection.version})`);
    
    // Initialize the reviewer service to use the comparison method
    const reviewerService = new ReviewerService();
    
    // Get the model type from the request body or use default
    const modelType = req.body.modelType === 'O' ? 'O' : 'G';
    
    // Generate the comparison using the ReviewerService
    try {
      const comparison = await reviewerService.compareRevision(
        section.section_title,
        previousSection.user_input,
        section.user_input,
        previousSection.ai_review_json,
        modelType
      );
      
      // Store the comparison results in the current section
      const improvementFlag = comparison.is_significant_improvement !== undefined 
        ? comparison.is_significant_improvement 
        : comparison.score > (previousSection.ai_review_json as any).score;
        
      // Update the section with improvement flag using Prisma client
      await prisma.reviewerSection.update({
        where: { id: sectionId },
        data: { improvement_flag: improvementFlag }
      });
      
      // Return the comparison results
      return res.status(200).json({
        success: true,
        comparison,
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
