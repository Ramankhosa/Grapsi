import { NextRequest, NextResponse } from 'next/server'

import { runGrantSectionAiReview } from '@/lib/grants/aiReview'
import { requireProjectGrantActor } from '@/lib/grants/access'

/**
 * POST — run the LLM agency-rule review for one drafted grant section and
 * persist the verdict. Agency rules are enforced here, in the review stage,
 * instead of blocking generation in the drafting stage.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; sectionKey: string }> }
) {
  const { projectId, grantId, sectionKey } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const report = await runGrantSectionAiReview({
      projectId,
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      userId: actor.id,
      sectionKey,
    })

    return NextResponse.json({ sectionKey, report })
  } catch (error) {
    console.error('[Grant Section] ai-review error:', error)
    const message = error instanceof Error ? error.message : 'Failed to run the AI review'
    return NextResponse.json(
      { message },
      {
        status: message.includes('not found')
          ? 404
          : message.includes('no draft content') || message.includes('Only AI-draftable')
            ? 409
            : 500,
      }
    )
  }
}
