import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const schema = z.object({
  action: z.enum(['confirm', 'dismiss', 'snooze', 'reopen']),
  ignorePattern: z.string().max(500).optional(),
  snoozeDays: z.number().int().min(1).max(90).optional(),
  /** Override the URL sent to intake, when the reviewer knows better. */
  intakeUrl: z.string().url().max(2000).optional(),
})

type ExtractedPayload = {
  summary?: string
  opportunities?: { title?: string; link?: string }[]
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: 'Invalid action' }, { status: 400 })
  }

  const change = await prisma.monitoredChange.findUnique({
    where: { id: params.id },
    include: { source: true },
  })
  if (!change) return NextResponse.json({ message: 'Not found' }, { status: 404 })

  const { action } = parsed.data

  if (action === 'confirm') {
    // Already handed over: don't create a second intake job for one find.
    if (change.intake_job_id) {
      return NextResponse.json({
        ok: true,
        state: 'CONFIRMED',
        intakeJobId: change.intake_job_id,
        alreadyLinked: true,
      })
    }

    // Prefer the specific call page the triage step extracted — it reads far
    // better than the listing page the link was found on.
    const extracted = (change.extracted ?? null) as ExtractedPayload | null
    const extractedLink = extracted?.opportunities?.find((o) => o?.link)?.link
    const intakeUrl = parsed.data.intakeUrl || extractedLink || change.source.url

    let job
    try {
      job = await fundingIntakeService.createJob(auth.operator, {
        inputType: 'url',
        sourceUrl: intakeUrl,
        operatorNotes: `Detected by Moni on "${change.source.name}" (${change.source.url}).${
          extracted?.summary ? ` ${extracted.summary}` : ''
        }`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Intake failed'
      return NextResponse.json(
        { message: `Could not hand this to funding intake: ${message}` },
        { status: 502 }
      )
    }

    await prisma.monitoredChange.update({
      where: { id: change.id },
      data: {
        state: 'CONFIRMED',
        resolved_at: new Date(),
        resolved_by_user_id: auth.operator.userId,
        intake_job_id: job.id,
        linked_funding_call_id: (job as { linked_funding_call_id?: string | null })
          .linked_funding_call_id ?? null,
      },
    })

    return NextResponse.json({ ok: true, state: 'CONFIRMED', intakeJobId: job.id })
  }

  if (action === 'dismiss') {
    // "Never flag this again" writes the rule that makes the queue quieter
    // every week — the noise filter is learned, not configured up front.
    if (parsed.data.ignorePattern) {
      await prisma.monitoredIgnoreRule.create({
        data: {
          source_id: change.source_id,
          pattern: parsed.data.ignorePattern,
          created_by_user_id: auth.operator.userId,
        },
      })
    }
    await prisma.monitoredChange.update({
      where: { id: change.id },
      data: {
        state: 'DISMISSED',
        resolved_at: new Date(),
        resolved_by_user_id: auth.operator.userId,
      },
    })
    return NextResponse.json({ ok: true, state: 'DISMISSED' })
  }

  if (action === 'snooze') {
    const days = parsed.data.snoozeDays ?? 7
    await prisma.monitoredChange.update({
      where: { id: change.id },
      data: { state: 'SNOOZED', snoozed_until: new Date(Date.now() + days * 86_400_000) },
    })
    return NextResponse.json({ ok: true, state: 'SNOOZED' })
  }

  await prisma.monitoredChange.update({
    where: { id: change.id },
    data: { state: 'NEW', resolved_at: null, snoozed_until: null, resolved_by_user_id: null },
  })
  return NextResponse.json({ ok: true, state: 'NEW' })
}
