import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { releaseImportedCalls } from '@/lib/fundingCatalogImport/release'
import { requireFundingPublisherRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  sourceKey: z.string().min(1).max(64).default('scientify'),
  dryRun: z.boolean().optional(),
  // Bounded per request so one click never outlives a proxy timeout; the
  // page repeats until nothing clear is left. Larger runs: the CLI.
  limit: z.number().int().positive().max(2000).default(2000),
})

/**
 * Releases an import run's CLEAR calls to researcher discovery, silently:
 * no embedding, classification, school mapping, notices or alerts. Calls
 * stay GLOBAL_CATALOG, so funding-department workflows still ignore them.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  try {
    const result = await releaseImportedCalls({ db: prisma as any, sourceKey: parsed.data.sourceKey, dryRun: parsed.data.dryRun ?? false, limit: parsed.data.limit })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Release failed' }, { status: 500 })
  }
}
