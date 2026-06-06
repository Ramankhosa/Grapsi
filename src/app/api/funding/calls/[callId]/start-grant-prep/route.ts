import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingActor } from '@/lib/funding/access'
import { buildFundingCallAccessWhere } from '@/lib/fundingIntake/routeAuth'
import { createOrReuseGrantPrepSession } from '@/lib/grantPrep/server'
import { normalizeGrantPrepEngagementMode } from '@/lib/grantPrep/types'
import { prisma } from '@/lib/prisma'
import { enforceServiceAccess } from '@/lib/service-access-middleware'

const startGrantPrepSchema = z.object({
  engagementMode: z.preprocess(normalizeGrantPrepEngagementMode, z.enum(['expert', 'express'])).default('expert'),
  projectName: z.string().trim().min(1).max(200).optional(),
  selectedThrustAreaRuleKeys: z.array(z.string()).optional(),
  selectedPriorityAreas: z.array(z.string()).optional(),
})

function buildGrantProjectName(call: { scheme_title?: string | null; title?: string | null }) {
  const baseTitle = (call.scheme_title || call.title || 'Funding Call').trim()
  const projectName = `Grant: ${baseTitle}`
  return projectName.length <= 200 ? projectName : `${projectName.slice(0, 197).trimEnd()}...`
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) {
    return auth.response
  }

  const { callId } = await params
  if (!callId) {
    return NextResponse.json({ error: 'Invalid funding call id' }, { status: 400 })
  }

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

  try {
    const payload = startGrantPrepSchema.parse(await request.json().catch(() => ({})))
    const fundingCall = await prisma.fundingCall.findFirst({
      where: {
        AND: [{ id: callId }, buildFundingCallAccessWhere(auth.actor)],
      },
      select: {
        id: true,
        scheme_title: true,
        title: true,
      },
    })

    if (!fundingCall) {
      return NextResponse.json({ error: 'Funding call not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const project = await prisma.project.create({
      data: {
        name: payload.projectName || buildGrantProjectName(fundingCall),
        projectType: 'GRANT',
        userId: auth.actor.id,
        tenantId: auth.actor.tenantId,
      },
      select: {
        id: true,
        name: true,
        projectType: true,
        tenantId: true,
        userId: true,
      },
    })

    try {
      const sessionResult = await createOrReuseGrantPrepSession({
        projectId: project.id,
        tenantId: auth.actor.tenantId,
        user: {
          id: auth.actor.id,
          email: auth.actor.email ?? null,
          tenantId: auth.actor.tenantId,
        },
        fundingCallId: fundingCall.id,
        engagementMode: payload.engagementMode,
        selectedThrustAreaRuleKeys: payload.selectedPriorityAreas ?? payload.selectedThrustAreaRuleKeys,
        restart: false,
      })

      if (!sessionResult.session) {
        throw new Error('Failed to create Grant Prep session')
      }

      return NextResponse.json(
        {
          project,
          session: sessionResult.session,
          grantSessionId: sessionResult.grantSessionId || null,
          // Launch directly into the unified pipeline with GrantMentor as stage 1.
          launchUrl: sessionResult.launchUrl || null,
          prepUrl: sessionResult.prepUrl || `/projects/${project.id}/grants/${sessionResult.session.id}/prep`,
        },
        { status: 201 }
      )
    } catch (sessionError) {
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined)
      throw sessionError
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 })
    }

    console.error('[Funding/Calls/:callId/start-grant-prep] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create the grant project' },
      { status: 500 }
    )
  }
}
