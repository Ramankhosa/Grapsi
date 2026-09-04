import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { MIN_FREQUENCY_MINUTES } from '@/lib/monitor/checker'
import { normalizeUrl } from '@/lib/monitor/urls'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  urls: z.array(z.string().max(2000)).min(1).max(200),
  frequencyMinutes: z.number().int().min(MIN_FREQUENCY_MINUTES).max(20160).default(1440),
  tags: z.string().max(500).default(''),
})

/**
 * Paste-a-list import, for standing up an existing watch list in one go. Each
 * URL becomes an AUTO-mode source that the next sweep baselines. Duplicates
 * and malformed URLs are reported back rather than silently dropped.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: 'Provide a list of URLs (max 200)' }, { status: 400 })
  }

  const created: string[] = []
  const skipped: { url: string; reason: string }[] = []

  for (const raw of parsed.data.urls) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    let url: string
    let host: string
    try {
      const candidate = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
      if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') {
        throw new Error('unsupported protocol')
      }
      url = normalizeUrl(candidate.toString())
      host = candidate.hostname
    } catch {
      skipped.push({ url: trimmed, reason: 'Not a valid URL' })
      continue
    }

    const existing = await prisma.monitoredSource.findFirst({
      where: { OR: [{ url }, { url: `${url}/` }] },
      select: { name: true },
    })
    if (existing) {
      skipped.push({ url, reason: `Already watched as "${existing.name}"` })
      continue
    }

    await prisma.monitoredSource.create({
      data: {
        name: host,
        url,
        frequency_minutes: parsed.data.frequencyMinutes,
        tags: parsed.data.tags,
        owner_user_id: auth.operator.userId,
        created_by_user_id: auth.operator.userId,
      },
    })
    created.push(url)
  }

  return NextResponse.json({ created: created.length, skipped })
}
