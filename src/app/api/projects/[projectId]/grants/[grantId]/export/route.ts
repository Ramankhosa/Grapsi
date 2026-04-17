import { NextRequest, NextResponse } from 'next/server'

import { requireProjectGrantActor } from '@/lib/grants/access'
import { renderGrantSectionForExport } from '@/lib/grants/drafting'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import { buildPaperDocxBuffer } from '@/lib/export/paper-docx-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const workspace = await getGrantWorkspace({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
    })
    if (!workspace || workspace.grantSession.projectId !== projectId || !workspace.blueprint) {
      return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
    }

    const sections = workspace.blueprint.sectionDrafts.map((section) => ({
      key: section.sectionKey,
      title: section.label,
      content: renderGrantSectionForExport(section),
    }))

    const buffer = await buildPaperDocxBuffer({
      title: workspace.grantSession.project.name,
      sections,
      formatting: {
        fontFamily: 'Times New Roman',
        fontSizePt: 11,
        lineSpacing: 1.15,
        marginsCm: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 },
        pageSize: 'A4',
        columnLayout: 1,
        includePageNumbers: true,
        pageNumberPosition: 'bottom-center',
        sectionNumbering: true,
      },
    })

    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="grant_${grantId}.docx"`,
      },
    })
  } catch (error) {
    console.error('[Grant Export] error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to export the grant document',
      },
      { status: 500 }
    )
  }
}
