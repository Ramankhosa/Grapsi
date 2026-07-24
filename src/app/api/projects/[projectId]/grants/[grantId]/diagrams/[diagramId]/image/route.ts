import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'

import { prisma } from '@/lib/prisma'
import {
  verifyPaperFigureImageAccessToken,
  getPaperFigureImageCandidates,
  getImageContentType,
} from '@/lib/figure-generation/paper-figure-image'

export const dynamic = 'force-dynamic'

/**
 * Streams a grant diagram image. Auth is the signed HMAC token (same scheme
 * as paper figures) because <img> requests cannot carry API auth headers.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; diagramId: string }> }
) {
  const { projectId, grantId, diagramId } = await params
  const token = request.nextUrl.searchParams.get('token')
  const version = request.nextUrl.searchParams.get('v')

  const valid = verifyPaperFigureImageAccessToken({
    token,
    sessionId: grantId,
    figureId: diagramId,
    version,
  })
  if (!valid) {
    return NextResponse.json({ message: 'Invalid or expired image token' }, { status: 403 })
  }

  const diagram = await prisma.grantDiagram.findFirst({
    where: { id: diagramId, grantSessionId: grantId, projectId },
    select: { imagePath: true },
  })
  if (!diagram?.imagePath) {
    return NextResponse.json({ message: 'Diagram image not found' }, { status: 404 })
  }

  for (const candidate of getPaperFigureImageCandidates(diagram.imagePath)) {
    try {
      const buffer = await fs.readFile(candidate)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': getImageContentType(diagram.imagePath),
          'Cache-Control': 'private, max-age=3600',
        },
      })
    } catch {
      // Try the next candidate path.
    }
  }

  return NextResponse.json({ message: 'Diagram image not found' }, { status: 404 })
}
