// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import prisma from '../../../../../lib/prisma';
import { ContextSummaryService } from '../../../../../lib/services/contextSummaryService';
import { selectContextProviderTitles } from '../../../../../lib/reviewerService';
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
  
  // Get the call ID from the URL
  const callId = req.query.id as string;
  
  // Check if we should force regeneration of all summaries
  const forceRegenerate = req.body?.forceRegenerate === true;
  
  if (!callId) {
    return res.status(400).json({ error: 'Call ID is required' });
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
    
    // Get all sections for this call that have content
    const sections = await prisma.$queryRaw`
      SELECT id, section_title, user_input, context_summary, "mappingJson"
      FROM "reviewer_sections" 
      WHERE call_id = ${callId}
      AND user_input IS NOT NULL AND user_input != ''
    `;
    
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(404).json({ error: 'No sections found' });
    }
    
    const model = call.LLM_model_used || 'G'; // Default to Gemini if not specified
    const contextSummaryService = new ContextSummaryService({
      requestHeaders: req.headers,
      stageCode: 'GRANT_REVIEWER_CONTEXT_SUMMARY',
    });

    // A section review already emits its own context_summary. The only reason
    // to pre-generate one here is so that a *later* section can read it as
    // cross-section context. Sections nothing depends on get a free derived
    // summary instead of a model call, which cuts this step's LLM calls
    // roughly in half on a full proposal.
    const contextProviders = selectContextProviderTitles(
      (sections as any[]).map((section) => section.section_title)
    );
    const skipUnusedProviders = req.body?.includeAllSections !== true;

    // Process each section
    const results = [];
    for (const section of sections as any[]) {
      if (!hasAppDraftReviewerLink(section)) {
        results.push({
          id: section.id,
          title: section.section_title,
          status: 'skipped',
          error: 'Section is not linked to app-draft content'
        });
        continue;
      }

      if (!hasMeaningfulSectionContent(section.user_input)) {
        results.push({
          id: section.id,
          title: section.section_title,
          status: 'skipped',
          error: 'Section has no meaningful content'
        });
        continue;
      }

      if (!forceRegenerate && isUsableContextSummary(section.context_summary)) {
        results.push({
          id: section.id,
          title: section.section_title,
          status: 'existing',
          context_summary: section.context_summary
        });
        continue;
      }

      if (skipUnusedProviders && !contextProviders.has(section.section_title)) {
        const derived = buildFallbackContextSummary(section.user_input);
        await prisma.$queryRaw`
          UPDATE "reviewer_sections"
          SET context_summary = ${derived}
          WHERE id = ${section.id}
        `;
        results.push({
          id: section.id,
          title: section.section_title,
          status: 'derived',
          context_summary: derived,
        });
        continue;
      }

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
      success_count: results.filter(r => ['success', 'existing', 'derived'].includes(r.status)).length,
      generated_count: results.filter(r => r.status === 'success').length,
      derived_count: results.filter(r => r.status === 'derived').length,
      skipped_count: results.filter(r => r.status === 'skipped').length,
      results: results
    });
    
  } catch (error) {
    console.error('Error processing context summaries:', error);
    return res.status(500).json({ error: 'Failed to process context summaries' });
  }
} 
