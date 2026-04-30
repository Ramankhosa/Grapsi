// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import { getSectionPosition } from '../../../../../lib/reviewerService';
import axios from 'axios';

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
  
  // Get the call ID from the URL and section ID from the request body
  const callId = req.query.id as string;
  const { sectionId } = req.body;
  
  if (!callId || !sectionId) {
    return res.status(400).json({ error: 'Call ID and Section ID are required' });
  }
  
  try {
    const callAccess = await requireReviewerCallAccess(callId, session, res, 'editContent');
    if (!callAccess) return;
    
    // Get the section to review
    const sections = await prisma.$queryRaw`
      SELECT * FROM "reviewer_sections" 
      WHERE id = ${sectionId} AND call_id = ${callId}
    `;
    
    if (!sections || Array.isArray(sections) && sections.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const section = sections[0];
    
    console.log(`Processing review for section: ${section.section_title} (ID: ${sectionId})`);
    
    // Determine current section's position in the review flow
    const currentSectionPosition = getSectionPosition(section.section_title);
    console.log(`Section position in flow: ${currentSectionPosition} for ${section.section_title}`);
    
    // Get all sections for this call to find relevant previous sections
    const allSections = await prisma.$queryRaw`
      SELECT id, section_title, context_summary, status
      FROM "reviewer_sections"
      WHERE call_id = ${callId} AND status = 'reviewed'
      ORDER BY last_reviewed_at ASC
    `;
    
    // Prepare array of prior section summaries according to the progression logic
    const priorSectionSummaries = [];
    
    if (Array.isArray(allSections) && allSections.length > 0) {
      console.log(`Found ${allSections.length} potential context sections`);
      
      // For each section, determine if it should be included as a prior context
      for (const prevSection of allSections) {
        // Skip the current section if somehow included
        if (prevSection.id === sectionId) continue;
        
        const prevSectionPosition = getSectionPosition(prevSection.section_title);
        
        // Only include sections that come before the current section in the flow
        if (prevSectionPosition < currentSectionPosition) {
          // Include this section's summary if available
          if (prevSection.context_summary) {
            priorSectionSummaries.push({
              section_title: prevSection.section_title,
              context_summary: prevSection.context_summary
            });
            console.log(`Added context summary from ${prevSection.section_title}`);
          } else {
            console.log(`Section ${prevSection.section_title} has no context summary`);
          }
        }
      }
    }
    
    console.log(`Using ${priorSectionSummaries.length} prior section summaries for context`);
    
    // Call the review API with the section ID and dependencies
    try {
      // Check if the section is already in draft status
      if (section.status !== 'draft') {
        // Set it back to draft for re-review
        await prisma.$queryRaw`
          UPDATE "reviewer_sections"
          SET status = 'draft'
          WHERE id = ${sectionId}
        `;
      }
      
      // Call the review endpoint
      const origin = req.headers.origin || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const apiUrl = `${origin}/api/reviewer/calls/${callId}/sections/${sectionId}/review`;
      const authHeader = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const response = await axios.post(apiUrl, {
        contextSectionIds: priorSectionSummaries.map(s => s.section_title)
      }, {
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          Cookie: req.headers.cookie || ''
        }
      });
      
      // Return the review result
      return res.status(200).json({
        message: 'Section reviewed successfully with dependencies',
        context_summary: response.data.context_summary,
        review: response.data.review,
        used_dependency_sections: priorSectionSummaries.map(s => s.section_title)
      });
    } catch (error) {
      console.error('Error calling review API:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      if (error.response?.status === 429) {
        const retryAfterHeader = error.response.headers?.['retry-after'];
        const retryAfterMs = Number(error.response.data?.retryAfterMs)
          || (retryAfterHeader ? Number(retryAfterHeader) * 1000 : 60000);
        return res
          .status(429)
          .setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
          .json({
            error: error.response.data?.error || 'Review model is rate limited',
            code: 'GEMINI_RATE_LIMITED',
            retryAfterMs,
            section: section.section_title
          });
      }
      return res.status(500).json({ 
        error: 'Failed to review section with dependencies',
        details: error.message
      });
    }
  } catch (error) {
    console.error('Error in section review with dependencies:', error);
    return res.status(500).json({ error: 'Failed to process section review with dependencies' });
  }
} 
