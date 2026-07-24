import type { NextApiRequest, NextApiResponse } from 'next'

import { getReviewerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api'
import { fetchReviewerSourceDocument, MAX_REVIEWER_SOURCE_URLS } from '@/lib/reviewer/sourceText'

const MIN_USEFUL_CHARS = 1200

/**
 * Preflight for the URL route of reviewer setup: confirms each URL is
 * reachable and carries enough readable text to extract rules from, without
 * spending any LLM tokens. The user fixes bad links here rather than after a
 * paid extraction returns nothing.
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

  const rawUrls: string[] = Array.isArray(req.body?.urls)
    ? req.body.urls
    : req.body?.url
      ? [req.body.url]
      : []

  const urls = Array.from(
    new Set(
      rawUrls
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean)
        .map((value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    )
  ).slice(0, MAX_REVIEWER_SOURCE_URLS)

  if (urls.length === 0) {
    return res.status(400).json({ error: 'Provide at least one funding call URL' })
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const document = await fetchReviewerSourceDocument(url)
        return {
          url,
          ok: document.chars >= MIN_USEFUL_CHARS,
          finalUrl: document.finalUrl,
          kind: document.kind,
          chars: document.chars,
          preview: document.text.slice(0, 400),
          message:
            document.chars >= MIN_USEFUL_CHARS
              ? null
              : 'This page has very little readable text. It may be a landing page — try the guidelines or call-document link instead.',
        }
      } catch (error) {
        return {
          url,
          ok: false,
          finalUrl: null,
          kind: null,
          chars: 0,
          preview: null,
          message: error instanceof Error ? error.message : 'Could not be fetched',
        }
      }
    })
  )

  return res.status(200).json({
    results,
    readableCount: results.filter((result) => result.ok).length,
    totalChars: results.reduce((total, result) => total + result.chars, 0),
  })
}
