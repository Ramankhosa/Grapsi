import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';
import { citationMappingService, type CitationMetaSnapshot, type PaperBlueprintMapping } from '@/lib/services/citation-mapping-service';
import { paperLibraryService } from '@/lib/services/paper-library-service';

export const runtime = 'nodejs';

const citationMetaSchema = z.object({
  keyContribution: z.string().optional(),
  keyFindings: z.string().optional(),
  methodologicalApproach: z.string().nullable().optional(),
  relevanceToResearch: z.string().optional(),
  limitationsOrGaps: z.string().nullable().optional(),
  usage: z.object({
    introduction: z.boolean().optional(),
    literatureReview: z.boolean().optional(),
    methodology: z.boolean().optional(),
    comparison: z.boolean().optional()
  }).optional(),
  relevanceScore: z.number().optional()
}).optional().nullable();

const dimensionMappingSchema = z.object({
  sectionKey: z.string().min(1),
  dimension: z.string().min(1),
  remark: z.string().optional(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional()
});

const bulkImportSchema = z.object({
  citations: z.array(z.object({
    searchResult: z.any(),
    citationMeta: citationMetaSchema,
    relevanceScore: z.number().optional(),
    recommendation: z.enum(['IMPORT', 'MAYBE', 'SKIP']).optional(),
    dimensionMappings: z.array(dimensionMappingSchema).optional()
  })).min(1).max(250)
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      citationStyle: true
    }
  });
}

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: citation.authors,
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey
  };
}

function getDefaultStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

function toCitationMetaSnapshot(raw: any, fallbackRelevanceScore?: number): CitationMetaSnapshot | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const result: CitationMetaSnapshot = {};
  if (typeof raw.keyContribution === 'string' && raw.keyContribution.trim()) {
    result.keyContribution = raw.keyContribution.trim().slice(0, 400);
  }
  if (typeof raw.keyFindings === 'string' && raw.keyFindings.trim()) {
    result.keyFindings = raw.keyFindings.trim().slice(0, 400);
  }
  if (typeof raw.methodologicalApproach === 'string') {
    const value = raw.methodologicalApproach.trim();
    result.methodologicalApproach = value ? value.slice(0, 400) : null;
  } else if (raw.methodologicalApproach === null) {
    result.methodologicalApproach = null;
  }
  if (typeof raw.relevanceToResearch === 'string' && raw.relevanceToResearch.trim()) {
    result.relevanceToResearch = raw.relevanceToResearch.trim().slice(0, 500);
  }
  if (typeof raw.limitationsOrGaps === 'string') {
    const value = raw.limitationsOrGaps.trim();
    result.limitationsOrGaps = value ? value.slice(0, 500) : null;
  } else if (raw.limitationsOrGaps === null) {
    result.limitationsOrGaps = null;
  }
  if (raw.usage && typeof raw.usage === 'object') {
    result.usage = {
      introduction: Boolean(raw.usage.introduction),
      literatureReview: Boolean(raw.usage.literatureReview),
      methodology: Boolean(raw.usage.methodology),
      comparison: Boolean(raw.usage.comparison)
    };
  }

  const relevanceScore = Number(raw.relevanceScore ?? fallbackRelevanceScore);
  if (Number.isFinite(relevanceScore)) {
    result.relevanceScore = Math.max(0, Math.min(100, relevanceScore));
  }
  result.analyzedAt = new Date().toISOString();

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildMappingsForCitation(
  citation: { id: string; citationKey: string },
  suggestion: {
    citationMeta?: any;
    dimensionMappings?: Array<{
      sectionKey?: string;
      dimension?: string;
      remark?: string;
      confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
    }>;
    relevanceScore?: number;
  }
): PaperBlueprintMapping[] {
  const citationMeta = toCitationMetaSnapshot(suggestion.citationMeta, Number(suggestion.relevanceScore));
  const rawMappings = Array.isArray(suggestion.dimensionMappings) ? suggestion.dimensionMappings : [];
  if (rawMappings.length === 0) {
    return [{
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey: null,
      dimensionMappings: [],
      mappingStatus: 'UNMAPPED',
      citationMeta
    }];
  }

  const bySection = new Map<string, Array<{
    dimension: string;
    remark: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }>>();

  for (const raw of rawMappings) {
    const sectionKey = typeof raw?.sectionKey === 'string' ? raw.sectionKey.trim() : '';
    const dimension = typeof raw?.dimension === 'string' ? raw.dimension.trim() : '';
    if (!sectionKey || !dimension) {
      continue;
    }
    const remark = typeof raw?.remark === 'string' && raw.remark.trim()
      ? raw.remark.trim().slice(0, 500)
      : 'No remark provided';
    const confidence = raw?.confidence === 'HIGH' || raw?.confidence === 'MEDIUM' || raw?.confidence === 'LOW'
      ? raw.confidence
      : 'MEDIUM';

    if (!bySection.has(sectionKey)) {
      bySection.set(sectionKey, []);
    }
    bySection.get(sectionKey)!.push({ dimension, remark, confidence });
  }

  if (bySection.size === 0) {
    return [{
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey: null,
      dimensionMappings: [],
      mappingStatus: 'UNMAPPED',
      citationMeta
    }];
  }

  const mappings: PaperBlueprintMapping[] = [];
  for (const [sectionKey, dims] of Array.from(bySection.entries())) {
    const highMedium = dims.filter((d: { confidence: 'HIGH' | 'MEDIUM' | 'LOW' }) => d.confidence === 'HIGH' || d.confidence === 'MEDIUM').length;
    const mappingStatus: PaperBlueprintMapping['mappingStatus'] = highMedium >= 2
      ? 'MAPPED'
      : highMedium >= 1
        ? 'WEAK'
        : dims.length > 0
          ? 'WEAK'
          : 'UNMAPPED';

    mappings.push({
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey,
      dimensionMappings: dims,
      mappingStatus,
      citationMeta
    });
  }

  return mappings;
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
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
    const data = bulkImportSchema.parse(body);

    const indexedCitations = data.citations.map((item, index) => ({
      item,
      clientRef: String(index)
    }));

    const recommendationSkipped = indexedCitations
      .filter(({ item }) => item.recommendation === 'MAYBE' || item.recommendation === 'SKIP')
      .map(({ item, clientRef }) => ({
        clientRef,
        reason: `AI recommendation is ${item.recommendation}; manual add required`,
        paperId: item.searchResult?.id,
        title: item.searchResult?.title
      }));

    const citationsToImport = indexedCitations.filter(
      ({ item }) => item.recommendation !== 'MAYBE' && item.recommendation !== 'SKIP'
    );

    const importResult = citationsToImport.length > 0
      ? await citationService.importFromSearchResultsBulk(
        sessionId,
        citationsToImport.map(({ item, clientRef }) => ({
          searchResult: item.searchResult,
          citationMeta: item.citationMeta || undefined,
          clientRef
        }))
      )
      : { imported: [], skipped: [] };

    if (importResult.imported.length > 0) {
      const citationInputByRef = new Map<string, (typeof data.citations)[number]>(
        citationsToImport.map(({ item, clientRef }) => [clientRef, item])
      );

      const mappingsToPersist: PaperBlueprintMapping[] = [];
      const importedCitationIds: string[] = [];

      for (const imported of importResult.imported) {
        if (!imported.clientRef) {
          continue;
        }
        const sourceItem = citationInputByRef.get(imported.clientRef);
        if (!sourceItem) {
          continue;
        }

        const hasMappingData = Boolean(sourceItem.citationMeta)
          || (Array.isArray(sourceItem.dimensionMappings) && sourceItem.dimensionMappings.length > 0)
          || Number.isFinite(sourceItem.relevanceScore);
        if (!hasMappingData) {
          continue;
        }

        const mappings = buildMappingsForCitation(
          {
            id: imported.citation.id,
            citationKey: imported.citation.citationKey
          },
          {
            citationMeta: sourceItem.citationMeta,
            dimensionMappings: sourceItem.dimensionMappings,
            relevanceScore: sourceItem.relevanceScore
          }
        );

        mappingsToPersist.push(...mappings);
        importedCitationIds.push(imported.citation.id);
      }

      if (importedCitationIds.length > 0 && mappingsToPersist.length > 0) {
        await citationMappingService.clearMappingsForCitations(sessionId, importedCitationIds);
        await citationMappingService.storeMappings(sessionId, mappingsToPersist);
      }

      try {
        await paperLibraryService.syncCitationsToLibraryAndCollection(
          user.id,
          sessionId,
          importResult.imported.map(item => item.citation)
        );
      } catch (syncError) {
        console.warn('[Citations][Bulk Import] Failed to sync imported citations to paper library collection:', syncError);
      }
    }

    const styleCode = getDefaultStyleCode(session);
    const importedCitations = await Promise.all(importResult.imported.map(async item => {
      const citation = item.citation;
      const citationData = toCitationData(citation);
      let inText = '';
      let bibliography = '';

      try {
        inText = await citationStyleService.formatInTextCitation(citationData, styleCode);
        bibliography = await citationStyleService.formatBibliographyEntry(citationData, styleCode);
      } catch (formatError) {
        console.warn('[Citations][Bulk Import] Format preview failed:', formatError);
      }

      return {
        ...citation,
        preview: {
          inText,
          bibliography
        }
      };
    }));

    const serviceSkipped = importResult.skipped.map(item => ({
      clientRef: item.clientRef,
      reason: item.reason,
      paperId: item.searchResult?.id,
      title: item.searchResult?.title
    }));

    const skipped = [...serviceSkipped, ...recommendationSkipped];

    return NextResponse.json({
      success: true,
      importedCount: importedCitations.length,
      skippedCount: skipped.length,
      citations: importedCitations,
      skipped
    }, { status: importedCitations.length > 0 ? 201 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[Citations][Bulk Import] POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to bulk import citations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
