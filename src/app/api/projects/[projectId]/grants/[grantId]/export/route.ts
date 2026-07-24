import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

import { requireProjectGrantActor } from '@/lib/grants/access'
import { buildGrantProposalDocxSections } from '@/lib/grants/export'
import { formatGrantProposalDocxCitations } from '@/lib/grants/exportCitationFormatting'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import { validateGrantFinalExportReadiness } from '@/lib/grants/draftContextContract'
import { getGrantIdeaAnchorFromFreezePayload } from '@/lib/grants/promptOverlay'
import { buildPaperDocxBuffer, type PaperDocxFigure } from '@/lib/export/paper-docx-export'
import { getPaperFigureImageCandidates } from '@/lib/figure-generation/paper-figure-image'
import {
  asPaperFigureMeta,
  getPaperFigureCaption,
  getPaperFigureStoredImagePath,
  isPaperFigureUsable,
} from '@/lib/figure-generation/paper-figure-record'
import { prisma } from '@/lib/prisma'
import { citationService } from '@/lib/services/citation-service'

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

async function readGrantFigureAsset(rawImagePath: string, figureNo: number): Promise<{
  fileName: string
  buffer: Buffer
} | null> {
  for (const candidate of getPaperFigureImageCandidates(rawImagePath)) {
    try {
      const buffer = await fs.readFile(candidate)
      const ext = (path.extname(candidate) || '.png').toLowerCase()
      return { fileName: `figure-${String(figureNo).padStart(2, '0')}${ext}`, buffer }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[Grant Export] Failed to read figure asset ${candidate}:`, error?.message || error)
      }
    }
  }
  return null
}

/**
 * Collects exportable figures: Diagram Studio diagrams plus legacy
 * figure-planner figures from the shadow drafting session. The two share the
 * [Figure N] numbering space; on a collision the studio figure wins.
 */
async function loadGrantExportFigures(input: {
  grantSessionId: string
  draftingSessionId?: string | null
}): Promise<PaperDocxFigure[]> {
  const byNo = new Map<number, PaperDocxFigure>()

  if (input.draftingSessionId) {
    const figurePlans = await prisma.figurePlan.findMany({
      where: { sessionId: input.draftingSessionId },
      orderBy: { figureNo: 'asc' },
    })
    for (const figure of figurePlans) {
      const nodes = asPaperFigureMeta(figure.nodes)
      const rawImagePath = getPaperFigureStoredImagePath(nodes)
      if (!isPaperFigureUsable(nodes, rawImagePath)) continue
      const asset = rawImagePath ? await readGrantFigureAsset(rawImagePath, figure.figureNo) : null
      if (!asset) continue
      byNo.set(figure.figureNo, {
        figureNo: figure.figureNo,
        title: figure.title,
        caption: getPaperFigureCaption(nodes, figure.description || ''),
        asset,
      })
    }
  }

  const diagrams = await prisma.grantDiagram.findMany({
    where: { grantSessionId: input.grantSessionId, status: 'READY', imagePath: { not: null } },
    orderBy: { figureNo: 'asc' },
  })
  for (const diagram of diagrams) {
    if (!diagram.imagePath) continue
    const asset = await readGrantFigureAsset(diagram.imagePath, diagram.figureNo)
    if (!asset) continue
    byNo.set(diagram.figureNo, {
      figureNo: diagram.figureNo,
      title: diagram.title,
      caption: diagram.caption,
      asset,
    })
  }

  return Array.from(byNo.values()).sort((a, b) => a.figureNo - b.figureNo)
}

async function formatSectionsWithGrantCitations(input: {
  grantId: string
  tenantId: string
  draftingSessionId?: string | null
  sections: ReturnType<typeof buildGrantProposalDocxSections>['sections']
}) {
  const draftingSessionId = String(input.draftingSessionId || '').trim()
  if (!draftingSessionId) {
    return input.sections
  }

  const draftingSession = await prisma.draftingSession.findUnique({
    where: { id: draftingSessionId },
    include: {
      citationStyle: true,
      grantSession: {
        select: {
          id: true,
          tenantId: true,
        },
      },
    },
  })

  if (
    !draftingSession
    || draftingSession.grantSession?.id !== input.grantId
    || draftingSession.grantSession?.tenantId !== input.tenantId
  ) {
    return input.sections
  }

  const citations = await citationService.getCitationsForSession(draftingSessionId)
  if (citations.length === 0) {
    return input.sections
  }

  try {
    return await formatGrantProposalDocxCitations({
      sections: input.sections,
      citations,
      styleCode: draftingSession.citationStyle?.code,
    })
  } catch (error) {
    console.warn('[Grant Export] skipped citation formatting:', error)
    return input.sections
  }
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
      const { ideaAnchorHash } = getGrantIdeaAnchorFromFreezePayload(workspace.blueprint.freezePayloadJson)
      const readiness = validateGrantFinalExportReadiness({
        currentIdeaAnchorHash: ideaAnchorHash,
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
          sourceIdeaAnchorHash: (section as { sourceIdeaAnchorHash?: string | null }).sourceIdeaAnchorHash || null,
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

    const { sections: rawSections } = buildGrantProposalDocxSections(workspace.blueprint.sectionDrafts)
    const sections = await formatSectionsWithGrantCitations({
      grantId,
      tenantId: actor.tenantId,
      draftingSessionId: workspace.grantSession.draftingSessionId,
      sections: rawSections,
    })

    const figures = await loadGrantExportFigures({
      grantSessionId: grantId,
      draftingSessionId: workspace.grantSession.draftingSessionId,
    }).catch(error => {
      console.warn('[Grant Export] skipped figures:', error)
      return [] as PaperDocxFigure[]
    })

    const buffer = await buildPaperDocxBuffer({
      title: workspace.grantSession.project.name,
      sections,
      figures,
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
