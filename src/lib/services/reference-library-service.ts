/**
 * Reference Library Service
 * Manages user's personal reference library (Mendeley-like functionality)
 */

import { prisma } from '../prisma';
import { CitationSourceType, CitationImportSource } from '@prisma/client';
import { ParsedReference, detectFormatAndParse, exportToBibTeX } from './reference-import-service';

export interface CreateReferenceInput {
  userId: string;
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
  sourceType?: CitationSourceType;
  importSource?: CitationImportSource;
  externalId?: string;
  notes?: string;
  tags?: string[];
  pdfUrl?: string;
}

export interface UpdateReferenceInput {
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
  sourceType?: CitationSourceType;
  notes?: string;
  tags?: string[];
  pdfUrl?: string;
  isRead?: boolean;
  isFavorite?: boolean;
}

export interface ReferenceFilter {
  search?: string;
  sourceType?: CitationSourceType;
  tags?: string[];
  collectionId?: string;
  isFavorite?: boolean;
  isRead?: boolean;
  hasAttachment?: boolean;
  yearFrom?: number;
  yearTo?: number;
}

class ReferenceLibraryService {
  // ============================================================================
  // REFERENCE CRUD
  // ============================================================================

  async createReference(input: CreateReferenceInput) {
    const cleanedDoi = input.doi ? this.cleanDOI(input.doi) || input.doi.trim() : undefined;

    let existingByDoi: { id: string; isActive: boolean; citationKey: string | null } | null = null;
    if (cleanedDoi) {
      existingByDoi = await prisma.referenceLibrary.findFirst({
        where: {
          userId: input.userId,
          doi: { equals: cleanedDoi, mode: 'insensitive' },
        },
        select: {
          id: true,
          isActive: true,
          citationKey: true,
        },
      });

      if (existingByDoi?.isActive) {
        throw new Error('Reference with this DOI already exists in your library');
      }
    }

    const existingKeys = await this.getExistingCitationKeys(input.userId);
    const citationKey =
      existingByDoi?.citationKey ||
      this.generateCitationKey(
        {
          title: input.title,
          authors: input.authors,
          year: input.year,
        },
        existingKeys
      );

    const referenceData = {
      userId: input.userId,
      title: input.title,
      authors: input.authors,
      year: input.year,
      venue: input.venue,
      volume: input.volume,
      issue: input.issue,
      pages: input.pages,
      doi: cleanedDoi,
      url: input.url,
      isbn: input.isbn,
      publisher: input.publisher,
      edition: input.edition,
      editors: input.editors || [],
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
      sourceType: input.sourceType || 'OTHER',
      importSource: input.importSource || 'MANUAL',
      externalId: input.externalId,
      citationKey,
      notes: input.notes,
      tags: input.tags || [],
      pdfUrl: input.pdfUrl,
    };

    // If a previously deleted DOI exists, reactivate and refresh its metadata.
    if (existingByDoi && !existingByDoi.isActive) {
      return prisma.referenceLibrary.update({
        where: { id: existingByDoi.id },
        data: {
          ...referenceData,
          isActive: true,
          updatedAt: new Date(),
          importDate: new Date(),
        },
      });
    }

    return prisma.referenceLibrary.create({
      data: referenceData,
    });
  }

  async getReference(userId: string, referenceId: string) {
    return prisma.referenceLibrary.findFirst({
      where: { id: referenceId, userId, isActive: true },
      include: {
        collections: {
          include: { collection: true },
        },
        documents: {
          orderBy: [{ isPrimary: 'desc' }, { linkedAt: 'desc' }],
          take: 1,
          include: {
            document: {
              select: {
                id: true,
                status: true,
                errorCode: true,
                originalFilename: true,
                fileSizeBytes: true,
                mimeType: true,
                pageCount: true,
                sourceType: true,
                sourceIdentifier: true,
                pdfTitle: true,
                pdfAuthors: true,
                pdfDoi: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
  }

  async getReferences(userId: string, filter: ReferenceFilter = {}, limit = 50, offset = 0) {
    // Validate and clamp limit
    const safeLimit = Math.min(Math.max(1, limit || 50), 100);
    const safeOffset = Math.max(0, offset || 0);
    
    const where: any = { userId, isActive: true };

    if (filter.search && filter.search.trim()) {
      const searchTerm = filter.search.trim();
      // Use raw query approach for author search since authors is an array
      // For now, use case-insensitive contains on title and venue
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { venue: { contains: searchTerm, mode: 'insensitive' } },
        { abstract: { contains: searchTerm, mode: 'insensitive' } },
        { citationKey: { contains: searchTerm, mode: 'insensitive' } },
      ];
      // For tags array, use hasSome with exact match
      if (filter.tags === undefined) {
        where.OR.push({ tags: { hasSome: [searchTerm] } });
      }
    }

    if (filter.sourceType) where.sourceType = filter.sourceType;
    if (filter.isFavorite !== undefined) where.isFavorite = filter.isFavorite;
    if (filter.isRead !== undefined) where.isRead = filter.isRead;
    if (filter.hasAttachment !== undefined) {
      where.documents = filter.hasAttachment
        ? { some: {} }
        : { none: {} };
    }
    if (filter.tags && filter.tags.length > 0) where.tags = { hasSome: filter.tags };
    
    // Handle year range properly
    if (filter.yearFrom || filter.yearTo) {
      where.year = {};
      if (filter.yearFrom) where.year.gte = filter.yearFrom;
      if (filter.yearTo) where.year.lte = filter.yearTo;
    }

    // Handle collection filter
    if (filter.collectionId) {
      const collectionItems = await prisma.referenceCollectionItem.findMany({
        where: { collectionId: filter.collectionId },
        select: { referenceId: true },
      });
      const refIds = collectionItems.map(item => item.referenceId);
      
      // If collection is empty, return empty results
      if (refIds.length === 0) {
        return { references: [], total: 0 };
      }
      where.id = { in: refIds };
    }

    const [references, total] = await Promise.all([
      prisma.referenceLibrary.findMany({
        where,
        orderBy: [{ isFavorite: 'desc' }, { updatedAt: 'desc' }],
        take: safeLimit,
        skip: safeOffset,
        include: {
          collections: {
            include: { collection: { select: { id: true, name: true, color: true } } },
          },
          documents: {
            orderBy: [{ isPrimary: 'desc' }, { linkedAt: 'desc' }],
            take: 1,
            include: {
              document: {
                select: {
                  id: true,
                  status: true,
                  errorCode: true,
                  originalFilename: true,
                  fileSizeBytes: true,
                  mimeType: true,
                  pageCount: true,
                  sourceType: true,
                  sourceIdentifier: true,
                  pdfTitle: true,
                  pdfAuthors: true,
                  pdfDoi: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      }),
      prisma.referenceLibrary.count({ where }),
    ]);

    return { references, total };
  }

  async updateReference(userId: string, referenceId: string, input: UpdateReferenceInput) {
    // First verify ownership
    const existing = await prisma.referenceLibrary.findFirst({
      where: { id: referenceId, userId, isActive: true },
    });
    if (!existing) {
      throw new Error('Reference not found');
    }

    return prisma.referenceLibrary.update({
      where: { id: referenceId },
      data: {
        ...input,
        updatedAt: new Date(),
      },
    });
  }

  async deleteReference(userId: string, referenceId: string) {
    // First verify ownership
    const existing = await prisma.referenceLibrary.findFirst({
      where: { id: referenceId, userId },
    });
    if (!existing) {
      throw new Error('Reference not found');
    }

    return prisma.referenceLibrary.update({
      where: { id: referenceId },
      data: { isActive: false },
    });
  }

  async toggleFavorite(userId: string, referenceId: string) {
    // Use transaction to prevent race conditions
    return prisma.$transaction(async (tx) => {
      const ref = await tx.referenceLibrary.findFirst({
        where: { id: referenceId, userId },
      });
      if (!ref) throw new Error('Reference not found');

      return tx.referenceLibrary.update({
        where: { id: referenceId },
        data: { isFavorite: !ref.isFavorite },
      });
    });
  }

  async toggleRead(userId: string, referenceId: string) {
    // Use transaction to prevent race conditions
    return prisma.$transaction(async (tx) => {
      const ref = await tx.referenceLibrary.findFirst({
        where: { id: referenceId, userId },
      });
      if (!ref) throw new Error('Reference not found');

      return tx.referenceLibrary.update({
        where: { id: referenceId },
        data: { isRead: !ref.isRead },
      });
    });
  }

  // ============================================================================
  // BULK IMPORT
  // ============================================================================

  async importReferences(userId: string, content: string, importSource?: CitationImportSource) {
    const parseResult = detectFormatAndParse(content);

    if (!parseResult.success && parseResult.references.length === 0) {
      return {
        success: false,
        imported: 0,
        errors: parseResult.errors,
        warnings: parseResult.warnings,
      };
    }

    const existingKeys = await this.getExistingCitationKeys(userId);
    const existingDOIs = await this.getExistingDOIs(userId);
    const imported: any[] = [];
    const attachmentHintsByReferenceId: Record<string, string[]> = {};
    const skipped: string[] = [];
    const errors: string[] = [...parseResult.errors];

    for (const ref of parseResult.references) {
      try {
        // Skip duplicates by DOI
        if (ref.doi && existingDOIs.has(ref.doi.toLowerCase())) {
          skipped.push(`"${ref.title}" - DOI already exists`);
          continue;
        }

        const citationKey = this.generateCitationKey(ref, existingKeys);
        existingKeys.add(citationKey);
        if (ref.doi) existingDOIs.add(ref.doi.toLowerCase());

        const created = await prisma.referenceLibrary.create({
          data: {
            userId,
            title: ref.title,
            authors: ref.authors,
            year: ref.year,
            venue: ref.venue,
            volume: ref.volume,
            issue: ref.issue,
            pages: ref.pages,
            doi: ref.doi,
            url: ref.url,
            isbn: ref.isbn,
            publisher: ref.publisher,
            edition: ref.edition,
            editors: ref.editors || [],
            publicationPlace: ref.publicationPlace,
            publicationDate: ref.publicationDate,
            accessedDate: ref.accessedDate,
            articleNumber: ref.articleNumber,
            issn: ref.issn,
            journalAbbreviation: ref.journalAbbreviation,
            pmid: ref.pmid,
            pmcid: ref.pmcid,
            arxivId: ref.arxivId,
            abstract: ref.abstract,
            sourceType: ref.sourceType,
            importSource: importSource || ref.importSource,
            citationKey,
            bibtex: ref.bibtex,
            externalId: ref.externalId,
            notes: ref.notes,
            tags: ref.tags || [],
          },
        });
        imported.push(created);
        if (Array.isArray(ref.attachmentHints) && ref.attachmentHints.length > 0) {
          attachmentHintsByReferenceId[created.id] = ref.attachmentHints.slice(0, 20);
        }
      } catch (err) {
        errors.push(`Failed to import "${ref.title}": ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return {
      success: errors.length === 0,
      imported: imported.length,
      skipped: skipped.length,
      references: imported,
      attachmentHintsByReferenceId,
      errors,
      warnings: [...parseResult.warnings, ...skipped],
      format: parseResult.format,
    };
  }

  async importFromDOI(userId: string, doi: string) {
    // Clean DOI - remove URL prefixes and normalize
    const cleanedDOI = this.cleanDOI(doi);
    if (!cleanedDOI) {
      throw new Error('Invalid DOI format. Please enter a valid DOI (e.g., 10.1038/nature12373)');
    }

    // Check if already exists
    const existing = await prisma.referenceLibrary.findFirst({
      where: { userId, isActive: true, doi: { equals: cleanedDOI, mode: 'insensitive' } },
    });
    if (existing) {
      throw new Error('Reference with this DOI already exists in your library');
    }

    // Fetch from CrossRef
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanedDOI)}`, {
      headers: { 'User-Agent': 'Research-Paper-Writing-App/1.0' },
    });

    if (!response.ok) {
      throw new Error('DOI not found. Please check the DOI and try again.');
    }

    const data = await response.json();
    const work = data.message;

    const authors = (work.author || []).map((a: any) =>
      `${a.given || ''} ${a.family || ''}`.trim()
    );

    return this.createReference({
      userId,
      title: work.title?.[0] || '',
      authors,
      year: work.issued?.['date-parts']?.[0]?.[0],
      venue: work['container-title']?.[0] || work.publisher,
      volume: work.volume,
      issue: work.issue,
      pages: work.page,
      doi: work.DOI,
      url: work.URL,
      editors: (work.editor || []).map((editor: any) => `${editor.given || ''} ${editor.family || ''}`.trim()).filter(Boolean),
      publicationPlace: work['publisher-location'],
      publicationDate: Array.isArray(work.issued?.['date-parts']?.[0])
        ? work.issued['date-parts'][0]
            .map((part: number, index: number) => index > 0 ? String(part).padStart(2, '0') : String(part))
            .join('-')
        : undefined,
      articleNumber: work['article-number'],
      issn: Array.isArray(work.ISSN) ? work.ISSN[0] : undefined,
      journalAbbreviation: Array.isArray(work['short-container-title']) ? work['short-container-title'][0] : undefined,
      abstract: work.abstract,
      sourceType: 'JOURNAL_ARTICLE',
      importSource: 'DOI_LOOKUP',
    });
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  async exportToBibTeX(userId: string, referenceIds?: string[]) {
    const where: any = { userId, isActive: true };
    if (referenceIds && referenceIds.length > 0) {
      where.id = { in: referenceIds };
    }

    const references = await prisma.referenceLibrary.findMany({ where });

    const parsed: ParsedReference[] = references.map(ref => ({
      title: ref.title,
      authors: ref.authors,
      year: ref.year || undefined,
      venue: ref.venue || undefined,
      volume: ref.volume || undefined,
      issue: ref.issue || undefined,
      pages: ref.pages || undefined,
      doi: ref.doi || undefined,
      url: ref.url || undefined,
      isbn: ref.isbn || undefined,
      publisher: ref.publisher || undefined,
      edition: ref.edition || undefined,
      editors: ref.editors || undefined,
      publicationPlace: ref.publicationPlace || undefined,
      publicationDate: ref.publicationDate || undefined,
      accessedDate: ref.accessedDate || undefined,
      articleNumber: ref.articleNumber || undefined,
      issn: ref.issn || undefined,
      journalAbbreviation: ref.journalAbbreviation || undefined,
      pmid: ref.pmid || undefined,
      pmcid: ref.pmcid || undefined,
      arxivId: ref.arxivId || undefined,
      abstract: ref.abstract || undefined,
      sourceType: ref.sourceType,
      importSource: ref.importSource,
      citationKey: ref.citationKey || undefined,
      bibtex: ref.bibtex || undefined,
      tags: ref.tags,
      notes: ref.notes || undefined,
    }));

    return exportToBibTeX(parsed);
  }

  // ============================================================================
  // COLLECTIONS
  // ============================================================================

  async createCollection(userId: string, name: string, description?: string, color?: string) {
    return prisma.referenceCollection.create({
      data: {
        userId,
        name,
        description,
        color,
      },
    });
  }

  async getCollections(userId: string) {
    const collections = await prisma.referenceCollection.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { items: true } },
      },
    });

    // Add total count as virtual "All References" collection
    const totalCount = await prisma.referenceLibrary.count({
      where: { userId, isActive: true },
    });

    return {
      collections: collections.map(c => ({
        ...c,
        referenceCount: c._count.items,
      })),
      totalReferences: totalCount,
    };
  }

  async updateCollection(userId: string, collectionId: string, data: { name?: string; description?: string; color?: string }) {
    return prisma.referenceCollection.update({
      where: { id: collectionId, userId },
      data,
    });
  }

  async deleteCollection(userId: string, collectionId: string) {
    return prisma.referenceCollection.delete({
      where: { id: collectionId, userId },
    });
  }

  async addToCollection(userId: string, collectionId: string, referenceIds: string[]) {
    // Verify ownership
    const collection = await prisma.referenceCollection.findFirst({
      where: { id: collectionId, userId },
    });
    if (!collection) throw new Error('Collection not found');

    const references = await prisma.referenceLibrary.findMany({
      where: { id: { in: referenceIds }, userId },
    });
    if (references.length !== referenceIds.length) {
      throw new Error('Some references not found');
    }

    // Create collection items (skip duplicates)
    const existing = await prisma.referenceCollectionItem.findMany({
      where: { collectionId, referenceId: { in: referenceIds } },
    });
    const existingRefIds = new Set(existing.map(e => e.referenceId));
    const newRefIds = referenceIds.filter(id => !existingRefIds.has(id));

    if (newRefIds.length > 0) {
      await prisma.referenceCollectionItem.createMany({
        data: newRefIds.map(referenceId => ({
          collectionId,
          referenceId,
        })),
      });
    }

    return { added: newRefIds.length, skipped: existingRefIds.size };
  }

  async removeFromCollection(userId: string, collectionId: string, referenceIds: string[]) {
    // Verify ownership
    const collection = await prisma.referenceCollection.findFirst({
      where: { id: collectionId, userId },
    });
    if (!collection) throw new Error('Collection not found');

    await prisma.referenceCollectionItem.deleteMany({
      where: { collectionId, referenceId: { in: referenceIds } },
    });

    return { removed: referenceIds.length };
  }

  // ============================================================================
  // COPY TO SESSION (Import from library to paper)
  // ============================================================================

  async copyToSession(userId: string, sessionId: string, referenceIds: string[]) {
    // Validate input
    if (!referenceIds || referenceIds.length === 0) {
      return { imported: 0, skipped: 0, citations: [] };
    }

    // Verify session ownership
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new Error('Session not found');

    const references = await prisma.referenceLibrary.findMany({
      where: { id: { in: referenceIds }, userId, isActive: true },
    });

    if (references.length === 0) {
      return { imported: 0, skipped: referenceIds.length, citations: [] };
    }

    const existingCitations = await prisma.citation.findMany({
      where: { sessionId },
      select: { doi: true, citationKey: true },
    });
    const existingDOIs = new Set(
      existingCitations
        .map(c => c.doi?.toLowerCase())
        .filter((doi): doi is string => Boolean(doi))
    );
    const existingKeys = new Set(
      existingCitations
        .map(c => c.citationKey)
        .filter((key): key is string => Boolean(key))
    );

    const created: any[] = [];
    const skipped: string[] = [];

    // Use transaction for batch creation
    await prisma.$transaction(async (tx) => {
      for (const ref of references) {
        // Skip if DOI already exists in session
        if (ref.doi && existingDOIs.has(ref.doi.toLowerCase())) {
          skipped.push(ref.title);
          continue;
        }

        const citationKey = this.generateUniqueCitationKey(ref, existingKeys);
        existingKeys.add(citationKey);

        const citation = await tx.citation.create({
          data: {
            sessionId,
            sourceType: ref.sourceType,
            title: ref.title,
            authors: ref.authors,
            year: ref.year,
            venue: ref.venue,
            volume: ref.volume,
            issue: ref.issue,
            pages: ref.pages,
            doi: ref.doi,
            url: ref.url,
            isbn: ref.isbn,
            publisher: ref.publisher,
            edition: ref.edition,
            editors: ref.editors,
            publicationPlace: ref.publicationPlace,
            publicationDate: ref.publicationDate,
            accessedDate: ref.accessedDate,
            articleNumber: ref.articleNumber,
            issn: ref.issn,
            journalAbbreviation: ref.journalAbbreviation,
            pmid: ref.pmid,
            pmcid: ref.pmcid,
            arxivId: ref.arxivId,
            abstract: ref.abstract,
            citationKey,
            bibtex: ref.bibtex,
            importSource: 'LIBRARY_IMPORT',
            notes: ref.notes,
            tags: ref.tags,
            libraryReferenceId: ref.id,
          },
        });
        created.push(citation);
      }
    });

    return { imported: created.length, skipped: skipped.length, citations: created };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private async getExistingCitationKeys(userId: string): Promise<Set<string>> {
    const refs = await prisma.referenceLibrary.findMany({
      where: { userId },
      select: { citationKey: true },
    });
    return new Set(refs.map(r => r.citationKey).filter(Boolean) as string[]);
  }

  private async getExistingDOIs(userId: string): Promise<Set<string>> {
    const refs = await prisma.referenceLibrary.findMany({
      where: { userId },
      select: { doi: true },
    });
    return new Set(refs.map(r => r.doi?.toLowerCase()).filter(Boolean) as string[]);
  }

  private generateCitationKey(ref: { title: string; authors: string[]; year?: number }, existingKeys: Set<string>): string {
    const firstAuthor = ref.authors[0]?.split(' ').pop() || 'Unknown';
    const year = ref.year || 'nd';
    let baseKey = `${firstAuthor}${year}`.replace(/[^a-zA-Z0-9]/g, '');
    
    let key = baseKey;
    let suffix = 'a'.charCodeAt(0);
    while (existingKeys.has(key)) {
      key = `${baseKey}${String.fromCharCode(suffix)}`;
      suffix++;
    }
    
    return key;
  }

  private generateUniqueCitationKey(ref: any, existingKeys: Set<string>): string {
    if (ref.citationKey && !existingKeys.has(ref.citationKey)) {
      return ref.citationKey;
    }
    return this.generateCitationKey(ref, existingKeys);
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  async getStats(userId: string) {
    const [total, byType, byYear, favorites, unread] = await Promise.all([
      prisma.referenceLibrary.count({ where: { userId, isActive: true } }),
      prisma.referenceLibrary.groupBy({
        by: ['sourceType'],
        where: { userId, isActive: true },
        _count: true,
      }),
      prisma.referenceLibrary.groupBy({
        by: ['year'],
        where: { userId, isActive: true, year: { not: null } },
        _count: true,
        orderBy: { year: 'desc' },
        take: 10,
      }),
      prisma.referenceLibrary.count({ where: { userId, isActive: true, isFavorite: true } }),
      prisma.referenceLibrary.count({ where: { userId, isActive: true, isRead: false } }),
    ]);

    return {
      total,
      favorites,
      unread,
      bySourceType: Object.fromEntries(byType.map(t => [t.sourceType, t._count])),
      byYear: byYear.map(y => ({ year: y.year, count: y._count })),
    };
  }

  // ============================================================================
  // ALL TAGS
  // ============================================================================

  async getAllTags(userId: string) {
    const refs = await prisma.referenceLibrary.findMany({
      where: { userId, isActive: true },
      select: { tags: true },
    });

    const tagCounts = new Map<string, number>();
    for (const ref of refs) {
      for (const tag of ref.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Clean and validate DOI format
   * Handles various input formats:
   * - https://doi.org/10.1038/nature12373
   * - http://dx.doi.org/10.1038/nature12373
   * - doi:10.1038/nature12373
   * - 10.1038/nature12373
   */
  private cleanDOI(doi: string): string | null {
    if (!doi || typeof doi !== 'string') return null;

    // Remove common prefixes
    let cleaned = doi.trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .trim();

    // Basic DOI validation - must start with 10. followed by registrant code
    if (/^10\.\d{4,9}\/[^\s]+$/i.test(cleaned)) {
      return cleaned;
    }

    return null;
  }
}

export const referenceLibraryService = new ReferenceLibraryService();

