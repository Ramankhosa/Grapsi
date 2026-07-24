// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../../../lib/prisma';
import { ContextSummaryService } from '../../../../../../../lib/services/contextSummaryService';
import { selectContextProviderTitles } from '../../../../../../../lib/reviewerService';
import { buildFallbackContextSummary, hasMeaningfulSectionContent } from '@/lib/reviewer/content';

function isUsableContextSummary(value: unknown): boolean {
  const text = String(value || '').trim();
  return Boolean(text) && text !== 'Not Available' && !/generation failed/i.test(text);
}

function hasAppDraftReviewerLink(section: any): boolean {
  const mappingJson = section?.mappingJson && typeof section.mappingJson === 'object' ? section.mappingJson : {};
  const linkedSections = Array.isArray(mappingJson.linkedSections) ? mappingJson.linkedSections : [];
  const declaresWorkflow = linkedSections.some((link: any) => typeof link?.workflowMode === 'string');
  return !declaresWorkflow || linkedSections.some((link: any) => String(link?.workflowMode || 'app_draft') === 'app_draft');
}

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
  const forceRegenerate = req.body?.forceRegenerate === true;
  
  if (!callId || !sectionId) {
    return res.status(400).json({ error: 'Call ID and Section ID are required' });
  }
  
  try {
    const callAccess = await requireReviewerCallAccess(callId, session, res, 'editContent');
    if (!callAccess) return;

    const calls = await prisma.$queryRaw`
      SELECT "LLM_model_used" FROM "reviewer_calls" 
      WHERE id = ${callId}
    `;
    
    const call = calls[0];
    
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Get the section to generate a context summary for
    const sections = await prisma.$queryRaw`
      SELECT id, section_title, user_input, context_summary, "mappingJson"
      FROM "reviewer_sections" 
      WHERE id = ${sectionId} AND call_id = ${callId}
    `;
    
    if (!sections || Array.isArray(sections) && sections.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const section = sections[0];

    if (!hasAppDraftReviewerLink(section)) {
      return res.status(400).json({
        error: 'This reviewer section is not linked to app-draft content and does not need a context summary.',
        code: 'NO_APP_DRAFT_CONTENT',
      });
    }
    
    if (!hasMeaningfulSectionContent(section.user_input)) {
      return res.status(400).json({
        error: 'Section has no meaningful content',
        code: 'SECTION_CONTENT_MISSING',
      });
    }

    if (!forceRegenerate && isUsableContextSummary(section.context_summary)) {
      return res.status(200).json({
        message: 'Existing context summary reused',
        section_title: section.section_title,
        context_summary: section.context_summary,
        reused: true,
      });
    }
    
    // A context summary only earns its cost when a *later* section reads it as
    // review context. For a section nothing depends on (a Conclusion, an
    // annexure), store its own opening text instead: free, and the field is
    // still populated so the review flow does not treat it as unprepared.
    const siblingTitles: any[] = await prisma.$queryRaw`
      SELECT section_title FROM "reviewer_sections" WHERE call_id = ${callId}
    `;
    const isContextProvider = selectContextProviderTitles(
      (Array.isArray(siblingTitles) ? siblingTitles : []).map((row: any) => row.section_title)
    ).has(section.section_title);

    let contextSummary: string;
    let generated = false;

    if (isContextProvider) {
      const model = call.LLM_model_used || 'G'; // Default to Gemini if not specified
      const contextSummaryService = new ContextSummaryService({
        requestHeaders: req.headers,
        stageCode: 'GRANT_REVIEWER_CONTEXT_SUMMARY',
      });

      contextSummary = await contextSummaryService.generateContextSummary(
        section.section_title,
        section.user_input,
        model as 'O' | 'G'
      );
      generated = true;
    } else {
      contextSummary = buildFallbackContextSummary(section.user_input);
    }

    // Update the database
    await prisma.$queryRaw`
      UPDATE "reviewer_sections"
      SET context_summary = ${contextSummary}
      WHERE id = ${sectionId}
    `;

    // Return success
    return res.status(200).json({
      message: generated ? 'Context summary generated' : 'Context summary derived without a model call',
      section_title: section.section_title,
      context_summary: contextSummary,
      generated,
    });
    
  } catch (error) {
    console.error('Error generating context summary:', error);
    return res.status(500).json({ error: 'Failed to generate context summary' });
  }
} 
