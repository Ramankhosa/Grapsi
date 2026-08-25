// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import { buildReviewerPromptScope } from '@/lib/reviewer/promptScope';
import prisma from '../../../../../../../lib/prisma';

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
  
  // Get the call ID and section ID from the URL
  const callId = req.query.id as string;
  const sectionId = req.query.sectionId as string;
  
  if (!callId || !sectionId) {
    return res.status(400).json({ error: 'Call ID and Section ID are required' });
  }
  
  const callAccess = await requireReviewerCallAccess(
    callId,
    session,
    res,
    req.method === 'GET' ? 'read' : 'editContent'
  );
  if (!callAccess) return;
  
  // Handle different HTTP methods
  if (req.method === 'GET') {
    try {
      // Fetch the requested section
      const sections = await prisma.$queryRaw`
        SELECT * FROM "reviewer_sections" 
        WHERE id = ${sectionId} AND call_id = ${callId}
      `;
      
      if (!sections || Array.isArray(sections) && sections.length === 0) {
        return res.status(404).json({ error: 'Section not found' });
      }

      // The exact rule scope reviewSection() will build for this section, so
      // the UI can show the user what the model scores against before running.
      let promptScope = null;
      try {
        const calls = await prisma.$queryRaw`
          SELECT parsed_json FROM "reviewer_calls" WHERE id = ${callId}
        `;
        const parsedJson = Array.isArray(calls) && calls[0]?.parsed_json ? calls[0].parsed_json : null;
        if (parsedJson && typeof parsedJson === 'object') {
          promptScope = buildReviewerPromptScope(sections[0], parsedJson);
        }
      } catch (scopeError) {
        console.warn('Failed to compute prompt scope for section', sectionId, scopeError);
      }

      return res.status(200).json({ section: sections[0], prompt_scope: promptScope });
    } catch (error) {
      console.error('Error fetching section:', error);
      return res.status(500).json({ error: 'Failed to fetch section' });
    }
  } else if (req.method === 'PUT') {
    try {
      const { user_input, section_title } = req.body;
      
      // Validate required fields
      if (!user_input) {
        return res.status(400).json({
          error: 'Missing required fields',
          details: 'Section content is required'
        });
      }
      
      // Check if section exists and can be edited
      const sections = await prisma.$queryRaw`
        SELECT * FROM "reviewer_sections" 
        WHERE id = ${sectionId} AND call_id = ${callId}
      `;
      
      if (!sections || Array.isArray(sections) && sections.length === 0) {
        return res.status(404).json({ error: 'Section not found' });
      }
      
      const section = sections[0];

      // A reviewed section can be corrected in place. Editing the text
      // invalidates the review that scored it, so the section returns to draft
      // and is flagged stale — the stored review is kept so the UI can still
      // show what the last review said while making clear it is out of date.
      // Refusing the edit outright meant a typo cost a whole new version.
      const wasReviewed = section.status === 'reviewed';
      const contentChanged = user_input !== section.user_input;
      const returnsToDraft = wasReviewed && contentChanged;

      const nextTitle = String(section_title || section.section_title).trim() || section.section_title;
      const titleChanged = nextTitle !== section.section_title;

      if (titleChanged) {
        // Versions of a section are grouped by title everywhere (report,
        // workspace, freshness). Renaming one row used to split its lineage:
        // v1 kept the old title, v2 took the new one, and both were scored.
        // A rename therefore applies to the whole lineage, and may not collide
        // with another section's title (that would merge two lineages).
        const clash = await prisma.reviewerSection.findFirst({
          where: { call_id: callId, section_title: nextTitle },
          select: { id: true },
        });
        if (clash) {
          return res.status(409).json({
            error: 'A section with that title already exists in this workspace',
            code: 'SECTION_TITLE_TAKEN',
          });
        }
      }

      // `last_reviewed_at` is left alone: it records when the stored review
      // was written, and stamping it on every edit corrupted version
      // tie-breaks and the legacy freshness comparison.
      const updatedSection = await prisma.$transaction(async (tx) => {
        if (titleChanged) {
          await tx.reviewerSection.updateMany({
            where: { call_id: callId, section_title: section.section_title },
            data: { section_title: nextTitle },
          });
        }
        await tx.$executeRaw`
          UPDATE "reviewer_sections"
          SET
            user_input = ${user_input},
            section_title = ${nextTitle},
            status = ${returnsToDraft ? 'draft' : section.status}::"SectionStatus",
            "sourceStale" = ${returnsToDraft ? true : section.sourceStale}
          WHERE id = ${sectionId}
        `;
        return tx.reviewerSection.findUnique({ where: { id: sectionId } });
      });

      return res.status(200).json({
        success: true,
        section: updatedSection,
        returned_to_draft: returnsToDraft,
        title_changed: titleChanged,
      });

    } catch (error) {
      console.error('Error updating section:', error);
      return res.status(500).json({ error: 'Failed to update section' });
    }
  } else if (req.method === 'DELETE') {
    try {
      // Check if section exists
      const sections = await prisma.$queryRaw`
        SELECT * FROM "reviewer_sections" 
        WHERE id = ${sectionId} AND call_id = ${callId}
      `;
      
      if (!sections || Array.isArray(sections) && sections.length === 0) {
        return res.status(404).json({ error: 'Section not found' });
      }
      
      // Delete the version, keeping the revision chain intact: any later
      // version that pointed at this row is re-pointed to this row's own
      // predecessor. There is no foreign key on previous_section_id, so a bare
      // delete left dangling pointers and the revision review fell back to
      // guessing the previous draft by version number.
      const deleted = sections[0];
      await prisma.$transaction(async (tx) => {
        await tx.reviewerSection.updateMany({
          where: { call_id: callId, previous_section_id: sectionId },
          data: { previous_section_id: deleted.previous_section_id || null },
        });
        await tx.$executeRaw`
          DELETE FROM "reviewer_sections"
          WHERE id = ${sectionId} AND call_id = ${callId}
        `;
      });
      
      return res.status(200).json({ 
        success: true,
        message: 'Section deleted successfully'
      });
      
    } catch (error) {
      console.error('Error deleting section:', error);
      return res.status(500).json({ error: 'Failed to delete section' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
} 
