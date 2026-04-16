import { NextResponse } from 'next/server';
import fs from 'fs/promises';

import { prisma } from '@/lib/prisma';
import {
  getImageContentType,
  getPaperFigureImageCandidates,
  verifyPaperFigureImageAccessToken
} from '@/lib/figure-generation/paper-figure-image';
import {
  asPaperFigureMeta,
  getPaperFigureImageVersion,
  getPaperFigureStoredImagePath
} from '@/lib/figure-generation/paper-figure-record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  const { paperId: sessionId, figureId } = await context.params;

  const figure = await prisma.figurePlan.findFirst({
    where: { id: figureId, sessionId },
    select: { nodes: true }
  });

  if (!figure) {
    return NextResponse.json({ error: 'Figure not found' }, { status: 404 });
  }

  const nodes = asPaperFigureMeta(figure.nodes);
  const rawImagePath = getPaperFigureStoredImagePath(nodes);

  if (!rawImagePath) {
    return NextResponse.json({ error: 'Figure image not found' }, { status: 404 });
  }

  const version = getPaperFigureImageVersion(nodes, rawImagePath);
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!verifyPaperFigureImageAccessToken({ token, sessionId, figureId, version })) {
    return NextResponse.json({ error: 'Unauthorized figure image access' }, { status: 401 });
  }

  const candidates = getPaperFigureImageCandidates(rawImagePath);

  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate);
      return new NextResponse(buffer as BodyInit, {
        headers: {
          'Content-Type': getImageContentType(candidate),
          'Cache-Control': 'private, max-age=3600, immutable',
          'Content-Disposition': 'inline'
        }
      });
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[PaperFigureImage] Failed to read ${candidate}:`, error?.message || error);
      }
    }
  }

  console.warn('[PaperFigureImage] No readable file found for image path:', rawImagePath);
  return NextResponse.json({ error: 'Figure image file not found' }, { status: 404 });
}
