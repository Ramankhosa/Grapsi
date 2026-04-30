// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import { hasMeaningfulSectionContent, parseReviewerScore } from '@/lib/reviewer/content';
import prisma from '../../../../../../lib/prisma';
import { ReviewerService } from '../../../../../../lib/services/reviewerService';

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
  
  // Get the introduction content from the request body
  const { introductionContent } = req.body;
  
  if (!hasMeaningfulSectionContent(introductionContent)) {
    return res.status(400).json({
      error: 'Introduction content is required',
      code: 'SECTION_CONTENT_MISSING',
    });
  }
  
  try {
    // Verify the call belongs to the user
    const calls = await prisma.$queryRaw`
      SELECT user_id, parsed_json FROM "reviewer_calls" 
      WHERE id = ${callId}
    `;
    
    const call = calls[0];
    
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    if (call.user_id !== session.user.id) {
      return res.status(403).json({ error: 'Not authorized to access this call' });
    }
    
    // Get the call data for context
    const parsedJson = call.parsed_json || {};
    
    // Extract project title and call summary
    const projectTitle = parsedJson.title || parsedJson.metadata?.title || "Untitled Proposal";
    const callSummary = parsedJson.description || parsedJson.summary || parsedJson.agency_description || "No call summary available";
    
    // Always use Gemini 2.0 Flash regardless of what's stored in the database
    console.log('Using Gemini 2.0 Flash for introduction review');
    
    // Find Abstract section's context summary if it exists
    let abstractContextSummary = null;
    const abstractSections = await prisma.$queryRaw`
      SELECT context_summary 
      FROM "reviewer_sections" 
      WHERE call_id = ${callId} AND section_title = 'Abstract' AND status = 'reviewed'
      ORDER BY version DESC LIMIT 1
    `;
    
    if (abstractSections && Array.isArray(abstractSections) && abstractSections.length > 0) {
      abstractContextSummary = abstractSections[0].context_summary;
    }
    
    console.log(`Using Abstract context summary: ${abstractContextSummary ? 'Yes' : 'No'}`);
    
    // Initialize the reviewer service
    const reviewerService = new ReviewerService();
    
    // Generate the introduction review using Gemini 2.0 Flash
    const introductionReview = await reviewerService.generateIntroductionReview(
      introductionContent,
      projectTitle,
      callSummary,
      'G', // Force Gemini 2.0 Flash for all reviews
      abstractContextSummary
    );

    introductionReview.score = parseReviewerScore(introductionReview.score);
    
    // Check if an introduction section already exists
    const existingSections = await prisma.$queryRaw`
      SELECT id, version FROM "reviewer_sections" 
      WHERE call_id = ${callId} AND section_title = 'Introduction'
      ORDER BY version DESC LIMIT 1
    `;
    
    let sectionId: string;
    let version = 1;
    
    if (existingSections && Array.isArray(existingSections) && existingSections.length > 0) {
      // Update the existing section
      version = existingSections[0].version + 1;
    }
    
    // Generate a context summary for the introduction if one isn't already included
    let contextSummary = introductionReview.context_summary;
    if (!contextSummary) {
      // Implement simplified context summary generation if not already provided
      contextSummary = `Introduction section covers: ${introductionReview.summary.substring(0, 150)}...`;
    }
    
    // Insert the new introduction section
    const result = await prisma.$queryRaw`
      INSERT INTO "reviewer_sections" (
        id, 
        call_id, 
        section_title, 
        user_input, 
        ai_review_json, 
        last_reviewed_at,
        status,
        version,
        review_linked_context,
        context_summary
      ) VALUES (
        gen_random_uuid(), 
        ${callId}, 
        'Introduction', 
        ${introductionContent}, 
        ${introductionReview}, 
        CURRENT_TIMESTAMP,
        'reviewed',
        ${version},
        ${true},
        ${contextSummary}
      ) RETURNING id
    `;
    
    sectionId = result[0].id;
    
    // Return success with the review data
    return res.status(200).json({ 
      message: 'Introduction reviewed successfully',
      section_id: sectionId,
      review: introductionReview,
      context_summary: contextSummary
    });
    
  } catch (error) {
    console.error('Error reviewing introduction:', error);
    return res.status(500).json({ error: 'Failed to review introduction' });
  }
} 
