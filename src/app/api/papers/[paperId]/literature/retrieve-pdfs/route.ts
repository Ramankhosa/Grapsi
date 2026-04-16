import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { featureFlags } from '@/lib/feature-flags';
import {
  paperAcquisitionService,
  type PaperAcquisitionItemInput,
} from '@/lib/services/paper-acquisition-service';
import { paperLibraryService } from '@/lib/services/paper-library-service';
import { proactiveParsingService } from '@/lib/services/proactive-parsing-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  mode: z.enum(['deep', 'relevant', 'manual']).default('deep'),
  searchRunIds: z.array(z.string().min(1)).min(1).max(20),
  paperIds: z.array(z.string().min(1)).optional(),
});

const DEEP_LABELS = new Set(['DEEP_ANCHOR', 'DEEP_SUPPORT', 'DEEP_STRESS_TEST']);

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ where: { id: sessionId } });
  }
  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
  });
}

function normalizeDoi(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim()
    .toLowerCase();
  return cleaned || null;
}

function dedupeKeyFromResult(result: any, fallback: string): string {
  const doiKey = normalizeDoi(result?.doi);
  if (doiKey) {
    return `doi:${doiKey}`;
  }
  const title = typeof result?.title === 'string' ? result.title.trim().toLowerCase() : '';
  if (title) {
    return `title:${title.slice(0, 180)}`;
  }
  return fallback;
}

function asJsonObject(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, any>;
}

function normalizePdfStatus(value: unknown): 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE' {
  if (value === 'UPLOADED' || value === 'PARSING' || value === 'READY' || value === 'FAILED') {
    return value;
  }
  return 'NONE';
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

    const body = await request.json();
    const { mode, searchRunIds, paperIds } = requestSchema.parse(body);

    if (mode === 'manual' && (!Array.isArray(paperIds) || paperIds.length === 0)) {
      return NextResponse.json({ error: 'paperIds is required for manual mode' }, { status: 400 });
    }

    const searchRuns = await prisma.literatureSearchRun.findMany({
      where: {
        id: { in: searchRunIds },
        sessionId,
      },
      select: {
        id: true,
        results: true,
        aiAnalysis: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (searchRuns.length === 0) {
      return NextResponse.json({ error: 'No matching search runs found for this paper session' }, { status: 404 });
    }

    const requestedIds = new Set((paperIds || []).map(id => id.trim()).filter(Boolean));
    const selectedByKey = new Map<string, PaperAcquisitionItemInput & { _meta?: any }>();

    for (const run of searchRuns) {
      const runResults = Array.isArray(run.results) ? run.results : [];
      const aiAnalysis = (run.aiAnalysis as any) || null;
      const suggestions = Array.isArray(aiAnalysis?.suggestions) ? aiAnalysis.suggestions : [];
      const suggestionByPaperId = new Map<string, any>();

      for (const suggestion of suggestions) {
        if (typeof suggestion?.paperId === 'string' && suggestion.paperId.trim()) {
          suggestionByPaperId.set(suggestion.paperId, suggestion);
        }
      }

      for (const rawResult of runResults) {
        const parsedResult = asJsonObject(rawResult);
        if (!parsedResult) continue;

        const paperId = typeof parsedResult.id === 'string' ? parsedResult.id : '';
        if (!paperId) continue;

        const suggestion = suggestionByPaperId.get(paperId);
        let include = false;

        if (mode === 'manual') {
          include = requestedIds.has(paperId);
        } else if (mode === 'relevant') {
          include = Boolean(suggestion?.isRelevant);
        } else {
          include = Boolean(suggestion?.isRelevant) && DEEP_LABELS.has(String(suggestion?.deepAnalysisRecommendation || ''));
        }

        if (!include) continue;

        const candidate: PaperAcquisitionItemInput & { _meta?: any } = {
          searchRunId: run.id,
          paperId,
          result: parsedResult as any,
          isRelevant: Boolean(suggestion?.isRelevant),
          deepAnalysisRecommendation: typeof suggestion?.deepAnalysisRecommendation === 'string'
            ? suggestion.deepAnalysisRecommendation
            : undefined,
          _meta: {
            deepAnalysisRecommendation: suggestion?.deepAnalysisRecommendation,
            isRelevant: suggestion?.isRelevant,
          },
        };

        const dedupeKey = dedupeKeyFromResult(parsedResult, `run:${run.id}:paper:${paperId}`);
        const existing = selectedByKey.get(dedupeKey);
        if (!existing) {
          selectedByKey.set(dedupeKey, candidate);
          continue;
        }

        const existingHasPdfUrl = typeof existing.result?.pdfUrl === 'string' && existing.result.pdfUrl.trim().length > 0;
        const incomingHasPdfUrl = typeof candidate.result?.pdfUrl === 'string' && candidate.result.pdfUrl.trim().length > 0;
        if (!existingHasPdfUrl && incomingHasPdfUrl) {
          selectedByKey.set(dedupeKey, candidate);
        }
      }
    }

    const candidates = Array.from(selectedByKey.values());
    if (candidates.length === 0) {
      return NextResponse.json({
        mode,
        totalCandidates: 0,
        attempted: 0,
        succeeded: 0,
        reused: 0,
        downloaded: 0,
        alreadyAttached: 0,
        failed: 0,
        results: [],
      });
    }

    const batch = await paperAcquisitionService.acquireBatch(
      user.id,
      candidates.map(candidate => ({
        searchRunId: candidate.searchRunId,
        paperId: candidate.paperId,
        result: candidate.result,
        isRelevant: candidate.isRelevant,
        deepAnalysisRecommendation: candidate.deepAnalysisRecommendation,
      }))
    );

    const referenceIdsForCollection = batch.results
      .map(item => (typeof item.referenceId === 'string' ? item.referenceId.trim() : ''))
      .filter(Boolean);
    if (referenceIdsForCollection.length > 0) {
      try {
        await paperLibraryService.addReferencesToPaperCollection(
          user.id,
          sessionId,
          referenceIdsForCollection
        );
      } catch (collectionError) {
        console.warn('[LiteraturePDFRetrieval] Failed to add references to paper library collection:', collectionError);
      }
    }

    const metaByRunPaper = new Map<string, any>();
    for (const candidate of candidates) {
      metaByRunPaper.set(`${candidate.searchRunId}:${candidate.paperId}`, candidate._meta || {});
    }

    const enrichedResults = batch.results.map(item => {
      const meta = metaByRunPaper.get(`${item.searchRunId}:${item.paperId}`) || {};
      return {
        ...item,
        isRelevant: meta.isRelevant,
        deepAnalysisRecommendation: meta.deepAnalysisRecommendation,
      };
    });

    // Persist latest PDF attachment state back into search-run result snapshots
    // so refreshed UIs keep "PDF available / view" actions.
    const updatesByRun = new Map<string, Map<string, any>>();
    for (const item of batch.results) {
      const runId = typeof item.searchRunId === 'string' ? item.searchRunId : '';
      const paperId = typeof item.paperId === 'string' ? item.paperId : '';
      if (!runId || !paperId) continue;
      if (!updatesByRun.has(runId)) {
        updatesByRun.set(runId, new Map());
      }
      updatesByRun.get(runId)!.set(paperId, item);
    }

    if (updatesByRun.size > 0) {
      await Promise.all(
        searchRuns.map(async run => {
          const updatesForRun = updatesByRun.get(run.id);
          if (!updatesForRun || updatesForRun.size === 0) return;

          const runResults = Array.isArray(run.results) ? run.results : [];
          let changed = false;
          const patchedResults = runResults.map(rawResult => {
            const parsedResult = asJsonObject(rawResult);
            if (!parsedResult) {
              return rawResult;
            }

            const paperId = typeof parsedResult.id === 'string' ? parsedResult.id : '';
            if (!paperId) {
              return rawResult;
            }

            const update = updatesForRun.get(paperId);
            if (!update) {
              return rawResult;
            }

            const currentStatus = normalizePdfStatus(parsedResult.pdfStatus);
            const incomingStatus = normalizePdfStatus(update.pdfStatus);
            const nextStatus = update.success
              ? (incomingStatus === 'NONE'
                ? (update.documentId ? 'UPLOADED' : currentStatus)
                : incomingStatus)
              : 'FAILED';

            changed = true;
            return {
              ...parsedResult,
              pdfStatus: nextStatus,
              libraryReferenceId: update.referenceId || parsedResult.libraryReferenceId || null,
              libraryDocumentId: update.documentId || parsedResult.libraryDocumentId || null,
              documentSourceType: update.documentSourceType || parsedResult.documentSourceType,
            };
          });

          if (!changed) return;

          await prisma.literatureSearchRun.update({
            where: { id: run.id },
            data: { results: patchedResults as any },
          });
        })
      );
    }

    if (batch.succeeded > 0) {
      proactiveParsingService.triggerForSessionCitations(sessionId);
    }

    return NextResponse.json({
      mode,
      totalCandidates: candidates.length,
      attempted: batch.attempted,
      succeeded: batch.succeeded,
      reused: batch.reused,
      downloaded: batch.downloaded,
      alreadyAttached: batch.alreadyAttached,
      failed: batch.failed,
      results: enrichedResults,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }
    console.error('[LiteraturePDFRetrieval] POST error:', error);
    return NextResponse.json({ error: 'Failed to retrieve PDFs' }, { status: 500 });
  }
}
