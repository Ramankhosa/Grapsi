// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../../../lib/prisma';
import { SECTION_DEPENDENCIES } from '../../../../../../../lib/reviewerService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
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
    const callAccess = await requireReviewerCallAccess(callId, session, res, 'read');
    if (!callAccess) return;
    
    // Get the section to find relevant dependencies
    const sections = await prisma.$queryRaw`
      SELECT id, section_title, context_summary, status, version, last_reviewed_at
      FROM "reviewer_sections" 
      WHERE id = ${sectionId} AND call_id = ${callId}
    `;
    
    if (!sections || Array.isArray(sections) && sections.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const section = sections[0];
    
    // Get dependencies based on section type
    const contextSectionIds = SECTION_DEPENDENCIES[section.section_title] || [];
    
    // If this is a revision, also get the previous version's context summary
    let summaries = [];
    
    if (section.version && section.version > 1) {
      const prevSections = await prisma.$queryRaw`
        SELECT id, section_title, context_summary, version, last_reviewed_at
        FROM "reviewer_sections" 
        WHERE call_id = ${callId} 
        AND section_title = ${section.section_title}
        AND version < ${section.version}
        ORDER BY version DESC
        LIMIT 1
      `;
      
      if (Array.isArray(prevSections) && prevSections.length > 0) {
        const prevSection = prevSections[0];
        if (prevSection.context_summary) {
          summaries.push({
            section_title: `${prevSection.section_title} (Previous Version)`,
            context_summary: prevSection.context_summary,
            version: prevSection.version,
            last_reviewed_at: prevSection.last_reviewed_at
          });
        }
      }
    }
    
    // Get context summaries for dependencies
    if (contextSectionIds.length > 0) {
      const contextSections = await prisma.$queryRaw`
        SELECT id, section_title, context_summary, version, last_reviewed_at
        FROM "reviewer_sections" 
        WHERE call_id = ${callId} 
        AND section_title = ANY(${contextSectionIds}::text[])
        AND context_summary IS NOT NULL
      `;
      
      if (Array.isArray(contextSections) && contextSections.length > 0) {
        for (const cs of contextSections) {
          summaries.push({
            section_title: cs.section_title,
            context_summary: cs.context_summary,
            version: cs.version,
            last_reviewed_at: cs.last_reviewed_at
          });
        }
      }
    }
    
    return res.status(200).json({ 
      summaries
    });
  } catch (error) {
    console.error('Error fetching prior section summaries:', error);
    return res.status(500).json({ error: 'Failed to fetch prior section summaries' });
  }
} 
