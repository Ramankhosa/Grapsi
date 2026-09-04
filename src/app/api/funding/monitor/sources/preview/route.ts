import * as cheerio from 'cheerio'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { discoverFeed, fetchUrl } from '@/lib/monitor/fetcher'
import { extractText, selectorMatches } from '@/lib/monitor/normalize'
import { feedToText } from '@/lib/monitor/rss'
import { suggestSelectors } from '@/lib/monitor/suggest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const schema = z.object({
  url: z.string().url(),
  selector: z.string().max(500).nullish(),
})

/**
 * Test-fetch before saving: discovers a feed, suggests which region of the
 * page to watch, and shows exactly the text Moni would compare on each run.
 * The suggestions are what let a finder add a source without writing CSS.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: 'Enter a valid URL (including https://)' }, { status: 400 })
  }
  const { url, selector } = parsed.data

  try {
    const html = await fetchUrl(url)
    const feedUrl = await discoverFeed(url, html)

    let feedPreview: string[] | null = null
    if (feedUrl) {
      try {
        feedPreview = (await feedToText(await fetchUrl(feedUrl))).split('\n').slice(0, 15)
      } catch {
        feedPreview = null
      }
    }

    const pageTitle = cheerio.load(html)('title').first().text().replace(/\s+/g, ' ').trim()
    const text = extractText(html, url, selector)

    return NextResponse.json({
      pageTitle: pageTitle || null,
      feedUrl: feedPreview ? feedUrl : null,
      feedPreview,
      selectorOk: selector?.trim() ? selectorMatches(html, selector.trim()) : null,
      suggestions: selector?.trim() ? [] : suggestSelectors(html, url),
      lines: text.split('\n').slice(0, 40),
      totalLines: text.split('\n').length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fetch failed'
    return NextResponse.json({ message: `Could not fetch this page: ${message}` }, { status: 502 })
  }
}
