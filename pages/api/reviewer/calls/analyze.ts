import type { NextApiRequest, NextApiResponse } from 'next'

import { getReviewerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api'
import { extractReviewerContextFromUrls } from '@/lib/reviewer/callExtraction'
import { MAX_REVIEWER_SOURCE_URLS } from '@/lib/reviewer/sourceText'

export const config = {
  api: {
    bodyParser: { sizeLimit: '256kb' },
    responseLimit: false,
  },
}

/**
 * Extract reviewer rules from user-supplied funding call URLs.
 *
 * This is a preview endpoint: nothing is persisted. The client shows the
 * extracted rules, lets the user correct them, and posts the confirmed context
 * to `POST /api/reviewer/calls`. Re-analysing the same source text is free —
 * `extractReviewerContextFromUrls` reuses a previous extraction when the fetched
 * bytes are identical.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: `Method ${req.method} not allowed` })
  }

  const session = await getReviewerSession(req, res)
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  if (!(await requireGrantReviewFeature(session, res))) return

  const rawUrls: unknown[] = Array.isArray(req.body?.urls)
    ? req.body.urls
    : req.body?.url
      ? [req.body.url]
      : []

  const urls = rawUrls.map((value) => String(value || '').trim()).filter(Boolean)
  if (urls.length === 0) {
    return res.status(400).json({ error: 'Provide at least one funding call URL' })
  }
  if (urls.length > MAX_REVIEWER_SOURCE_URLS) {
    return res
      .status(400)
      .json({ error: `Provide at most ${MAX_REVIEWER_SOURCE_URLS} URLs for one funding call` })
  }

  try {
    const { context, bundle, reused, model } = await extractReviewerContextFromUrls({
      urls,
      manualRubric: req.body?.manualRubric,
      userId: session.user.id,
      tenantId: session.user.tenantId || null,
      llmContext: {
        tenantId: session.user.tenantId || null,
        userId: session.user.id,
      },
      forceRefresh: req.body?.forceRefresh === true,
    })

    return res.status(200).json({
      context,
      diagnostics: {
        reused,
        model,
        sourceHash: bundle.sourceHash,
        documents: bundle.documents.map((document) => ({
          url: document.url,
          finalUrl: document.finalUrl,
          kind: document.kind,
          chars: document.chars,
        })),
        skipped: bundle.skipped,
        sourceChars: bundle.totalChars,
        promptChars: bundle.promptChars,
        truncated: bundle.truncated,
        sectionCount: context.template_sections.length,
        criteriaCount: context.scoring_criteria.length || context.evaluation_criteria.length,
        confidence: context.extraction?.confidence ?? null,
        warnings: [
          ...(context.extraction?.warnings || []),
          ...bundle.skipped.map((entry) => `Skipped ${entry.url} — ${entry.reason}`),
          ...(bundle.truncated
            ? [
                `The sources were longer than the extraction budget, so ${Math.round(
                  (1 - bundle.promptChars / bundle.totalChars) * 100
                )}% of lower-signal text was left out.`,
              ]
            : []),
        ],
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to analyze the funding call URL'
    console.error('[Reviewer] URL analysis failed:', error)
    return res.status(422).json({ error: message, code: 'REVIEWER_URL_ANALYSIS_FAILED' })
  }
}
