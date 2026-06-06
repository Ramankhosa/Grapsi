import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { generateGrantSectionDraft, saveGrantSectionDraft } from '@/lib/grants/drafting'
import { requireProjectGrantActor } from '@/lib/grants/access'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'

const generateSchema = z.object({
  action: z.enum(['generate', 'regenerate']).default('generate'),
  userInstructions: z.string().max(5000).optional(),
  allowInstructionAmounts: z.boolean().optional().default(false),
  overwriteAmounts: z.boolean().optional().default(false),
  useCurrentBudgetValues: z.boolean().optional().default(false),
  bibliographyStyle: z.string().max(64).optional(),
  bibliographySortOrder: z.enum(['alphabetical', 'order_of_appearance']).optional(),
})

const saveSchema = z.object({
  content: z.string().optional().nullable(),
  structuredData: z.unknown().optional(),
  markReviewed: z.boolean().optional().default(false),
})

const GRANT_SECTION_ROUTE_QUOTA_CHECKS_DISABLED = true

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; sectionKey: string }> }
) {
  const { projectId, grantId, sectionKey } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) {
    return actor
  }

  const workspace = await getGrantWorkspace({
    grantSessionId: grantId,
    tenantId: actor.tenantId,
  })
  if (!workspace || workspace.grantSession.projectId !== projectId || !workspace.blueprint) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  const section = workspace.blueprint.sectionDrafts.find((draft) => draft.sectionKey === sectionKey)
  if (!section) {
    return NextResponse.json({ message: 'Grant section not found' }, { status: 404 })
  }

  return NextResponse.json({ section })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; sectionKey: string }> }
) {
  const { projectId, grantId, sectionKey } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) {
    return actor
  }

  const operationId = `grant-section-generation:${grantId}:${sectionKey}:${Date.now()}`
  try {
    const payload = generateSchema.parse(await request.json())
    if (!GRANT_SECTION_ROUTE_QUOTA_CHECKS_DISABLED) {
      await reserveServiceUsage({
        tenantId: actor.tenantId,
        userId: actor.id,
        serviceType: 'GRANT_DRAFTING',
        operationId,
        operationType: 'grant_section_generation',
        metadata: { grantSessionId: grantId, sectionKey, action: payload.action }
      })
    }

    const section = await generateGrantSectionDraft({
      projectId,
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      sectionKey,
      userId: actor.id,
      userInstructions: payload.userInstructions,
      allowInstructionAmounts: payload.allowInstructionAmounts,
      overwriteAmounts: payload.overwriteAmounts,
      useCurrentBudgetValues: payload.useCurrentBudgetValues,
      bibliographyStyle: payload.bibliographyStyle,
      bibliographySortOrder: payload.bibliographySortOrder,
    })

    if (!GRANT_SECTION_ROUTE_QUOTA_CHECKS_DISABLED) {
      await trackServiceUsage({
        tenantId: actor.tenantId,
        userId: actor.id,
        serviceType: 'GRANT_DRAFTING',
        operationId,
        operationType: 'grant_section_generation',
        isCompleted: true,
        metadata: { grantSessionId: grantId, sectionKey, action: payload.action }
      })
    }

    return NextResponse.json({ section })
  } catch (error) {
    if (!GRANT_SECTION_ROUTE_QUOTA_CHECKS_DISABLED) {
      await releaseReservedServiceUsage(actor.tenantId, 'GRANT_DRAFTING', operationId).catch(() => undefined)
    }
    console.error('[Grant Section] generate error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to generate the grant section',
      },
      {
        status: error instanceof ServiceQuotaExceededError
          ? 429
          : error instanceof Error && error.message.includes('Grant workspace not found')
          ? 404
          : error instanceof Error && error.message.includes('literature workspace')
          ? 409
          : error instanceof Error && error.message.includes('active citations')
            ? 409
          : error instanceof Error && error.message.includes('Only budget sections')
            ? 409
          : 500,
      }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; sectionKey: string }> }
) {
  const { projectId, grantId, sectionKey } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const payload = saveSchema.parse(await request.json())
    const section = await saveGrantSectionDraft({
      projectId,
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      sectionKey,
      userId: actor.id,
      content: payload.content,
      structuredData: payload.structuredData,
      markReviewed: payload.markReviewed,
    })

    return NextResponse.json({ section })
  } catch (error) {
    console.error('[Grant Section] save error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to save the grant section',
      },
      {
        status: error instanceof Error && error.message.includes('literature workspace')
          ? 409
          : error instanceof Error && error.message.includes('Grant workspace not found')
            ? 404
          : 500,
      }
    )
  }
}
