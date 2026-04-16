/**
 * Citation Management Service
 * Handles CRUD operations and management of citations for research papers
 */

import { prisma } from '../prisma';
import { literatureSearchService, SearchResult } from './literature-search-service';
import { citationStyleService, CitationData } from './citation-style-service';
import type {
  Prisma,
  Citation,
  CitationUsage,
  CitationImportSource,
  CitationSourceType,
  CitationUsageKind,
  DimensionMappingConfidence
} from '@prisma/client';

// AI-generated citation metadata for section generation
export interface CitationAIMeta {
  keyContribution?: string;
  keyFindings?: string;
  methodologicalApproach?: string | null;
  relevanceToResearch?: string;
  limitationsOrGaps?: string | null;
  claimTypesSupported?: string[];
  evidenceBoundary?: string | null;
  positionalRelation?: {
    relation?: string;
    rationale?: string;
  };
  referenceArchetype?: string | null;
  archetypeSignal?: string | null;
  usage?: {
    introduction?: boolean;
    literatureReview?: boolean;
    methodology?: boolean;
    comparison?: boolean;
  };
  relevanceScore?: number;
  analyzedAt?: string;
}

export interface CreateCitationInput {
  sessionId: string;
  sourceType: CitationSourceType;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  isbn?: string;
  publisher?: string;
  edition?: string;
  editors?: string[];
  publicationPlace?: string;
  publicationDate?: string;
  accessedDate?: string;
  articleNumber?: string;
  issn?: string;
  journalAbbreviation?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  abstract?: string;
  importSource: CitationImportSource;
  importProvider?: string;
  importProviderPaperId?: string;
  doiNormalized?: string;
  titleFingerprint?: string;
  firstAuthorNormalized?: string;
  paperIdentityKey?: string;
  libraryReferenceId?: string;
  notes?: string;
  tags?: string[];
  aiMeta?: CitationAIMeta; // AI-generated metadata for section generation
}

export interface UpdateCitationInput {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  isbn?: string;
  publisher?: string;
  edition?: string;
  editors?: string[];
  publicationPlace?: string;
  publicationDate?: string;
  accessedDate?: string;
  articleNumber?: string;
  issn?: string;
  journalAbbreviation?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  abstract?: string;
  notes?: string;
  tags?: string[];
  isActive?: boolean;
}

export interface CitationWithUsage extends Citation {
  usages: CitationUsage[];
  usageCount: number;
}

export interface BulkSearchResultImportInput {
  searchResult: SearchResult;
  citationMeta?: CitationAIMeta;
  clientRef?: string;
}

export interface BulkSearchResultImportRecord {
  citation: Citation;
  searchResult: SearchResult;
  clientRef?: string;
}

export interface BulkSearchResultImportSkipped {
  searchResult: SearchResult;
  clientRef?: string;
  reason: 'INVALID_INPUT' | 'DUPLICATE_EXISTING' | 'DUPLICATE_BATCH' | 'SKIPPED_BY_DB_CONSTRAINT';
}

export interface BulkSearchResultImportResult {
  imported: BulkSearchResultImportRecord[];
  skipped: BulkSearchResultImportSkipped[];
}

export interface QualityCheckResult {
  unusedCitations: CitationWithUsage[];
  duplicateCitations: Array<{
    citations: Citation[];
    reason: string;
  }>;
  incompleteCitations: Citation[];
  suggestions: string[];
}

const AI_META_CLAIM_TYPE_VALUES = [
  'BACKGROUND',
  'GAP',
  'METHOD',
  'LIMITATION',
  'DATASET',
  'IMPLEMENTATION_CONSTRAINT'
] as const;
const AI_META_CLAIM_TYPE_SET = new Set<string>(AI_META_CLAIM_TYPE_VALUES);

const AI_META_POSITIONAL_RELATION_VALUES = [
  'REINFORCES',
  'CONTRADICTS',
  'EXTENDS',
  'QUALIFIES',
  'TENSION'
] as const;
const AI_META_POSITIONAL_RELATION_SET = new Set<string>(AI_META_POSITIONAL_RELATION_VALUES);

const AI_META_REFERENCE_ARCHETYPE_VALUES = [
  'SYSTEM_ALGO_EVALUATION',
  'CONTROLLED_EXPERIMENTAL_STUDY',
  'EMPIRICAL_OBSERVATIONAL_STUDY',
  'MIXED_METHODS_APPLIED_STUDY',
  'SYNTHESIS_REVIEW',
  'POSITION_CONCEPTUAL'
] as const;
const AI_META_REFERENCE_ARCHETYPE_SET = new Set<string>(AI_META_REFERENCE_ARCHETYPE_VALUES);

class CitationService {
  /**
   * Import citation from DOI by fetching metadata
   */
  async importFromDOI(sessionId: string, doi: string): Promise<Citation> {
    // Clean and validate DOI format
    const cleanedDOI = this.cleanDOI(doi);
    if (!cleanedDOI) {
      throw new Error('Invalid DOI format. Please enter a valid DOI (e.g., 10.1038/nature12373)');
    }

    // Check if citation already exists for this session
    const existingCitation = await prisma.citation.findFirst({
      where: {
        sessionId,
        OR: [
          { doi: cleanedDOI.toLowerCase() },
          { doiNormalized: cleanedDOI.toLowerCase() }
        ]
      }
    });

    if (existingCitation) {
      throw new Error('Citation with this DOI already exists in the session');
    }

    // Fetch metadata from literature search service
    const searchResult = await literatureSearchService.getByIdentifier(cleanedDOI);
    if (!searchResult) {
      throw new Error('Could not find paper with this DOI. Please verify the DOI is correct.');
    }

    // Create citation from search result
    return this.importFromSearchResult(sessionId, searchResult);
  }

  /**
   * Import citations from BibTeX string
   */
  async importFromBibTeX(sessionId: string, bibtexString: string): Promise<Citation[]> {
    const parsedCitations = citationStyleService.parseBibTeX(bibtexString);

    if (parsedCitations.length === 0) {
      throw new Error('No valid citations found in BibTeX string');
    }

    const importedCitations: Citation[] = [];

    for (const parsedCitation of parsedCitations) {
      try {
        // Check for duplicates
        const existingCitation = await this.findDuplicate(sessionId, parsedCitation);
        if (existingCitation) {
          console.warn(`Skipping duplicate citation: ${parsedCitation.title}`);
          continue;
        }

        const citation = await this.createCitation({
          sessionId,
          sourceType: this.inferSourceType(parsedCitation),
          title: parsedCitation.title,
          authors: parsedCitation.authors,
          year: parsedCitation.year,
          venue: parsedCitation.venue,
          volume: parsedCitation.volume,
          issue: parsedCitation.issue,
          pages: parsedCitation.pages,
          doi: parsedCitation.doi,
          url: parsedCitation.url,
      isbn: parsedCitation.isbn,
      publisher: parsedCitation.publisher,
      edition: parsedCitation.edition,
      editors: parsedCitation.editors,
      publicationPlace: parsedCitation.publicationPlace,
      publicationDate: parsedCitation.publicationDate,
      accessedDate: parsedCitation.accessedDate,
      articleNumber: parsedCitation.articleNumber,
      issn: parsedCitation.issn,
      journalAbbreviation: parsedCitation.journalAbbreviation,
      pmid: parsedCitation.pmid,
      pmcid: parsedCitation.pmcid,
      arxivId: parsedCitation.arxivId,
      importSource: 'BIBTEX_IMPORT'
    });

        importedCitations.push(citation);
      } catch (error) {
        console.error(`Failed to import citation: ${parsedCitation.title}`, error);
        // Continue with other citations
      }
    }

    return importedCitations;
  }

  /**
   * Import citation from search result with optional AI-generated metadata
   */
  async importFromSearchResult(
    sessionId: string, 
    searchResult: SearchResult,
    citationMeta?: CitationAIMeta
  ): Promise<Citation> {
    // Check for duplicates
    const existingCitation = await this.findDuplicate(sessionId, searchResult);
    if (existingCitation) {
      throw new Error('Similar citation already exists in the session');
    }

    const doiNormalized = this.normalizeDOI(searchResult.doi);
    const titleFingerprint = this.buildTitleFingerprint(searchResult.title);
    const firstAuthorNormalized = this.normalizeAuthor(searchResult.authors?.[0]);
    const paperIdentityKey = this.buildPaperIdentityKey({
      doi: searchResult.doi,
      title: searchResult.title,
      year: searchResult.year,
      firstAuthor: searchResult.authors?.[0]
    });

    return this.createCitation({
      sessionId,
      sourceType: this.inferSourceType(searchResult),
      title: searchResult.title,
      authors: searchResult.authors,
      year: searchResult.year,
      venue: searchResult.venue,
      volume: this.normalizeLooseString(searchResult.volume),
      issue: this.normalizeLooseString(searchResult.issue),
      pages: this.normalizeLooseString(searchResult.pages),
      doi: searchResult.doi,
      url: searchResult.url,
      isbn: this.normalizeLooseString(searchResult.isbn),
      publisher: this.normalizeLooseString(searchResult.publisher),
      edition: this.normalizeLooseString(searchResult.edition),
      editors: this.normalizeLooseStringArray(searchResult.editors),
      publicationPlace: this.normalizeLooseString(searchResult.publicationPlace),
      publicationDate: this.normalizeLooseString(searchResult.publicationDate),
      accessedDate: this.normalizeLooseString(searchResult.accessedDate),
      articleNumber: this.normalizeLooseString(searchResult.articleNumber),
      issn: this.normalizeLooseString(searchResult.issn),
      journalAbbreviation: this.normalizeLooseString(searchResult.journalAbbreviation),
      pmid: this.normalizeLooseString(searchResult.pmid),
      pmcid: this.normalizeLooseString(searchResult.pmcid),
      arxivId: this.normalizeLooseString(searchResult.arxivId),
      abstract: searchResult.abstract,
      notes: searchResult.abstract,
      importSource: this.mapSearchSourceToImportSource(searchResult.source),
      importProvider: searchResult.source || undefined,
      importProviderPaperId: searchResult.id || undefined,
      doiNormalized,
      titleFingerprint,
      firstAuthorNormalized,
      paperIdentityKey,
      libraryReferenceId: this.normalizeLooseString(searchResult.libraryReferenceId) || undefined,
      // Store AI-generated citation metadata for section generation
      aiMeta: this.buildAIMetaPayload(citationMeta)
    });
  }

  /**
   * Manually add a citation
   */
  async addManualCitation(sessionId: string, citationData: Omit<CreateCitationInput, 'sessionId' | 'importSource'>): Promise<Citation> {
    // Check for duplicates
    const existingCitation = await this.findDuplicate(sessionId, citationData);
    if (existingCitation) {
      throw new Error('Similar citation already exists in the session');
    }

    return this.createCitation({
      ...citationData,
      sessionId,
      importSource: 'MANUAL'
    });
  }

  /**
   * Update citation
   */
  async updateCitation(citationId: string, updates: UpdateCitationInput): Promise<Citation> {
    const citation = await prisma.citation.findUnique({
      where: { id: citationId }
    });

    if (!citation) {
      throw new Error('Citation not found');
    }

    // If DOI is being updated, check for duplicates
    if (updates.doi && updates.doi !== citation.doi) {
      const existingCitation = await prisma.citation.findFirst({
        where: {
          sessionId: citation.sessionId,
          OR: [
            { doi: updates.doi.toLowerCase() },
            { doiNormalized: updates.doi.toLowerCase() }
          ],
          id: { not: citationId }
        }
      });

      if (existingCitation) {
        throw new Error('Citation with this DOI already exists in the session');
      }
    }

    const nextTitle = updates.title ?? citation.title;
    const nextAuthors = updates.authors ?? citation.authors;
    const nextYear = updates.year ?? citation.year;
    const nextDoi = updates.doi ?? citation.doi;

    return prisma.citation.update({
      where: { id: citationId },
      data: {
        title: updates.title,
        authors: updates.authors,
        year: updates.year,
        venue: updates.venue,
        volume: updates.volume,
        issue: updates.issue,
        pages: updates.pages,
        doi: updates.doi,
        url: updates.url,
        isbn: updates.isbn,
        publisher: updates.publisher,
        edition: updates.edition,
        editors: updates.editors,
        publicationPlace: updates.publicationPlace,
        publicationDate: updates.publicationDate,
        accessedDate: updates.accessedDate,
        articleNumber: updates.articleNumber,
        issn: updates.issn,
        journalAbbreviation: updates.journalAbbreviation,
        pmid: updates.pmid,
        pmcid: updates.pmcid,
        arxivId: updates.arxivId,
        abstract: updates.abstract,
        notes: updates.notes,
        tags: updates.tags,
        isActive: updates.isActive,
        doiNormalized: this.normalizeDOI(nextDoi || undefined),
        titleFingerprint: this.buildTitleFingerprint(nextTitle),
        firstAuthorNormalized: this.normalizeAuthor(nextAuthors?.[0]),
        paperIdentityKey: this.buildPaperIdentityKey({
          doi: nextDoi || undefined,
          title: nextTitle,
          year: nextYear || undefined,
          firstAuthor: nextAuthors?.[0]
        })
      }
    });
  }

  /**
   * Bulk import citations from search results in a single DB write.
   * Uses in-memory duplicate detection to mirror single-import behavior.
   */
  async importFromSearchResultsBulk(
    sessionId: string,
    items: BulkSearchResultImportInput[]
  ): Promise<BulkSearchResultImportResult> {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        imported: [],
        skipped: []
      };
    }

    const existingCitations = await prisma.citation.findMany({
      where: { sessionId },
      select: {
        citationKey: true,
        doi: true,
        doiNormalized: true,
        paperIdentityKey: true,
        title: true,
        authors: true,
        year: true
      }
    });

    const existingCitationKeys = existingCitations.map(c => c.citationKey);
    const existingNormalizedDois = new Set<string>();
    const existingIdentityKeys = new Set<string>();
    const existingTitleAuthorYearKeys = new Set<string>();

    for (const citation of existingCitations) {
      const normalizedDoi = this.normalizeDOI(citation.doiNormalized || citation.doi);
      if (normalizedDoi) {
        existingNormalizedDois.add(normalizedDoi);
      }

      if (citation.paperIdentityKey) {
        existingIdentityKeys.add(citation.paperIdentityKey);
      }

      const tayKey = this.buildTitleAuthorYearDuplicateKey(
        citation.title,
        citation.authors,
        citation.year
      );
      if (tayKey) {
        existingTitleAuthorYearKeys.add(tayKey);
      }
    }

    const batchNormalizedDois = new Set<string>();
    const batchIdentityKeys = new Set<string>();
    const batchTitleAuthorYearKeys = new Set<string>();
    const nowIso = new Date().toISOString();
    const createRows: Prisma.CitationCreateManyInput[] = [];
    const acceptedItems: Array<{
      id: string;
      item: BulkSearchResultImportInput;
    }> = [];
    const skipped: BulkSearchResultImportSkipped[] = [];

    for (const item of items) {
      const searchResult = item.searchResult;
      const normalizedTitle = typeof searchResult?.title === 'string'
        ? searchResult.title.trim()
        : '';
      const normalizedYear = Number.isFinite(Number(searchResult?.year))
        ? Math.trunc(Number(searchResult.year))
        : undefined;
      const normalizedVenue = typeof searchResult?.venue === 'string'
        ? searchResult.venue
        : undefined;
      const normalizedDoiRaw = typeof searchResult?.doi === 'string'
        ? searchResult.doi
        : undefined;
      const normalizedUrl = typeof searchResult?.url === 'string'
        ? searchResult.url
        : undefined;
      const normalizedVolume = this.normalizeLooseString(searchResult?.volume);
      const normalizedIssue = this.normalizeLooseString(searchResult?.issue);
      const normalizedPages = this.normalizeLooseString(searchResult?.pages);
      const normalizedIsbn = this.normalizeLooseString(searchResult?.isbn);
      const normalizedPublisher = this.normalizeLooseString(searchResult?.publisher);
      const normalizedEdition = this.normalizeLooseString(searchResult?.edition);
      const normalizedEditors = this.normalizeLooseStringArray(searchResult?.editors);
      const normalizedPublicationPlace = this.normalizeLooseString(searchResult?.publicationPlace);
      const normalizedPublicationDate = this.normalizeLooseString(searchResult?.publicationDate);
      const normalizedAccessedDate = this.normalizeLooseString(searchResult?.accessedDate);
      const normalizedArticleNumber = this.normalizeLooseString(searchResult?.articleNumber);
      const normalizedIssn = this.normalizeLooseString(searchResult?.issn);
      const normalizedJournalAbbreviation = this.normalizeLooseString(searchResult?.journalAbbreviation);
      const normalizedPmid = this.normalizeLooseString(searchResult?.pmid);
      const normalizedPmcid = this.normalizeLooseString(searchResult?.pmcid);
      const normalizedArxivId = this.normalizeLooseString(searchResult?.arxivId);
      const normalizedAbstract = typeof searchResult?.abstract === 'string'
        ? searchResult.abstract
        : undefined;
      const normalizedSource = typeof searchResult?.source === 'string'
        ? searchResult.source
        : 'manual';
      const normalizedProviderPaperId = typeof searchResult?.id === 'string'
        ? searchResult.id
        : undefined;
      const normalizedAuthors = Array.isArray(searchResult?.authors)
        ? searchResult.authors
            .filter((author): author is string => typeof author === 'string' && author.trim().length > 0)
            .map(author => author.trim())
        : [];

      if (!normalizedTitle || normalizedAuthors.length === 0) {
        skipped.push({
          searchResult,
          clientRef: item.clientRef,
          reason: 'INVALID_INPUT'
        });
        continue;
      }

      const normalizedDoi = this.normalizeDOI(normalizedDoiRaw);
      const paperIdentityKey = this.buildPaperIdentityKey({
        doi: normalizedDoiRaw,
        title: normalizedTitle,
        year: normalizedYear,
        firstAuthor: normalizedAuthors[0]
      });
      const titleAuthorYearKey = this.buildTitleAuthorYearDuplicateKey(
        normalizedTitle,
        normalizedAuthors,
        normalizedYear
      );

      if (normalizedDoi && existingNormalizedDois.has(normalizedDoi)) {
        skipped.push({
          searchResult,
          clientRef: item.clientRef,
          reason: 'DUPLICATE_EXISTING'
        });
        continue;
      }
      if (paperIdentityKey && existingIdentityKeys.has(paperIdentityKey)) {
        skipped.push({
          searchResult,
          clientRef: item.clientRef,
          reason: 'DUPLICATE_EXISTING'
        });
        continue;
      }
      if (titleAuthorYearKey && existingTitleAuthorYearKeys.has(titleAuthorYearKey)) {
        skipped.push({
          searchResult,
          clientRef: item.clientRef,
          reason: 'DUPLICATE_EXISTING'
        });
        continue;
      }

      if (normalizedDoi && batchNormalizedDois.has(normalizedDoi)) {
        skipped.push({
          searchResult,
          clientRef: item.clientRef,
          reason: 'DUPLICATE_BATCH'
        });
        continue;
      }
      if (paperIdentityKey && batchIdentityKeys.has(paperIdentityKey)) {
        skipped.push({
          searchResult,
          clientRef: item.clientRef,
          reason: 'DUPLICATE_BATCH'
        });
        continue;
      }
      if (titleAuthorYearKey && batchTitleAuthorYearKeys.has(titleAuthorYearKey)) {
        skipped.push({
          searchResult,
          clientRef: item.clientRef,
          reason: 'DUPLICATE_BATCH'
        });
        continue;
      }

      const citationId = `citation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const citationData: CitationData = {
        id: citationId,
        title: normalizedTitle,
        authors: normalizedAuthors,
        year: normalizedYear,
        venue: normalizedVenue,
        volume: normalizedVolume,
        issue: normalizedIssue,
        pages: normalizedPages,
        doi: normalizedDoiRaw,
        url: normalizedUrl,
        isbn: normalizedIsbn,
        publisher: normalizedPublisher,
        edition: normalizedEdition,
        editors: normalizedEditors,
        publicationPlace: normalizedPublicationPlace,
        publicationDate: normalizedPublicationDate,
        accessedDate: normalizedAccessedDate,
        articleNumber: normalizedArticleNumber,
        issn: normalizedIssn,
        journalAbbreviation: normalizedJournalAbbreviation,
        pmid: normalizedPmid,
        pmcid: normalizedPmcid,
        arxivId: normalizedArxivId,
        citationKey: ''
      };

      citationData.citationKey = citationStyleService.generateCitationKey(citationData, existingCitationKeys);
      existingCitationKeys.push(citationData.citationKey);

      const aiMeta = this.buildAIMetaPayload(item.citationMeta, nowIso);

      const titleFingerprint = this.buildTitleFingerprint(normalizedTitle);
      const firstAuthorNormalized = this.normalizeAuthor(normalizedAuthors[0]);

      const rawLibraryRefId = typeof searchResult?.libraryReferenceId === 'string'
        ? searchResult.libraryReferenceId.trim()
        : undefined;

      createRows.push({
        id: citationId,
        sessionId,
        sourceType: this.inferSourceType(searchResult),
        title: normalizedTitle,
        authors: normalizedAuthors,
        year: normalizedYear,
        venue: normalizedVenue,
        volume: normalizedVolume,
        issue: normalizedIssue,
        pages: normalizedPages,
        doi: normalizedDoiRaw,
        url: normalizedUrl,
        isbn: normalizedIsbn,
        publisher: normalizedPublisher,
        edition: normalizedEdition,
        editors: normalizedEditors,
        publicationPlace: normalizedPublicationPlace,
        publicationDate: normalizedPublicationDate,
        accessedDate: normalizedAccessedDate,
        articleNumber: normalizedArticleNumber,
        issn: normalizedIssn,
        journalAbbreviation: normalizedJournalAbbreviation,
        pmid: normalizedPmid,
        pmcid: normalizedPmcid,
        arxivId: normalizedArxivId,
        abstract: normalizedAbstract,
        citationKey: citationData.citationKey,
        importSource: this.mapSearchSourceToImportSource(normalizedSource),
        importProvider: normalizedSource || undefined,
        importProviderPaperId: normalizedProviderPaperId,
        doiNormalized: normalizedDoi,
        titleFingerprint,
        firstAuthorNormalized,
        paperIdentityKey,
        libraryReferenceId: rawLibraryRefId || undefined,
        notes: normalizedAbstract,
        tags: [],
        aiMeta: aiMeta as Prisma.InputJsonValue | undefined
      });

      acceptedItems.push({
        id: citationId,
        item
      });

      if (normalizedDoi) {
        batchNormalizedDois.add(normalizedDoi);
      }
      if (paperIdentityKey) {
        batchIdentityKeys.add(paperIdentityKey);
      }
      if (titleAuthorYearKey) {
        batchTitleAuthorYearKeys.add(titleAuthorYearKey);
      }
    }

    if (createRows.length > 0) {
      await prisma.citation.createMany({
        data: createRows,
        skipDuplicates: true
      });
    }

    const createdIds = acceptedItems.map(item => item.id);
    const createdMap = new Map<string, Citation>();

    if (createdIds.length > 0) {
      const created = await prisma.citation.findMany({
        where: {
          id: { in: createdIds }
        }
      });
      for (const citation of created) {
        createdMap.set(citation.id, citation);
      }
    }

    const imported: BulkSearchResultImportRecord[] = [];
    for (const accepted of acceptedItems) {
      const created = createdMap.get(accepted.id);
      if (created) {
        imported.push({
          citation: created,
          searchResult: accepted.item.searchResult,
          clientRef: accepted.item.clientRef
        });
        continue;
      }

      skipped.push({
        searchResult: accepted.item.searchResult,
        clientRef: accepted.item.clientRef,
        reason: 'SKIPPED_BY_DB_CONSTRAINT'
      });
    }

    return {
      imported,
      skipped
    };
  }

  /**
   * Delete citation (with usage check)
   */
  async deleteCitation(citationId: string): Promise<{ deleted: boolean; warning?: string }> {
    const citation = await prisma.citation.findUnique({
      where: { id: citationId },
      include: {
        usages: {
          where: {
            usageKind: 'DRAFT_CITATION'
          }
        }
      }
    });

    if (!citation) {
      throw new Error('Citation not found');
    }

    if (citation.usages.length > 0) {
      return {
        deleted: false,
        warning: `Citation is used in ${citation.usages.length} section(s). Deletion will remove all references.`
      };
    }

    await prisma.citation.delete({
      where: { id: citationId }
    });

    return { deleted: true };
  }

  /**
   * Force delete citation (ignores usage warnings)
   */
  async forceDeleteCitation(citationId: string): Promise<void> {
    await prisma.citation.delete({
      where: { id: citationId }
    });
  }

  /**
   * Get all citations for a session
   */
  async getCitationsForSession(sessionId: string): Promise<CitationWithUsage[]> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      include: {
        usages: {
          where: {
            usageKind: 'DRAFT_CITATION'
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return citations.map(citation => ({
      ...citation,
      usageCount: citation.usages.length
    }));
  }

  /**
   * Get citations used in a specific section
   */
  async getCitationsBySection(sessionId: string, sectionKey: string): Promise<Citation[]> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true,
        usages: {
          some: {
            sectionKey,
            usageKind: 'DRAFT_CITATION'
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return citations;
  }

  /**
   * Mark citation as used in a section
   */
  async markCitationUsed(
    citationId: string,
    sectionKey: string,
    contextSnippet?: string,
    position?: number,
    options?: {
      usageKind?: CitationUsageKind;
      dimension?: string | null;
      confidence?: DimensionMappingConfidence | null;
      remark?: string | null;
      mappedAt?: Date | null;
      mappingSource?: string | null;
    }
  ): Promise<CitationUsage> {
    const citation = await prisma.citation.findUnique({
      where: { id: citationId }
    });

    if (!citation) {
      throw new Error('Citation not found');
    }

    const usageKind = options?.usageKind || 'DRAFT_CITATION';
    const dimension = options?.dimension || null;

    // Check if usage already exists
    const existingUsage = await prisma.citationUsage.findFirst({
      where: {
        citationId,
        sectionKey,
        position,
        usageKind,
        dimension: usageKind === 'DIMENSION_MAPPING' ? dimension : undefined
      }
    });

    if (existingUsage) {
      // Update existing usage
      return prisma.citationUsage.update({
        where: { id: existingUsage.id },
        data: {
          contextSnippet,
          remark: options?.remark ?? existingUsage.remark,
          confidence: options?.confidence ?? existingUsage.confidence,
          mappedAt: options?.mappedAt ?? existingUsage.mappedAt,
          mappingSource: usageKind === 'DIMENSION_MAPPING'
            ? (options?.mappingSource || 'auto')
            : null,
          dimension: usageKind === 'DIMENSION_MAPPING' ? dimension : null,
          updatedAt: new Date()
        }
      });
    }

    // Create new usage
    return prisma.citationUsage.create({
      data: {
        citationId,
        sectionKey,
        contextSnippet,
        position,
        inTextFormat: await this.generateInTextFormat(citation),
        usageKind,
        dimension: usageKind === 'DIMENSION_MAPPING' ? dimension : null,
        remark: options?.remark ?? null,
        confidence: options?.confidence ?? null,
        mappedAt: options?.mappedAt ?? null,
        mappingSource: usageKind === 'DIMENSION_MAPPING'
          ? (options?.mappingSource || 'auto')
          : null
      }
    });
  }

  /**
   * Find unused citations in a session
   */
  async findUnusedCitations(sessionId: string): Promise<CitationWithUsage[]> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true,
        usages: {
          none: {
            usageKind: 'DRAFT_CITATION'
          }
        }
      },
      include: {
        usages: {
          where: {
            usageKind: 'DRAFT_CITATION'
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return citations.map(citation => ({
      ...citation,
      usageCount: citation.usages.length
    }));
  }

  /**
   * Find duplicate citations in a session
   */
  async findDuplicateCitations(sessionId: string): Promise<Array<{
    citations: Citation[];
    reason: string;
  }>> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const duplicates: Array<{
      citations: Citation[];
      reason: string;
    }> = [];

    // Group by DOI
    const byDOI = new Map<string, Citation[]>();
    for (const citation of citations) {
      if (citation.doi) {
        const doi = citation.doi.toLowerCase();
        if (!byDOI.has(doi)) {
          byDOI.set(doi, []);
        }
        byDOI.get(doi)!.push(citation);
      }
    }

    // Find DOI duplicates
    for (const [doi, citationGroup] of Array.from(byDOI.entries())) {
      if (citationGroup.length > 1) {
        duplicates.push({
          citations: citationGroup,
          reason: `Duplicate DOI: ${doi}`
        });
      }
    }

    // Group by title + first author + year (fuzzy matching)
    const byTitleAuthor = new Map<string, Citation[]>();
    for (const citation of citations) {
      if (!citation.doi) { // Skip those with DOI as they're handled above
        const key = `${citation.title.toLowerCase().substring(0, 50)}|${citation.authors[0] || ''}|${citation.year || ''}`;
        if (!byTitleAuthor.has(key)) {
          byTitleAuthor.set(key, []);
        }
        byTitleAuthor.get(key)!.push(citation);
      }
    }

    // Find title/author duplicates
    for (const [key, citationGroup] of Array.from(byTitleAuthor.entries())) {
      if (citationGroup.length > 1) {
        duplicates.push({
          citations: citationGroup,
          reason: `Similar title and author: ${citationGroup[0].title.substring(0, 50)}...`
        });
      }
    }

    return duplicates;
  }

  /**
   * Run quality checks on citations
   */
  async runQualityChecks(sessionId: string): Promise<QualityCheckResult> {
    const [
      unusedCitations,
      duplicateCitations,
      allCitations
    ] = await Promise.all([
      this.findUnusedCitations(sessionId),
      this.findDuplicateCitations(sessionId),
      this.getCitationsForSession(sessionId)
    ]);

    // Find incomplete citations
    const incompleteCitations = allCitations.filter(citation =>
      !citation.title ||
      citation.authors.length === 0 ||
      !citation.year ||
      !citation.venue
    );

    // Generate suggestions
    const suggestions: string[] = [];

    if (unusedCitations.length > 0) {
      suggestions.push(`Consider removing ${unusedCitations.length} unused citation(s) or cite them in your paper`);
    }

    if (duplicateCitations.length > 0) {
      suggestions.push(`Review ${duplicateCitations.length} potential duplicate citation(s)`);
    }

    if (incompleteCitations.length > 0) {
      suggestions.push(`Complete metadata for ${incompleteCitations.length} citation(s) with missing information`);
    }

    // Check citation diversity
    const sourceTypes = new Set(allCitations.map(c => c.sourceType));
    if (sourceTypes.size < 3 && allCitations.length > 10) {
      suggestions.push('Consider diversifying your citation sources (journals, conferences, books)');
    }

    return {
      unusedCitations,
      duplicateCitations,
      incompleteCitations,
      suggestions
    };
  }

  /**
   * Get citation statistics for a session
   */
  async getCitationStats(sessionId: string): Promise<{
    total: number;
    bySourceType: Record<string, number>;
    byImportSource: Record<string, number>;
    unused: number;
    duplicates: number;
    averageAge: number;
  }> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      include: {
        usages: {
          where: {
            usageKind: 'DRAFT_CITATION'
          }
        }
      }
    });

    const bySourceType: Record<string, number> = {};
    const byImportSource: Record<string, number> = {};
    let totalAge = 0;
    let ageCount = 0;

    for (const citation of citations) {
      // Count by source type
      bySourceType[citation.sourceType] = (bySourceType[citation.sourceType] || 0) + 1;

      // Count by import source
      byImportSource[citation.importSource] = (byImportSource[citation.importSource] || 0) + 1;

      // Calculate age
      if (citation.year) {
        totalAge += new Date().getFullYear() - citation.year;
        ageCount++;
      }
    }

    const unused = citations.filter(c => c.usages.length === 0).length;
    const duplicates = (await this.findDuplicateCitations(sessionId)).length;

    return {
      total: citations.length,
      bySourceType,
      byImportSource,
      unused,
      duplicates,
      averageAge: ageCount > 0 ? Math.round(totalAge / ageCount) : 0
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async createCitation(input: CreateCitationInput): Promise<Citation> {
    // Generate citation key
    const existingCitations = await this.getCitationsForSession(input.sessionId);
    const existingKeys = existingCitations.map(c => c.citationKey);

    const normalizedDOI = input.doiNormalized ?? this.normalizeDOI(input.doi);
    const titleFingerprint = input.titleFingerprint ?? this.buildTitleFingerprint(input.title);
    const firstAuthorNormalized = input.firstAuthorNormalized ?? this.normalizeAuthor(input.authors?.[0]);
    const paperIdentityKey = input.paperIdentityKey ?? this.buildPaperIdentityKey({
      doi: input.doi,
      title: input.title,
      year: input.year,
      firstAuthor: input.authors?.[0]
    });
    const sanitizedAIMeta = this.buildAIMetaPayload(input.aiMeta);

    const citationData: CitationData = {
      id: `citation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: input.title,
      authors: input.authors,
      year: input.year,
      venue: input.venue,
      volume: input.volume,
      issue: input.issue,
      pages: input.pages,
      doi: input.doi,
      url: input.url,
      isbn: input.isbn,
      publisher: input.publisher,
      edition: input.edition,
      editors: input.editors,
      publicationPlace: input.publicationPlace,
      publicationDate: input.publicationDate,
      accessedDate: input.accessedDate,
      articleNumber: input.articleNumber,
      issn: input.issn,
      journalAbbreviation: input.journalAbbreviation,
      pmid: input.pmid,
      pmcid: input.pmcid,
      arxivId: input.arxivId,
      citationKey: ''
    };

    citationData.citationKey = citationStyleService.generateCitationKey(citationData, existingKeys);

    return prisma.citation.create({
      data: {
        id: citationData.id,
        sessionId: input.sessionId,
        sourceType: input.sourceType,
        title: input.title,
        authors: input.authors,
        year: input.year,
        venue: input.venue,
        volume: input.volume,
        issue: input.issue,
        pages: input.pages,
        doi: input.doi,
        url: input.url,
        isbn: input.isbn,
        publisher: input.publisher,
        edition: input.edition,
        editors: input.editors,
        publicationPlace: input.publicationPlace,
        publicationDate: input.publicationDate,
        accessedDate: input.accessedDate,
        articleNumber: input.articleNumber,
        issn: input.issn,
        journalAbbreviation: input.journalAbbreviation,
        pmid: input.pmid,
        pmcid: input.pmcid,
        arxivId: input.arxivId,
        abstract: input.abstract,
        citationKey: citationData.citationKey,
        importSource: input.importSource,
        importProvider: input.importProvider,
        importProviderPaperId: input.importProviderPaperId,
        doiNormalized: normalizedDOI,
        titleFingerprint,
        firstAuthorNormalized,
        paperIdentityKey,
        libraryReferenceId: input.libraryReferenceId,
        notes: input.notes,
        tags: input.tags || [],
        aiMeta: sanitizedAIMeta as Prisma.InputJsonValue | undefined
      }
    });
  }

  private buildAIMetaPayload(
    citationMeta?: CitationAIMeta,
    analyzedAtOverride?: string
  ): CitationAIMeta | undefined {
    if (!citationMeta || typeof citationMeta !== 'object') {
      return undefined;
    }

    const clamp = (value: unknown, maxLength: number): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, maxLength) : undefined;
    };

    const payload: CitationAIMeta = {};

    const keyContribution = clamp(citationMeta.keyContribution, 400);
    if (keyContribution) payload.keyContribution = keyContribution;

    const keyFindings = clamp(citationMeta.keyFindings, 400);
    if (keyFindings) payload.keyFindings = keyFindings;

    const methodologicalApproach = clamp(citationMeta.methodologicalApproach, 400);
    if (methodologicalApproach) {
      payload.methodologicalApproach = methodologicalApproach;
    } else if (citationMeta.methodologicalApproach === null) {
      payload.methodologicalApproach = null;
    }

    const relevanceToResearch = clamp(citationMeta.relevanceToResearch, 500);
    if (relevanceToResearch) payload.relevanceToResearch = relevanceToResearch;

    const limitationsOrGaps = clamp(citationMeta.limitationsOrGaps, 500);
    if (limitationsOrGaps) {
      payload.limitationsOrGaps = limitationsOrGaps;
    } else if (citationMeta.limitationsOrGaps === null) {
      payload.limitationsOrGaps = null;
    }

    const claimTypesSupported = Array.isArray(citationMeta.claimTypesSupported)
      ? Array.from(
          new Set(
            citationMeta.claimTypesSupported
              .map((value: unknown) => String(value).trim().toUpperCase())
              .filter((value: string) => AI_META_CLAIM_TYPE_SET.has(value))
          )
        ).slice(0, 3) as CitationAIMeta['claimTypesSupported']
      : undefined;
    if (claimTypesSupported && claimTypesSupported.length > 0) {
      payload.claimTypesSupported = claimTypesSupported;
    }

    const evidenceBoundary = clamp(citationMeta.evidenceBoundary, 400);
    if (evidenceBoundary) {
      payload.evidenceBoundary = evidenceBoundary;
    } else if (citationMeta.evidenceBoundary === null) {
      payload.evidenceBoundary = null;
    }

    if (citationMeta.positionalRelation && typeof citationMeta.positionalRelation === 'object') {
      const relationCandidate = typeof citationMeta.positionalRelation.relation === 'string'
        ? citationMeta.positionalRelation.relation.trim().toUpperCase()
        : '';
      const rationale = clamp(citationMeta.positionalRelation.rationale, 300);
      if (AI_META_POSITIONAL_RELATION_SET.has(relationCandidate) || rationale) {
        payload.positionalRelation = {
          relation: AI_META_POSITIONAL_RELATION_SET.has(relationCandidate)
            ? relationCandidate as NonNullable<CitationAIMeta['positionalRelation']>['relation']
            : undefined,
          rationale
        };
      }
    }

    if (citationMeta.referenceArchetype === null) {
      payload.referenceArchetype = null;
    } else if (typeof citationMeta.referenceArchetype === 'string') {
      const normalizedArchetype = citationMeta.referenceArchetype.trim().toUpperCase();
      if (AI_META_REFERENCE_ARCHETYPE_SET.has(normalizedArchetype)) {
        payload.referenceArchetype = normalizedArchetype as NonNullable<CitationAIMeta['referenceArchetype']>;
      }
    }

    const archetypeSignal = clamp(citationMeta.archetypeSignal, 300);
    if (archetypeSignal) {
      payload.archetypeSignal = archetypeSignal;
    } else if (citationMeta.archetypeSignal === null) {
      payload.archetypeSignal = null;
    }

    if (citationMeta.usage && typeof citationMeta.usage === 'object') {
      payload.usage = {
        introduction: Boolean(citationMeta.usage.introduction),
        literatureReview: Boolean(citationMeta.usage.literatureReview),
        methodology: Boolean(citationMeta.usage.methodology),
        comparison: Boolean(citationMeta.usage.comparison)
      };
    }

    const relevanceScore = Number(citationMeta.relevanceScore);
    if (Number.isFinite(relevanceScore)) {
      payload.relevanceScore = Math.max(0, Math.min(100, relevanceScore));
    }

    const hasMetadata = Object.keys(payload).length > 0;
    if (!hasMetadata) {
      return undefined;
    }

    payload.analyzedAt = analyzedAtOverride || clamp(citationMeta.analyzedAt, 80) || new Date().toISOString();
    return payload;
  }

  private async findDuplicate(sessionId: string, citationData: Partial<CreateCitationInput | SearchResult>): Promise<Citation | null> {
    // Check DOI first
    const normalizedDoi = this.normalizeDOI(citationData.doi);
    if (normalizedDoi) {
      const existing = await prisma.citation.findFirst({
        where: {
          sessionId,
          OR: [
            { doi: normalizedDoi },
            { doiNormalized: normalizedDoi }
          ]
        }
      });
      if (existing) return existing;
    }

    const paperIdentityKey = this.buildPaperIdentityKey({
      doi: citationData.doi,
      title: citationData.title,
      year: citationData.year,
      firstAuthor: citationData.authors?.[0]
    });
    if (paperIdentityKey) {
      const existing = await prisma.citation.findFirst({
        where: {
          sessionId,
          paperIdentityKey
        }
      });
      if (existing) return existing;
    }

    // Check title + first author + year
    if (citationData.title && citationData.authors && citationData.authors.length > 0 && citationData.year) {
      const existing = await prisma.citation.findFirst({
        where: {
          sessionId,
          title: {
            equals: citationData.title,
            mode: 'insensitive'
          },
          authors: {
            has: citationData.authors[0]
          },
          year: citationData.year
        }
      });
      if (existing) return existing;
    }

    return null;
  }

  private isValidDOI(doi: string): boolean {
    // Basic DOI validation
    return /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(doi);
  }

  private normalizeLooseString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const normalized = value.replace(/\s+/g, ' ').trim();
      return normalized || undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  }

  private normalizeLooseStringArray(values: unknown): string[] | undefined {
    if (!Array.isArray(values)) {
      return undefined;
    }
    const normalized = values
      .map(value => this.normalizeLooseString(value))
      .filter((value): value is string => Boolean(value));
    return normalized.length > 0 ? normalized : undefined;
  }

  /**
   * Clean DOI - remove URL prefixes and normalize
   */
  private cleanDOI(doi: string): string | null {
    if (!doi || typeof doi !== 'string') return null;

    // Remove common prefixes
    let cleaned = doi.trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .trim();

    // Validate the cleaned DOI
    if (this.isValidDOI(cleaned)) {
      return cleaned;
    }

    return null;
  }

  private normalizeDOI(doi?: string | null): string | undefined {
    if (!doi || typeof doi !== 'string') {
      return undefined;
    }
    const normalized = doi
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
      .replace(/^doi:/, '')
      .replace(/\s+/g, '');
    return normalized || undefined;
  }

  private buildTitleFingerprint(title?: string | null): string | undefined {
    if (!title || typeof title !== 'string') {
      return undefined;
    }
    const fingerprint = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return fingerprint || undefined;
  }

  private normalizeAuthor(author?: string | null): string | undefined {
    if (!author || typeof author !== 'string') {
      return undefined;
    }
    const normalized = author
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized || undefined;
  }

  private buildPaperIdentityKey(input: {
    doi?: string | null;
    title?: string | null;
    year?: number | null;
    firstAuthor?: string | null;
  }): string | undefined {
    const doiNormalized = this.normalizeDOI(input.doi);
    if (doiNormalized) {
      return `doi:${doiNormalized}`;
    }

    const titleFingerprint = this.buildTitleFingerprint(input.title);
    if (!titleFingerprint) {
      return undefined;
    }

    const yearPart = input.year ? String(input.year) : 'na';
    const authorPart = this.normalizeAuthor(input.firstAuthor) || 'na';
    return `tfp:${titleFingerprint}|y:${yearPart}|fa:${authorPart}`;
  }

  private buildTitleAuthorYearDuplicateKey(
    title?: string | null,
    authors?: string[] | null,
    year?: number | null
  ): string | undefined {
    const titleFingerprint = this.buildTitleFingerprint(title);
    const firstAuthor = this.normalizeAuthor(authors?.[0]);
    if (!titleFingerprint || !firstAuthor || !year) {
      return undefined;
    }
    return `${titleFingerprint}|${firstAuthor}|${year}`;
  }

  private inferSourceType(citationData: Partial<CreateCitationInput | SearchResult>): CitationSourceType {
    if (citationData.venue) {
      const venue = citationData.venue.toLowerCase();
      if (venue.includes('conference') || venue.includes('proceedings') || venue.includes('symposium')) {
        return 'CONFERENCE_PAPER';
      }
      if (venue.includes('journal') || venue.includes('transactions') || venue.includes('letters')) {
        return 'JOURNAL_ARTICLE';
      }
      if (venue.includes('book') || venue.includes('press')) {
        return 'BOOK';
      }
    }

    if (citationData.doi) {
      return 'JOURNAL_ARTICLE'; // Most DOIs are for journal articles
    }

    return 'OTHER';
  }

  private mapSearchSourceToImportSource(source: string): CitationImportSource {
    switch (source) {
      case 'google_scholar': return 'SCHOLAR_SEARCH';
      case 'semantic_scholar': return 'SEMANTIC_SCHOLAR';
      case 'crossref': return 'CROSSREF_API';
      case 'openalex': return 'OPENALEX';
      default: return 'MANUAL';
    }
  }

  private async generateInTextFormat(citation: Citation): Promise<string> {
    // This would be replaced with actual citation style formatting
    // For now, generate a simple format
    const authors = citation.authors.slice(0, 2).join(' & ');
    const year = citation.year || 'n.d.';
    return `(${authors}, ${year})`;
  }
}

// Export singleton instance
export const citationService = new CitationService();

// Export class for testing
export { CitationService };
