import type { FundingLlmRoutingContext } from '@/lib/funding/llmRouting';
import type { RecommendationAccessScope, RecommendationRawResultItem } from '@/lib/recommendations/types';
import { fundingDocumentRetrievalService } from './retrieval';
import type { FundingDocumentSearchResult } from './types';

const EVIDENCE_SECTION_TYPES = ['thematic_areas', 'objectives', 'evaluation_criteria', 'eligibility'] as const;

function normalizeFit(similarity: number) {
  if (!Number.isFinite(similarity)) {
    return 0;
  }
  return Math.max(0, Math.min(1, similarity));
}

function extractQualityWarnings(chunks: FundingDocumentSearchResult[]) {
  const warnings = new Set<string>();
  for (const chunk of chunks) {
    const flags = chunk.qualityFlags;
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
      continue;
    }
    const rawFlags = Array.isArray((flags as any).flags) ? (flags as any).flags : [];
    for (const flag of rawFlags) {
      if (flag?.severity === 'conflict' || flag?.severity === 'warning') {
        warnings.add(String(flag.message || flag.code || 'Document quality warning'));
      }
    }
  }
  return Array.from(warnings).slice(0, 5);
}

function mapEvidenceChunk(chunk: FundingDocumentSearchResult) {
  return {
    chunkId: chunk.chunkId,
    sectionTitle: chunk.sectionTitle,
    sectionType: chunk.sectionType,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    similarity: chunk.similarity,
    documentVersion: chunk.documentVersion,
    text: chunk.chunkText,
  };
}

export async function enrichRecommendationResultsWithDocumentEvidence(
  results: RecommendationRawResultItem[],
  options: {
    semanticDocument: string;
    access?: RecommendationAccessScope;
    llmContext?: FundingLlmRoutingContext | null;
    limit?: number;
  }
): Promise<RecommendationRawResultItem[]> {
  const query = String(options.semanticDocument || '').trim();
  if (!query || !options.access || results.length === 0) {
    return results;
  }

  const topLimit = Math.max(1, Math.min(options.limit || 5, 5));
  const topResults = results.slice(0, topLimit);
  const enrichedTop = await Promise.all(
    topResults.map(async (result) => {
      const chunks = await fundingDocumentRetrievalService.searchChunks({
        query,
        fundingCallId: result.id,
        sectionTypes: [...EVIDENCE_SECTION_TYPES],
        callStatus: 'any',
        topK: 4,
        minSimilarity: 0.22,
        access: options.access!,
        llmContext: options.llmContext,
      });

      if (chunks.length === 0) {
        return {
          ...result,
          evidence: {
            availability: 'no_document' as const,
            chunks: [],
            qualityWarnings: [],
            docSemanticFit: null,
          },
        };
      }

      const docSemanticFit = normalizeFit(chunks[0]?.similarity || 0);
      const blendedScore = Number((result.score * 0.92 + docSemanticFit * 0.08).toFixed(4));
      return {
        ...result,
        score: blendedScore,
        matchReasons: [
          ...result.matchReasons,
          chunks[0]?.sectionTitle
            ? `Document evidence: ${chunks[0].sectionTitle}`
            : `Document evidence: ${chunks[0]?.sectionType}`,
        ].slice(0, 5),
        evidence: {
          availability: 'document_available' as const,
          chunks: chunks.map(mapEvidenceChunk),
          qualityWarnings: extractQualityWarnings(chunks),
          docSemanticFit,
        },
      };
    })
  );

  const untouched = results.slice(topLimit);
  return [...enrichedTop.sort((left, right) => right.score - left.score), ...untouched];
}
