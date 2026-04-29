// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../../../lib/prisma';
import { ContextSummaryService } from '../../../../../../../lib/services/contextSummaryService';

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
    // Verify the call belongs to the user
    const calls = await prisma.$queryRaw`
      SELECT user_id, "LLM_model_used" FROM "reviewer_calls" 
      WHERE id = ${callId}
    `;
    
    const call = calls[0];
    
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    if (call.user_id !== session.user.id) {
      return res.status(403).json({ error: 'Not authorized to access this call' });
    }
    
    // Get the section to generate a context summary for
    const sections = await prisma.$queryRaw`
      SELECT id, section_title, user_input
      FROM "reviewer_sections" 
      WHERE id = ${sectionId} AND call_id = ${callId}
    `;
    
    if (!sections || Array.isArray(sections) && sections.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const section = sections[0];
    
    if (!section.user_input) {
      return res.status(400).json({ error: 'Section has no content' });
    }
    
    const model = call.LLM_model_used || 'G'; // Default to Gemini if not specified
    const contextSummaryService = new ContextSummaryService();
    
    // Generate context summary
    const contextSummary = await contextSummaryService.generateContextSummary(
      section.section_title,
      section.user_input,
      model as 'O' | 'G'
    );
    
    // Update the database
    await prisma.$queryRaw`
      UPDATE "reviewer_sections" 
      SET context_summary = ${contextSummary}
      WHERE id = ${sectionId}
    `;
    
    // Return success
    return res.status(200).json({ 
      message: 'Context summary generated',
      section_title: section.section_title,
      context_summary: contextSummary
    });
    
  } catch (error) {
    console.error('Error generating context summary:', error);
    return res.status(500).json({ error: 'Failed to generate context summary' });
  }
} 