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
  
  // Get the abstract content from the request body
  const { abstractContent } = req.body;
  
  if (!hasMeaningfulSectionContent(abstractContent)) {
    return res.status(400).json({
      error: 'Abstract content is required',
      code: 'SECTION_CONTENT_MISSING',
    });
  }
  
  try {
    console.log(`[Abstract Review] Starting process for call ${callId}`);
    
    // Verify the call belongs to the user
    const calls = await prisma.$queryRaw`
      SELECT user_id, parsed_json FROM "reviewer_calls" 
      WHERE id = ${callId}
    `;
    
    if (!calls || !Array.isArray(calls) || calls.length === 0) {
      console.error(`[Abstract Review] Call not found with ID: ${callId}`);
      return res.status(404).json({ error: 'Call not found' });
    }
    
    const call = calls[0];
    
    if (call.user_id !== session.user.id) {
      console.error(`[Abstract Review] Authorization failed for user ${session.user.id} accessing call ${callId}`);
      return res.status(403).json({ error: 'Not authorized to access this call' });
    }
    
    // Get the call data for context
    const parsedJson = call.parsed_json || {};
    
    // Extract proposal title and call summary
    const proposalTitle = parsedJson.title || parsedJson.metadata?.title || "Untitled Proposal";
    const callSummary = parsedJson.description || parsedJson.summary || parsedJson.agency_description || "No call summary available";
    
    console.log(`[Abstract Review] Generating review for "${proposalTitle}" using Gemini 2.0 Flash`);
    
    // Initialize the reviewer service
    const reviewerService = new ReviewerService();
    
    // Generate the abstract review using Gemini 2.0 Flash
    const abstractReview = await reviewerService.generateAbstractReview(
      abstractContent,
      proposalTitle,
      callSummary,
      'G' // Force Gemini 2.0 Flash for all reviews
    );
    
    console.log('[Abstract Review] Successfully generated review');
    console.log('[Abstract Review] Review score:', abstractReview.section_score);
    
    if (!abstractReview || !abstractReview.section_score) {
      console.error('[Abstract Review] Invalid review generated:', abstractReview);
      return res.status(500).json({ error: 'Generated review is invalid' });
    }

    abstractReview.section_score = parseReviewerScore(abstractReview.section_score);
    
    // Check if an abstract section already exists
    const existingSections = await prisma.$queryRaw`
      SELECT id, version FROM "reviewer_sections" 
      WHERE call_id = ${callId} AND section_title = 'Abstract'
      ORDER BY version DESC LIMIT 1
    `;
    
    let sectionId: string;
    let version = 1;
    
    if (existingSections && Array.isArray(existingSections) && existingSections.length > 0) {
      // Update the existing section
      version = existingSections[0].version + 1;
      console.log(`[Abstract Review] Creating version ${version} of abstract section`);
    } else {
      console.log('[Abstract Review] Creating new abstract section');
    }
    
    // Insert the new abstract section
    try {
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
          review_linked_context
        ) VALUES (
          gen_random_uuid(), 
          ${callId}, 
          'Abstract', 
          ${abstractContent}, 
          ${abstractReview}, 
          CURRENT_TIMESTAMP,
          'reviewed',
          ${version},
          ${true}
        ) RETURNING id
      `;
      
      sectionId = result[0].id;
      console.log(`[Abstract Review] Successfully stored in database with ID: ${sectionId}`);
      
      // Update review progress state to mark abstract as reviewed
      try {
        const callData = await prisma.$queryRaw`
          SELECT review_progress_state FROM "reviewer_calls" WHERE id = ${callId}
        `;
        
        if (callData && Array.isArray(callData) && callData.length > 0) {
          let progressState = callData[0].review_progress_state || {};
          
          // Update the progress state to mark abstract as reviewed
          progressState.abstract_reviewed = true;
          progressState.last_section_reviewed = 'Abstract';
          progressState.last_review_timestamp = new Date().toISOString();
          
          await prisma.$queryRaw`
            UPDATE "reviewer_calls"
            SET review_progress_state = ${progressState}
            WHERE id = ${callId}
          `;
          
          console.log('[Abstract Review] Updated call review progress state');
        }
      } catch (progressError) {
        console.error('[Abstract Review] Error updating progress state:', progressError);
        // Don't fail the request if progress state update fails
      }
      
      // Return success with the review data
      return res.status(200).json({ 
        message: 'Abstract reviewed successfully',
        section_id: sectionId,
        review: abstractReview
      });
    } catch (dbError) {
      console.error('[Abstract Review] Database error storing review:', dbError);
      return res.status(500).json({ error: 'Failed to store abstract review in database' });
    }
  } catch (error) {
    console.error('[Abstract Review] Error processing abstract review:', error);
    return res.status(500).json({ error: 'Failed to review abstract' });
  }
} 
