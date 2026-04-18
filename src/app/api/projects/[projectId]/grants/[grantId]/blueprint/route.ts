import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireProjectGrantActor } from '@/lib/grants/access'
import {
  buildGrantPrepLocalLaunchPreview,
  getGrantWorkspace,
  launchGrantPrepToLocalWorkspace,
  setGrantBlueprintStatus,
  updateBlueprintPlan,
} from '@/lib/grants/workspace'

const planSectionSchema = z.object({
  sectionKey: z.string().min(1),
  label: z.string().min(1),
  order: z.number().int().positive(),
  sectionType: z.enum(['narrative', 'short_answer', 'checklist', 'table', 'budget_rows']),
  required: z.boolean(),
  wordBudget: z.number().int().nullable().optional(),
  characterLimit: z.number().int().nullable().optional(),
  purpose: z.string().min(1),
  reviewerIntent: z.string().nullable().optional(),
  dependencies: z.array(z.string()).default([]),
  sourceTemplatePointer: z.string().nullable().optional(),
  mustCover: z.array(z.string()).default([]),
  mustAvoid: z.array(z.string()).default([]),
  seededContext: z.string().default(''),
})

const proposalFoundationSchema = z.object({
  thesisStatement: z.string().default(''),
  centralObjective: z.string().default(''),
  keyContributions: z.array(z.string()).default([]),
})

const updateBlueprintSchema = z.object({
  sections: z.array(planSectionSchema).min(1).optional(),
  foundation: proposalFoundationSchema.optional(),
})

const blueprintActionSchema = z.object({
  action: z.enum(['freeze', 'unfreeze', 'regenerate']),
  overrideReason: z.string().trim().max(1000).optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read')
  if (actor instanceof NextResponse) {
    return actor
  }

  const workspace = await getGrantWorkspace({
    grantSessionId: grantId,
    tenantId: actor.tenantId,
  })

  if (!workspace || workspace.grantSession.projectId !== projectId) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  const preview = workspace.grantSession.prepSession
    ? await buildGrantPrepLocalLaunchPreview(workspace.grantSession.prepSession.id, actor)
    : null

  return NextResponse.json({
    grantSession: workspace.grantSession,
    blueprint: workspace.blueprint,
    proposalFoundation: workspace.proposalFoundation,
    freezeReadiness: workspace.freezeReadiness,
    launchPreview: preview,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const payload = updateBlueprintSchema.parse(await request.json())
    if (!payload.sections && !payload.foundation) {
      return NextResponse.json(
        { message: 'Provide blueprint sections or proposal foundation updates.' },
        { status: 400 }
      )
    }
    const sections = payload.sections?.map((section) => ({
      ...section,
      wordBudget: section.wordBudget ?? null,
      characterLimit: section.characterLimit ?? null,
      reviewerIntent: section.reviewerIntent ?? null,
      sourceTemplatePointer: section.sourceTemplatePointer ?? null,
    }))
    await updateBlueprintPlan({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      userId: actor.id,
      sections,
      foundation: payload.foundation,
    })

    const workspace = await getGrantWorkspace({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
    })

    return NextResponse.json({
      blueprint: workspace?.blueprint || null,
      proposalFoundation: workspace?.proposalFoundation || null,
      freezeReadiness: workspace?.freezeReadiness || null,
    })
  } catch (error) {
    console.error('[Grant Blueprint] update error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to update grant blueprint',
      },
      { status: 400 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const payload = blueprintActionSchema.parse(await request.json())

    if (payload.action === 'freeze' || payload.action === 'unfreeze') {
      await setGrantBlueprintStatus({
        grantSessionId: grantId,
        tenantId: actor.tenantId,
        userId: actor.id,
        status: payload.action === 'freeze' ? 'FROZEN' : 'DRAFT',
      })
    } else {
      const workspace = await getGrantWorkspace({
        grantSessionId: grantId,
        tenantId: actor.tenantId,
      })

      if (!workspace?.grantSession.prepSession) {
        return NextResponse.json(
          { message: 'A linked Grant Prep session is required to regenerate the blueprint.' },
          { status: 400 }
        )
      }

      await launchGrantPrepToLocalWorkspace({
        sessionId: workspace.grantSession.prepSession.id,
        actor,
        overrideReason: payload.overrideReason,
      })
    }

    const workspace = await getGrantWorkspace({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
    })

    return NextResponse.json({
      grantSession: workspace?.grantSession || null,
      blueprint: workspace?.blueprint || null,
      proposalFoundation: workspace?.proposalFoundation || null,
      freezeReadiness: workspace?.freezeReadiness || null,
    })
  } catch (error) {
    console.error('[Grant Blueprint] action error:', error)
    const issues = error instanceof Error
      ? error.message.split('\n').map((issue) => issue.trim()).filter(Boolean)
      : []
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to process grant blueprint action',
        issues,
      },
      { status: 400 }
    )
  }
}
