import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  requireFundingOperatorRequest,
  requireFundingReadOperatorRequest,
} from '@/lib/fundingIntake/routeAuth'
import { MIN_FREQUENCY_MINUTES } from '@/lib/monitor/checker'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  url: z.string().url().max(2000).optional(),
  selector: z.string().max(500).nullish(),
  frequencyMinutes: z.number().int().min(MIN_FREQUENCY_MINUTES).max(20160).optional(),
  keywords: z.string().max(1000).optional(),
  tags: z.string().max(500).optional(),
  notes: z.string().max(2000).nullish(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  ownerUserId: z.string().nullish(),
})

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const source = await prisma.monitoredSource.findUnique({
    where: { id: params.id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      ignoreRules: { orderBy: { created_at: 'desc' } },
      changes: { orderBy: { created_at: 'desc' }, take: 20 },
      _count: { select: { snapshots: true } },
    },
  })
  if (!source) return NextResponse.json({ message: 'Not found' }, { status: 404 })
  return NextResponse.json({ source })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  const data = parsed.data
  try {
    const source = await prisma.monitoredSource.update({
      where: { id: params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.selector !== undefined ? { selector: data.selector || null } : {}),
        ...(data.frequencyMinutes !== undefined
          ? { frequency_minutes: data.frequencyMinutes }
          : {}),
        ...(data.keywords !== undefined ? { keywords: data.keywords } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.ownerUserId !== undefined ? { owner_user_id: data.ownerUserId || null } : {}),
      },
    })
    return NextResponse.json({ source })
  } catch {
    return NextResponse.json({ message: 'Not found' }, { status: 404 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  try {
    await prisma.monitoredSource.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ message: 'Not found' }, { status: 404 })
  }
}
