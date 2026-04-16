import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { featureFlags } from '@/lib/feature-flags';
import { proactiveParsingService } from '@/lib/services/proactive-parsing-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEEP_LABELS = ['DEEP_ANCHOR', 'DEEP_SUPPORT', 'DEEP_STRESS_TEST'];

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ where: { id: sessionId }, select: { id: true } });
  }
  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true },
  });
}

/**
 * GET — returns text extraction status for all DEEP_* citations in the session.
 * POST — triggers PDF.js text extraction for all pending documents.
 */

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const result = await getTextExtractionStatus(sessionId);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[ExtractText] GET error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to get extraction status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const diagBefore = proactiveParsingService.getDiagnostics();
    console.log('[ExtractText] POST — pre-enqueue diagnostics:', JSON.stringify(diagBefore));

    proactiveParsingService.resetIfStuck();

    const enqueued = await proactiveParsingService.enqueueSessionDocuments(sessionId, DEEP_LABELS, 'manual-extract');
    console.log(`[ExtractText] POST — enqueued ${enqueued} document(s) for session ${sessionId}`);

    const status = await getTextExtractionStatus(sessionId);
    return NextResponse.json({
      triggered: true,
      enqueued,
      queueDepth: proactiveParsingService.getQueueDepth(),
      inFlight: proactiveParsingService.getInFlight(),
      ...status,
    });
  } catch (err: any) {
    console.error('[ExtractText] POST error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to trigger text extraction' }, { status: 500 });
  }
}

async function getTextExtractionStatus(sessionId: string) {
  const citations = await prisma.citation.findMany({
    where: {
      sessionId,
      isActive: true,
      libraryReferenceId: { not: null },
    },
    select: {
      id: true,
      citationKey: true,
      deepAnalysisLabel: true,
      aiMeta: true,
      libraryReferenceId: true,
    },
  });

  const deepLabelsSet = new Set(DEEP_LABELS);
  const deepCitations = citations.filter(c => {
    if (c.deepAnalysisLabel && deepLabelsSet.has(c.deepAnalysisLabel)) return true;
    const rec = (c.aiMeta as any)?.deepAnalysisRecommendation;
    return typeof rec === 'string' && deepLabelsSet.has(rec);
  });

  const referenceIds = Array.from(
    new Set(deepCitations.map(c => c.libraryReferenceId).filter((id): id is string => Boolean(id)))
  );

  if (referenceIds.length === 0) {
    return {
      total: 0,
      structuredReady: 0,
      grobidReady: 0,
      basicTextOnly: 0,
      noPdf: 0,
      pending: 0,
      papers: [],
    };
  }

  const links = await prisma.referenceDocumentLink.findMany({
    where: { referenceId: { in: referenceIds }, isPrimary: true },
    select: { documentId: true, referenceId: true },
  });
  const refToDoc = new Map(links.map(l => [l.referenceId, l.documentId]));
  const documentIds = Array.from(new Set(links.map(l => l.documentId)));

  const docs = documentIds.length > 0
    ? await prisma.referenceDocument.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, status: true, parserUsed: true, sectionsJson: true, parsedText: true, mimeType: true },
      })
    : [];
  const docMap = new Map(docs.map(d => [d.id, d]));

  type PaperStatus = {
    citationId: string;
    citationKey: string;
    depthLabel: string;
    textStatus: 'structured_ready' | 'basic_text' | 'no_pdf' | 'parsing' | 'pending';
  };

  const papers: PaperStatus[] = [];
  let structuredReady = 0;
  let basicTextOnly = 0;
  let noPdf = 0;
  let pending = 0;

  for (const c of deepCitations) {
    const docId = c.libraryReferenceId ? refToDoc.get(c.libraryReferenceId) : undefined;
    const doc = docId ? docMap.get(docId) : undefined;
    const label = c.deepAnalysisLabel || (c.aiMeta as any)?.deepAnalysisRecommendation || 'DEEP_SUPPORT';

    if (!doc) {
      papers.push({ citationId: c.id, citationKey: c.citationKey, depthLabel: label, textStatus: 'no_pdf' });
      noPdf++;
      continue;
    }

    const hasStructured = (doc.parserUsed === 'PDFJS' || doc.parserUsed === 'GROBID')
      && Array.isArray(doc.sectionsJson) && (doc.sectionsJson as unknown[]).length > 0;
    if (hasStructured) {
      papers.push({ citationId: c.id, citationKey: c.citationKey, depthLabel: label, textStatus: 'structured_ready' });
      structuredReady++;
    } else if (doc.status === 'PARSING') {
      papers.push({ citationId: c.id, citationKey: c.citationKey, depthLabel: label, textStatus: 'parsing' });
      pending++;
    } else if (typeof doc.parsedText === 'string' && doc.parsedText.trim().length > 0) {
      papers.push({ citationId: c.id, citationKey: c.citationKey, depthLabel: label, textStatus: 'basic_text' });
      basicTextOnly++;
    } else {
      papers.push({ citationId: c.id, citationKey: c.citationKey, depthLabel: label, textStatus: 'pending' });
      pending++;
    }
  }

  return {
    total: deepCitations.length,
    structuredReady,
    grobidReady: structuredReady,
    basicTextOnly,
    noPdf,
    pending,
    queueDepth: proactiveParsingService.getQueueDepth(),
    inFlight: proactiveParsingService.getInFlight(),
    papers,
  };
}
