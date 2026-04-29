// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import { ContextSummaryService } from '../../../../../lib/services/contextSummaryService';

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
  
  // Check if we should force regeneration of all summaries
  const forceRegenerate = req.body.forceRegenerate === true;
  
  if (!callId) {
    return res.status(400).json({ error: 'Call ID is required' });
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
    
    // Get all sections for this call that have content
    const sections = await prisma.$queryRaw`
      SELECT id, section_title, user_input
      FROM "reviewer_sections" 
      WHERE call_id = ${callId}
      AND user_input IS NOT NULL AND user_input != ''
    `;
    
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(404).json({ error: 'No sections found' });
    }
    
    const model = call.LLM_model_used || 'G'; // Default to Gemini if not specified
    const contextSummaryService = new ContextSummaryService();
    
    // Process each section
    const results = [];
    for (const section of sections as any[]) {
      try {
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
          WHERE id = ${section.id}
        `;
        
        results.push({
          id: section.id,
          title: section.section_title,
          status: 'success',
          context_summary: contextSummary
        });
      } catch (error) {
        console.error(`Error processing section ${section.id}:`, error);
        
        results.push({
          id: section.id,
          title: section.section_title,
          status: 'error',
          error: 'Failed to generate context summary'
        });
      }
    }
    
    // Return success with summary of results
    return res.status(200).json({ 
      message: 'Context summaries processed',
      processed_count: results.length,
      success_count: results.filter(r => r.status === 'success').length,
      results: results
    });
    
  } catch (error) {
    console.error('Error processing context summaries:', error);
    return res.status(500).json({ error: 'Failed to process context summaries' });
  }
} 