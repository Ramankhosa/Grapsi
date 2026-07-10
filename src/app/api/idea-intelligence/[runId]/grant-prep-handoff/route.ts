import { randomUUID } from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingActor } from '@/lib/funding/access'
import { handoffIdeaRunToGrantPrep } from '@/lib/ideaIntelligence/grantPrepHandoff'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'

export const runtime = 'nodejs'
export const maxDuration = 120

const handoffSchema = z.object({
  fundingCallId: z.string().max(80).optional(),
  engagementMode: z.enum(['expert', 'express']).default('expert'),
  projectName: z.string().trim().min(1).max(200).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  if (!auth.actor.tenantId) {
    return NextResponse.json(
      { error: 'A tenant-scoped account is required to create grant projects', code: 'TENANT_REQUIRED' },
      { status: 403 }
    )
  }

  const grantPrepAccess = await enforceServiceAccess(auth.actor.id, auth.actor.tenantId, 'GRANT_PREP')
  if (!grantPrepAccess.allowed) {
    return grantPrepAccess.response
  }

  const operationId = `idea-intelligence-handoff:${params.runId}:${randomUUID()}`
  let reserved = false
  try {
    const payload = handoffSchema.parse(await request.json().catch(() => ({})))
    await reserveServiceUsage({
      tenantId: auth.actor.tenantId,
      userId: auth.actor.id,
      serviceType: 'GRANT_PREP',
      operationId,
      operationType: 'grant_prep_finalize_idea',
      metadata: { ideaIntelligenceRunId: params.runId },
    })
    reserved = true

    const result = await handoffIdeaRunToGrantPrep({
      runId: params.runId,
      actor: {
        id: auth.actor.id,
        email: auth.actor.email ?? null,
        tenantId: auth.actor.tenantId,
        isSuperAdmin: auth.actor.isSuperAdmin,
      },
      fundingCallId: payload.fundingCallId || null,
      engagementMode: payload.engagementMode,
      projectName: payload.projectName || null,
      idempotencyKey: operationId,
    })

    if (result.reused) {
      await releaseReservedServiceUsage(auth.actor.tenantId, 'GRANT_PREP', operationId).catch(() => undefined)
    } else {
      await trackServiceUsage({
        tenantId: auth.actor.tenantId,
        userId: auth.actor.id,
        serviceType: 'GRANT_PREP',
        operationId,
        operationType: 'grant_prep_finalize_idea',
        isCompleted: true,
        metadata: {
          ideaIntelligenceRunId: params.runId,
          grantPrepSessionId: result.grantPrepSessionId,
        },
      })
    }
    reserved = false

    return NextResponse.json({ handoff: result }, { status: result.reused ? 200 : 201 })
  } catch (error) {
    if (reserved) {
      await releaseReservedServiceUsage(auth.actor.tenantId, 'GRANT_PREP', operationId).catch(() => undefined)
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid handoff request' }, { status: 400 })
    }
    console.error('[IdeaIntelligence/GrantPrepHandoff] Failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start Grant Prep from this analysis' },
      { status: error instanceof ServiceQuotaExceededError ? 429 : 500 }
    )
  }
}
