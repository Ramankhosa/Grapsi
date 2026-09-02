// @ts-nocheck
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getReviewerSession as getServerSession,
  requireReviewerCallAccess,
} from '@/lib/reviewer-auth-api';
import { resolveBucketKey } from '@/lib/reviewer/buckets';
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
        // Group every version of a title together, newest first. Ordering by
        // last_reviewed_at put unreviewed drafts ahead of everything (Postgres
        // sorts NULLS FIRST on DESC) and scattered a title's versions through
        // the list in review-recency order, so the nav showed three unordered
        // rows all called "Objectives". Proposal order is applied client-side
        // by src/lib/reviewer/sectionGrouping.ts.
        const sections = await prisma.reviewerSection.findMany({
          where: { call_id: callId },
          orderBy: [
            { section_title: 'asc' },
            { version: 'desc' },
          ],
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
        
        // Any supplied base must belong to this call — whether or not the
        // client labelled the submission a revision. Validating only the
        // labelled case let a row point at another workspace's section, and
        // the comparison endpoint then read that section.
        if (previous_section_id) {
          const base = await prisma.reviewerSection.findFirst({
            where: { id: previous_section_id, call_id: callId },
            select: { id: true }
          });

          if (!base) {
            return res.status(400).json({
              error: 'Previous section not found',
              details: 'The specified previous_section_id does not exist on this call'
            });
          }
        }

        // Number the new version inside one transaction holding an advisory
        // lock on (call, title). Two concurrent submissions of the same title
        // used to both read "max version = 1" and both create a v2 — and the
        // report and the workspace then disagreed about which v2 was current.
        // The revision flags are returned alongside the row: the asset-copy
        // step and the response below need them, and reading them from inside
        // the transaction closure threw a ReferenceError *after* the row was
        // committed — every submission then 500'd with the version created.
        const { newSection, effectiveIsRevision, effectivePreviousId } = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${callId}::${section_title}`}))`;

          // Always number from the newest version of this title, never from
          // the chosen base. Revising an older draft while a newer one exists
          // would otherwise mint a second row with the same version number,
          // and the reviewer resolves "the previous version" by version order.
          const latestForTitle = await tx.reviewerSection.findFirst({
            where: {
              call_id: callId,
              section_title: section_title
            },
            orderBy: { version: 'desc' },
            select: { id: true, version: true, reviewerBucketKey: true, mappingJson: true }
          });

          const version = latestForTitle ? latestForTitle.version + 1 : 1;

          // Re-submitting a section the user already has is a revision even
          // when the UI did not label it one. Without this the review never
          // sees the earlier remarks and silently re-reviews from scratch.
          const effectiveIsRevision = Boolean(is_revision) || Boolean(latestForTitle);
          const effectivePreviousId = previous_section_id || latestForTitle?.id || null;

          const created = await tx.reviewerSection.create({
            data: {
              call_id: callId,
              section_title,
              user_input,
              ai_review_json: {},
              status: 'draft',
              version,
              previous_section_id: effectivePreviousId,
              review_linked_context: true,
              is_revision: effectiveIsRevision,
              // Semantic identity, resolved server-side so every client is
              // correct by construction. A revision inherits it rather than
              // re-deriving, so renaming a section cannot move it.
              reviewerBucketKey:
                latestForTitle?.reviewerBucketKey ?? resolveBucketKey({ section_title }),
              // Inherited too: `mappingJson.linkedSections` is what
              // `normalizeSectionRecommendations` filters recommendations
              // against, so dropping it silently discarded every recommendation
              // on any revision of a grant-linked section.
              ...(latestForTitle?.mappingJson ? { mappingJson: latestForTitle.mappingJson } : {})
            },
            select: {
              id: true,
              section_title: true,
              version: true
            }
          });

          return { newSection: created, effectiveIsRevision, effectivePreviousId };
        });
        
        // If this is a revision, copy linked assets from previous section (attach_in_prompt defaults to true)
        if (effectiveIsRevision && effectivePreviousId) {
          try {
            const priorLinks = await prisma.reviewAssetLink.findMany({ where: { review_version_id: effectivePreviousId } });
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
          section: newSection,
          is_revision: effectiveIsRevision,
          previous_section_id: effectivePreviousId
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
