import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  embedQuery: vi.fn(),
  searchChunks: vi.fn(),
}));

vi.mock('@/lib/fundingDocuments/retrieval', () => ({
  fundingDocumentRetrievalService: {
    embedQuery: mocks.embedQuery,
    searchChunks: mocks.searchChunks,
  },
}));

import { enrichRecommendationResultsWithDocumentEvidence } from '@/lib/fundingDocuments/evidence';
import type { RecommendationRawResultItem } from '@/lib/recommendations/types';

function makeResult(id: string, score: number): RecommendationRawResultItem {
  return { id, score, matchReasons: [`Matched ${id}`] } as unknown as RecommendationRawResultItem;
}

function makeChunk(callId: string) {
  return {
    chunkId: `${callId}-chunk`,
    documentId: `${callId}-doc`,
    fundingCallId: callId,
    sectionId: null,
    sectionTitle: 'Eligibility',
    sectionType: 'eligibility',
    chunkText: 'Open to Indian institutions.',
    pageStart: 2,
    pageEnd: 2,
    documentVersion: 1,
    qualityFlags: null,
    similarity: 0.61,
  };
}

const OPTIONS = {
  semanticDocument: 'battery recycling',
  access: { tenantId: 'tenant-1', isSuperAdmin: false } as any,
  llmContext: { tenantId: 'tenant-1' } as any,
  limit: 5,
};

// Each result is a different call searched with the SAME question, so the query
// vector never changes. Embedding inside every lookup billed one identical
// embedding per top result on every single search.
describe('recommendation document evidence enrichment', () => {
  beforeEach(() => {
    mocks.embedQuery.mockReset();
    mocks.searchChunks.mockReset();
  });

  it('embeds the query once and reuses that vector for every result lookup', async () => {
    const vector = [0.1, 0.2, 0.3];
    mocks.embedQuery.mockResolvedValue(vector);
    mocks.searchChunks.mockImplementation(async ({ fundingCallId }: { fundingCallId: string }) => [
      makeChunk(fundingCallId),
    ]);

    const results = ['a', 'b', 'c', 'd', 'e'].map((id, index) => makeResult(id, 1 - index * 0.1));
    const enriched = await enrichRecommendationResultsWithDocumentEvidence(results, OPTIONS);

    expect(mocks.embedQuery).toHaveBeenCalledTimes(1);
    expect(mocks.searchChunks).toHaveBeenCalledTimes(5);
    for (const [request] of mocks.searchChunks.mock.calls) {
      expect(request.queryEmbedding).toBe(vector);
    }
    expect(enriched.every((result) => result.evidence?.availability === 'document_available')).toBe(true);
  });

  it('returns the results unenriched when the query cannot be embedded, instead of failing the search', async () => {
    mocks.embedQuery.mockRejectedValue(new Error('voyage down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = [makeResult('a', 0.9), makeResult('b', 0.8)];
    const enriched = await enrichRecommendationResultsWithDocumentEvidence(results, OPTIONS);

    expect(enriched).toBe(results);
    expect(mocks.searchChunks).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not embed at all when there is nothing to enrich', async () => {
    await enrichRecommendationResultsWithDocumentEvidence([], OPTIONS);
    await enrichRecommendationResultsWithDocumentEvidence([makeResult('a', 0.9)], { ...OPTIONS, semanticDocument: '  ' });
    await enrichRecommendationResultsWithDocumentEvidence([makeResult('a', 0.9)], { ...OPTIONS, access: undefined });

    expect(mocks.embedQuery).not.toHaveBeenCalled();
    expect(mocks.searchChunks).not.toHaveBeenCalled();
  });

  it('marks a call with no retrievable chunks as having no document', async () => {
    mocks.embedQuery.mockResolvedValue([0.1]);
    mocks.searchChunks.mockResolvedValue([]);

    const [enriched] = await enrichRecommendationResultsWithDocumentEvidence([makeResult('a', 0.9)], OPTIONS);

    expect(enriched.evidence).toMatchObject({ availability: 'no_document', chunks: [], docSemanticFit: null });
    expect(enriched.score).toBe(0.9);
  });
});
