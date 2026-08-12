// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api';
import prisma from '../../../../lib/prisma';
import {
  buildReviewerContextFromStoredCall,
  normalizeReviewerCallContext,
} from '@/lib/reviewer/callContext';
import { extractReviewerContextFromUrls } from '@/lib/reviewer/callExtraction';
import { createReviewerCallFromContext } from '@/lib/reviewer/template-bridge';
import { MAX_REVIEWER_SOURCE_URLS } from '@/lib/reviewer/sourceText';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check authentication
  const session = await getServerSession(req, res);
  if (!session || !session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!(await requireGrantReviewFeature(session, res))) return;

  const userId = session.user.id;

  // GET request - List reviewer calls
  if (req.method === 'GET') {
    try {
      const { projectTitle } = req.query;

      // Build the query
      const queryConditions: any = {
        user_id: userId
      };

      // Add project title filter if provided
      if (projectTitle && typeof projectTitle === 'string') {
        queryConditions.project_title = {
          contains: projectTitle,
          mode: 'insensitive' // Case insensitive search
        };
      }

      // Fetch the calls
      const calls = await prisma.reviewerCall.findMany({
        where: queryConditions,
        orderBy: { created_at: 'desc' },
      });

      // Review progress per workspace, so the list can say "6 of 8 reviewed"
      // instead of the ingestion status it used to show. `review_status` is a
      // parser state that has been "parsed" for every workspace since the
      // analyzer was removed, so as a list badge it told the user nothing.
      //
      // Section rows are counted per *title* (a revision is a new row), and
      // `ai_review_json` is deliberately not selected — it is the largest
      // column on the table and nothing here needs it.
      const sectionRows = calls.length > 0
        ? await prisma.reviewerSection.findMany({
            where: { call_id: { in: calls.map((call) => call.id) } },
            select: {
              call_id: true,
              section_title: true,
              version: true,
              status: true,
              sourceStale: true,
            },
          })
        : [];

      const newestByCallAndTitle = new Map<string, any>();
      for (const row of sectionRows) {
        const key = `${row.call_id}::${row.section_title}`;
        const seen = newestByCallAndTitle.get(key);
        if (!seen || Number(row.version || 1) > Number(seen.version || 1)) {
          newestByCallAndTitle.set(key, row);
        }
      }

      const progressByCall = new Map<string, { total: number; reviewed: number; stale: number }>();
      for (const row of newestByCallAndTitle.values()) {
        const entry = progressByCall.get(row.call_id) || { total: 0, reviewed: 0, stale: 0 };
        entry.total += 1;
        // `sourceStale` is only ever set together with a return to draft, so
        // these two are disjoint.
        if (row.sourceStale) entry.stale += 1;
        else if (row.status === 'reviewed') entry.reviewed += 1;
        progressByCall.set(row.call_id, entry);
      }

      const callsWithProgress = calls.map((call) => ({
        ...call,
        progress: progressByCall.get(call.id) || { total: 0, reviewed: 0, stale: 0 },
        has_report: Boolean(
          call.overall_review_json && Object.keys(call.overall_review_json as object).length > 0
        ),
      }));

      return res.status(200).json({ calls: callsWithProgress });
    } catch (error) {
      console.error('Error fetching reviewer calls:', error);
      return res.status(500).json({ error: 'Failed to fetch reviewer calls' });
    }
  }

  // POST request - Create a new reviewer call
  else if (req.method === 'POST') {
    const {
      sourceMode,
      fundingCallId,
      sourceUrls,
      sourceUrl,
      analyzedContext,
      project_title,
      manualRubric,
      seedSections,
    } = req.body || {};

    if (!project_title || !String(project_title).trim()) {
      return res.status(400).json({ error: 'Project title is required' });
    }

    const mode = sourceMode === 'url' ? 'url' : fundingCallId ? 'library' : sourceUrls || sourceUrl ? 'url' : null;
    if (!mode) {
      return res.status(400).json({ error: 'Select a stored funding call or supply the funding call URL' });
    }

    try {
      // ---- Stored funding call --------------------------------------------
      if (mode === 'library') {
        const fundingCall = await prisma.fundingCall.findFirst({
          where: {
            id: String(fundingCallId),
            OR: [
              { visibility: 'GLOBAL_PUBLISHED' },
              ...(session.user.tenantId ? [{ tenantId: session.user.tenantId }] : []),
            ],
          },
          select: { id: true },
        });

        if (!fundingCall) {
          return res.status(404).json({ error: 'Funding call not found or not accessible' });
        }

        const { context, templateSnapshot } = await buildReviewerContextFromStoredCall({
          fundingCallId: String(fundingCallId),
          manualRubric,
        });

        const newCall = await createReviewerCallFromContext({
          userId,
          tenantId: session.user.tenantId || null,
          context,
          templateSnapshot,
          projectTitle: String(project_title).trim(),
          seedSections: seedSections === true,
        });

        return res.status(201).json({ call: newCall, rulesSource: context.rules_source });
      }

      // ---- User-supplied funding call URL ---------------------------------
      const urls = (Array.isArray(sourceUrls) ? sourceUrls : sourceUrl ? [sourceUrl] : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean)
        .slice(0, MAX_REVIEWER_SOURCE_URLS);

      // The client normally posts back the context it just previewed (and
      // possibly corrected), so creation costs nothing. Only re-extract when
      // no preview was supplied.
      let context;
      let rawTextBackup: string | null = null;

      if (analyzedContext && typeof analyzedContext === 'object') {
        context = normalizeReviewerCallContext({
          ...analyzedContext,
          rules_source: 'url_extracted',
          source_urls: urls.length > 0 ? urls : analyzedContext.source_urls,
          manual_rubric: manualRubric ?? analyzedContext.manual_rubric,
        });
        if (context.template_sections.length === 0) {
          return res.status(400).json({
            error: 'The reviewer rules are empty. Re-run the URL analysis before creating the workspace.',
          });
        }
      } else {
        if (urls.length === 0) {
          return res.status(400).json({ error: 'Provide at least one funding call URL' });
        }
        const extraction = await extractReviewerContextFromUrls({
          urls,
          manualRubric,
          userId,
          tenantId: session.user.tenantId || null,
          llmContext: { tenantId: session.user.tenantId || null, userId },
        });
        context = extraction.context;
        rawTextBackup = extraction.bundle.combinedText.slice(0, 400000);
      }

      const newCall = await createReviewerCallFromContext({
        userId,
        tenantId: session.user.tenantId || null,
        context,
        templateSnapshot: {
          source: 'url_extracted',
          sourceUrls: context.source_urls,
          extraction: context.extraction,
          capturedAt: new Date().toISOString(),
        },
        projectTitle: String(project_title).trim(),
        seedSections: seedSections !== false,
        rawTextBackup,
      });

      return res.status(201).json({ call: newCall, rulesSource: context.rules_source });
    } catch (error) {
      console.error('Error creating reviewer call:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create reviewer call',
      });
    }
  }

  // Method not allowed
  else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}
