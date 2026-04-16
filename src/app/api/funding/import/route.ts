import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { fundingIntakeService } from '@/lib/fundingIntake/service'
import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { normalizeUrl } from '@/lib/fundingIntake/utils'

export const runtime = 'nodejs'

const importSchema = z.object({
  inputType: z.enum(['url', 'text']),
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().optional(),
  operatorNotes: z.string().max(1000).optional(),
})

export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = importSchema.parse(await request.json())

    if (parsed.inputType === 'url' && parsed.sourceUrl) {
      const submittedUrl = parsed.sourceUrl.trim()
      const normalizedSubmittedUrl = normalizeUrl(submittedUrl)
      const urlCandidates = Array.from(new Set([submittedUrl, normalizedSubmittedUrl]))

      const existingCall = await prisma.fundingCall.findFirst({
        where: {
          AND: [
            buildFundingCallAccessWhere(auth.actor),
            {
              catalog_status: 'PUBLISHED',
              is_active: { not: false },
              OR: [{ source_url: { in: urlCandidates } }, { official_urls: { hasSome: urlCandidates } }],
            },
          ],
        },
        select: {
          id: true,
          agency_name: true,
          scheme_title: true,
          source_url: true,
          official_urls: true,
          close_date: true,
          is_rolling: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      })

      if (existingCall) {
        return NextResponse.json({
          status: 'existing_call_found',
          existingCall: {
            id: existingCall.id,
            agencyName: existingCall.agency_name,
            schemeTitle: existingCall.scheme_title,
            sourceUrl: existingCall.source_url,
            officialUrls: existingCall.official_urls || [],
            closeDate: existingCall.close_date ? existingCall.close_date.toISOString().slice(0, 10) : null,
            isRolling: Boolean(existingCall.is_rolling),
          },
        })
      }
    }

    const job = await fundingIntakeService.createJob(auth.operator, {
      inputType: parsed.inputType,
      sourceUrl: parsed.sourceUrl,
      sourceText: parsed.sourceText,
      operatorNotes: parsed.operatorNotes,
    })

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid import request', issues: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to import funding call' },
      { status: 500 }
    )
  }
}
