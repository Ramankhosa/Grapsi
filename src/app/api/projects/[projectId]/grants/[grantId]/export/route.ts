import { NextRequest, NextResponse } from 'next/server'

import { requireProjectGrantActor } from '@/lib/grants/access'
import { buildGrantProposalDocxSections } from '@/lib/grants/export'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import { validateGrantFinalExportReadiness } from '@/lib/grants/draftContextContract'
import { buildPaperDocxBuffer } from '@/lib/export/paper-docx-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sanitizeFilenamePart(value: string) {
  return String(value || 'grant-proposal')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'grant-proposal'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const exportMode = request.nextUrl.searchParams.get('mode')?.toLowerCase() === 'draft'
    ? 'draft'
    : 'final'
  const actor = await requireProjectGrantActor(request, projectId, 'read', 'GRANT_DRAFTING')
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

    if (exportMode === 'final') {
      const readiness = validateGrantFinalExportReadiness({
        sections: workspace.blueprint.sectionDrafts.map((section) => ({
          sectionKey: section.sectionKey,
          label: section.label,
          sectionType: section.sectionType,
          workflowMode: (section as { workflowMode?: string | null }).workflowMode || null,
          required: section.required,
          content: section.content,
          structuredResponses: section.structuredResponses,
          status: section.status,
          isStale: (section as { isStale?: boolean | null }).isStale || false,
          validationReport: (section as { validationReport?: unknown }).validationReport,
          grantComplianceReport: (section as { grantComplianceReport?: any }).grantComplianceReport || null,
        })),
      })
      if (!readiness.ok) {
        return NextResponse.json(
          {
            message: 'Grant draft is not ready for export',
            issues: readiness.issues,
          },
          { status: 409 }
        )
      }
    }

    const { sections } = buildGrantProposalDocxSections(workspace.blueprint.sectionDrafts)

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
        'Content-Disposition': `attachment; filename="grant-proposal_${sanitizeFilenamePart(workspace.grantSession.project.name)}_${sanitizeFilenamePart(grantId)}.docx"`,
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
