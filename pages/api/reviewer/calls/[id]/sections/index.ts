// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession } from '@/lib/reviewer-auth-api';
import prisma from '../../../../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Get the user session
    const session = await getServerSession(req, res);
    
    // Check authentication
    if (!session || !session.user?.id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get the call ID from the URL
    const callId = req.query.id;
    
    if (!callId || typeof callId !== 'string') {
      return res.status(400).json({ error: 'Valid call ID is required' });
    }
    
    // Verify the call belongs to the user
    try {
      const call = await prisma.reviewerCall.findUnique({
        where: { id: callId },
        select: { user_id: true }
      });
      
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      if (call.user_id !== session.user.id) {
        return res.status(403).json({ error: 'Not authorized to access this call' });
      }
    } catch (error) {
      console.error('Error verifying call ownership:', error);
      return res.status(500).json({ 
        error: 'Failed to verify call ownership',
        details: error.message
      });
    }
    
    // Handle different HTTP methods
    if (req.method === 'GET') {
      try {
        // Fetch all sections for this call using Prisma client
        const sections = await prisma.reviewerSection.findMany({
          where: { call_id: callId },
          orderBy: { last_reviewed_at: 'desc' }
        });
        
        return res.status(200).json({ sections });
      } catch (error) {
        console.error('Error fetching sections:', error);
        return res.status(500).json({ 
          error: 'Failed to fetch sections',
          details: error.message
        });
      }
    } else if (req.method === 'POST') {
      try {
        const { section_title, user_input, previous_section_id, is_revision } = req.body;
        
        // Validate required fields
        if (!section_title || !user_input) {
          return res.status(400).json({ 
            error: 'Missing required fields', 
            details: 'Both section_title and user_input are required' 
          });
        }
        
        // Check if there's already a section with this title to determine version
        let version = 1;
        
        if (is_revision && previous_section_id) {
          // For revisions, fetch the previous version number
          const previousSection = await prisma.reviewerSection.findUnique({
            where: { id: previous_section_id },
            select: { version: true }
          });
          
          if (previousSection) {
            version = previousSection.version + 1;
          } else {
            return res.status(400).json({
              error: 'Previous section not found',
              details: 'The specified previous_section_id does not exist'
            });
          }
        } else if (!is_revision) {
          // For new sections (not revisions), check if the title exists
          const existingSection = await prisma.reviewerSection.findFirst({
            where: {
              call_id: callId,
              section_title: section_title
            },
            orderBy: { version: 'desc' },
            select: { version: true }
          });
          
          if (existingSection) {
            version = existingSection.version + 1;
          }
        }
        
        // Insert the new section using Prisma client
        const newSection = await prisma.reviewerSection.create({
          data: {
            call_id: callId,
            section_title,
            user_input,
            ai_review_json: {},
            status: 'draft',
            version,
            previous_section_id: previous_section_id || null,
            review_linked_context: true,
            is_revision: !!is_revision
          },
          select: {
            id: true,
            section_title: true,
            version: true
          }
        });
        
        // If this is a revision, copy linked assets from previous section (attach_in_prompt defaults to true)
        if (is_revision && previous_section_id) {
          try {
            const priorLinks = await prisma.reviewAssetLink.findMany({ where: { review_version_id: previous_section_id } });
            if (priorLinks.length > 0) {
              // Enforce per-section max 3 when copying
              const byType: Record<string, number> = {};
              for (const l of priorLinks.sort((a,b)=>a.order-b.order)) {
                const type = l.section_type as string;
                byType[type] = byType[type] ?? 0;
                if (byType[type] >= 3) continue;
                await prisma.reviewAssetLink.create({ data: {
                  review_version_id: newSection.id,
                  section_type: l.section_type,
                  asset_id: l.asset_id,
                  order: byType[type],
                  attach_in_prompt: true,
                }});
                byType[type]++;
              }
            }
          } catch (e) {
            console.warn('Failed to copy asset links for revision', e);
          }
        }
        
        return res.status(201).json({ 
          message: 'Section created successfully',
          section: newSection
        });
      } catch (error) {
        console.error('Error creating section:', error);
        return res.status(500).json({ 
          error: 'Failed to create section',
          details: error.message
        });
      }
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('Unexpected error in sections API:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred',
      details: error.message
    });
  }
} 