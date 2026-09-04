import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { MIN_FREQUENCY_MINUTES } from '@/lib/monitor/checker'
import { normalizeUrl } from '@/lib/monitor/urls'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url().max(2000),
  selector: z.string().max(500).nullish(),
  frequencyMinutes: z.number().int().min(MIN_FREQUENCY_MINUTES).max(20160).default(1440),
  keywords: z.string().max(1000).default(''),
  tags: z.string().max(500).default(''),
  notes: z.string().max(2000).nullish(),
  ownerUserId: z.string().nullish(),
  force: z.boolean().default(false),
})

export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const sources = await prisma.monitoredSource.findMany({
    orderBy: { created_at: 'desc' },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { changes: true } },
    },
  })
  return NextResponse.json({ sources })
}

export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  const url = normalizeUrl(parsed.data.url)
  if (!parsed.data.force) {
    const existing = await prisma.monitoredSource.findFirst({
      where: { OR: [{ url }, { url: `${url}/` }, { url: parsed.data.url }] },
      select: { id: true, name: true },
    })
    if (existing) {
      return NextResponse.json(
        { message: `Already watching this page as "${existing.name}"`, duplicateOf: existing.id },
        { status: 409 }
      )
    }
  }

  const source = await prisma.monitoredSource.create({
    data: {
      name: parsed.data.name,
      url,
      selector: parsed.data.selector || null,
      frequency_minutes: parsed.data.frequencyMinutes,
      keywords: parsed.data.keywords,
      tags: parsed.data.tags,
      notes: parsed.data.notes || null,
      // Whoever adds a source owns its finds unless they named someone else.
      owner_user_id: parsed.data.ownerUserId ?? auth.operator.userId,
      created_by_user_id: auth.operator.userId,
    },
  })
  return NextResponse.json({ source }, { status: 201 })
}
