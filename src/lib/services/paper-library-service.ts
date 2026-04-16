/**
 * Paper Library Service
 * Keeps paper-scoped citations synchronized into the user's account-level
 * reference library and groups them in an auto-created per-paper collection.
 */

import type { Citation, Prisma, ReferenceCollection, ReferenceLibrary } from '@prisma/client';
import { prisma } from '../prisma';
import { referenceLibraryService, type CreateReferenceInput } from './reference-library-service';

const PAPER_COLLECTION_MARKER_PREFIX = 'AUTO_PAPER_SESSION:';
const DEFAULT_COLLECTION_COLOR = '#2563EB';
const DEFAULT_COLLECTION_ICON = 'book-open';

type CitationSnapshot = Pick<
  Citation,
  | 'sourceType'
  | 'title'
  | 'authors'
  | 'year'
  | 'venue'
  | 'volume'
  | 'issue'
  | 'pages'
  | 'doi'
  | 'url'
  | 'isbn'
  | 'publisher'
  | 'edition'
  | 'editors'
  | 'publicationPlace'
  | 'publicationDate'
  | 'accessedDate'
  | 'articleNumber'
  | 'issn'
  | 'journalAbbreviation'
  | 'pmid'
  | 'pmcid'
  | 'arxivId'
  | 'abstract'
  | 'importSource'
  | 'notes'
  | 'tags'
> & {
  id?: string;
  libraryReferenceId?: string | null;
};

interface SyncResult {
  referenceId: string;
  collectionId: string;
}

class PaperLibraryService {
  async ensurePaperCollection(
    userId: string,
    sessionId: string,
    explicitTitle?: string | null
  ): Promise<ReferenceCollection> {
    const marker = this.getCollectionMarker(sessionId);
    const existing = await prisma.referenceCollection.findFirst({
      where: {
        userId,
        description: {
          contains: marker,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      return existing;
    }

    const title = explicitTitle?.trim() || await this.resolvePaperTitle(userId, sessionId);
    const baseName = this.buildCollectionName(title, sessionId);
    const description = `Auto-created collection for paper references (${marker}).`;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const suffix = attempt === 0 ? '' : ` (${attempt + 1})`;
      const name = `${baseName}${suffix}`;

      try {
        return await prisma.referenceCollection.create({
          data: {
            userId,
            name,
            description,
            color: DEFAULT_COLLECTION_COLOR,
            icon: DEFAULT_COLLECTION_ICON,
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    const fallback = await prisma.referenceCollection.findFirst({
      where: {
        userId,
        description: {
          contains: marker,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (fallback) {
      return fallback;
    }

    throw new Error('Unable to create paper reference collection');
  }

  async syncCitationToLibraryAndCollection(
    userId: string,
    sessionId: string,
    citation: CitationSnapshot
  ): Promise<SyncResult | null> {
    const normalizedTitle = (citation.title || '').trim();
    if (!normalizedTitle) {
      return null;
    }

    const reference = await this.upsertReferenceFromCitation(userId, citation);
    const collection = await this.ensurePaperCollection(userId, sessionId);

    await referenceLibraryService.addToCollection(userId, collection.id, [reference.id]);

    // Backfill libraryReferenceId on the citation if not already set
    if (citation.id && !citation.libraryReferenceId) {
      prisma.citation.update({
        where: { id: citation.id },
        data: { libraryReferenceId: reference.id },
      }).catch(() => {});
    }

    return {
      referenceId: reference.id,
      collectionId: collection.id,
    };
  }

  async syncCitationsToLibraryAndCollection(
    userId: string,
    sessionId: string,
    citations: CitationSnapshot[]
  ): Promise<SyncResult[]> {
    if (!Array.isArray(citations) || citations.length === 0) {
      return [];
    }

    const processed = new Set<string>();
    const results: SyncResult[] = [];

    for (const citation of citations) {
      const key = this.buildCitationIdentityKey(citation);
      if (processed.has(key)) {
        continue;
      }
      processed.add(key);

      const synced = await this.syncCitationToLibraryAndCollection(userId, sessionId, citation);
      if (synced) {
        results.push(synced);
      }
    }

    return results;
  }

  async addReferencesToPaperCollection(
    userId: string,
    sessionId: string,
    referenceIds: string[]
  ): Promise<{ collectionId: string; added: number; skipped: number } | null> {
    const normalizedIds = Array.from(
      new Set(
        (referenceIds || [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );

    if (normalizedIds.length === 0) {
      return null;
    }

    const collection = await this.ensurePaperCollection(userId, sessionId);
    const result = await referenceLibraryService.addToCollection(userId, collection.id, normalizedIds);

    return {
      collectionId: collection.id,
      added: result.added,
      skipped: result.skipped,
    };
  }

  async backfillPaperCollectionFromSessionCitations(
    userId: string,
    sessionId: string
  ): Promise<{ collectionId: string; synced: number; skipped: boolean }> {
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      throw new Error('Session not found');
    }

    const collection = await this.ensurePaperCollection(userId, sessionId);
    const existingCollectionCount = await prisma.referenceCollectionItem.count({
      where: { collectionId: collection.id },
    });

    // Repair legacy papers where the auto-created paper collection exists
    // but citations were added before collection sync was introduced.
    if (existingCollectionCount > 0) {
      return {
        collectionId: collection.id,
        synced: 0,
        skipped: true,
      };
    }

    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true,
      },
      select: {
        sourceType: true,
        title: true,
        authors: true,
        year: true,
        venue: true,
        volume: true,
        issue: true,
        pages: true,
        doi: true,
        url: true,
        isbn: true,
        publisher: true,
        edition: true,
        editors: true,
        publicationPlace: true,
        publicationDate: true,
        accessedDate: true,
        articleNumber: true,
        issn: true,
        journalAbbreviation: true,
        pmid: true,
        pmcid: true,
        arxivId: true,
        abstract: true,
        importSource: true,
        notes: true,
        tags: true,
      },
    });

    if (citations.length === 0) {
      return {
        collectionId: collection.id,
        synced: 0,
        skipped: true,
      };
    }

    const synced = await this.syncCitationsToLibraryAndCollection(userId, sessionId, citations);
    return {
      collectionId: collection.id,
      synced: synced.length,
      skipped: false,
    };
  }

  private async upsertReferenceFromCitation(
    userId: string,
    citation: CitationSnapshot
  ): Promise<ReferenceLibrary> {
    const existing = await this.findExistingReference(userId, citation);
    if (existing) {
      return this.enrichReferenceFromCitation(existing, citation);
    }

    try {
      return await referenceLibraryService.createReference(
        this.toCreateReferenceInput(userId, citation)
      ) as ReferenceLibrary;
    } catch (error: any) {
      const isDuplicate =
        error?.code === 'P2002'
        || (typeof error?.message === 'string' && error.message.toLowerCase().includes('already exists'));

      if (isDuplicate) {
        const fallback = await this.findExistingReference(userId, citation);
        if (fallback) {
          return fallback;
        }
      }

      throw error;
    }
  }

  private async findExistingReference(
    userId: string,
    citation: CitationSnapshot
  ): Promise<ReferenceLibrary | null> {
    const doi = this.normalizeDoi(citation.doi);
    if (doi) {
      const byDoi = await prisma.referenceLibrary.findFirst({
        where: {
          userId,
          isActive: true,
          doi: { equals: doi, mode: 'insensitive' },
        },
      });
      if (byDoi) {
        return byDoi;
      }
    }

    const title = (citation.title || '').trim();
    if (!title) {
      return null;
    }

    const firstAuthor = (citation.authors?.[0] || '').trim();
    const baseWhere: Prisma.ReferenceLibraryWhereInput = {
      userId,
      isActive: true,
      title: {
        equals: title,
        mode: 'insensitive',
      },
      year: citation.year ?? undefined,
    };

    if (firstAuthor) {
      const byTitleAuthor = await prisma.referenceLibrary.findFirst({
        where: {
          ...baseWhere,
          authors: {
            has: firstAuthor,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (byTitleAuthor) {
        return byTitleAuthor;
      }
    }

    return prisma.referenceLibrary.findFirst({
      where: baseWhere,
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async enrichReferenceFromCitation(
    reference: ReferenceLibrary,
    citation: CitationSnapshot
  ): Promise<ReferenceLibrary> {
    const data: Prisma.ReferenceLibraryUpdateInput = {};

    const maybeSet = (field: keyof Prisma.ReferenceLibraryUpdateInput, value: unknown) => {
      if (value === null || value === undefined) return;
      if (typeof value === 'string' && !value.trim()) return;
      (data as any)[field] = value;
    };

    if (!reference.doi) maybeSet('doi', this.normalizeDoi(citation.doi));
    if (!reference.url) maybeSet('url', citation.url);
    if (!reference.abstract) maybeSet('abstract', citation.abstract);
    if (!reference.venue) maybeSet('venue', citation.venue);
    if (!reference.volume) maybeSet('volume', citation.volume);
    if (!reference.issue) maybeSet('issue', citation.issue);
    if (!reference.pages) maybeSet('pages', citation.pages);
    if (!reference.isbn) maybeSet('isbn', citation.isbn);
    if (!reference.publisher) maybeSet('publisher', citation.publisher);
    if (!reference.edition) maybeSet('edition', citation.edition);
    if (!reference.publicationPlace) maybeSet('publicationPlace', citation.publicationPlace);
    if (!reference.publicationDate) maybeSet('publicationDate', citation.publicationDate);
    if (!reference.accessedDate) maybeSet('accessedDate', citation.accessedDate);
    if (!reference.articleNumber) maybeSet('articleNumber', citation.articleNumber);
    if (!reference.issn) maybeSet('issn', citation.issn);
    if (!reference.journalAbbreviation) maybeSet('journalAbbreviation', citation.journalAbbreviation);
    if (!reference.pmid) maybeSet('pmid', citation.pmid);
    if (!reference.pmcid) maybeSet('pmcid', citation.pmcid);
    if (!reference.arxivId) maybeSet('arxivId', citation.arxivId);
    if (!reference.notes) maybeSet('notes', citation.notes);

    if ((!reference.year || reference.year <= 0) && citation.year) {
      maybeSet('year', citation.year);
    }
    if ((!reference.authors || reference.authors.length === 0) && citation.authors?.length) {
      maybeSet('authors', citation.authors);
    }
    if ((!reference.editors || reference.editors.length === 0) && citation.editors?.length) {
      maybeSet('editors', citation.editors);
    }
    if ((!reference.tags || reference.tags.length === 0) && citation.tags?.length) {
      maybeSet('tags', citation.tags);
    }
    if (reference.sourceType === 'OTHER' && citation.sourceType && citation.sourceType !== 'OTHER') {
      maybeSet('sourceType', citation.sourceType);
    }
    if (reference.importSource === 'MANUAL' && citation.importSource && citation.importSource !== 'MANUAL') {
      maybeSet('importSource', citation.importSource);
    }

    if (Object.keys(data).length === 0) {
      return reference;
    }

    return prisma.referenceLibrary.update({
      where: { id: reference.id },
      data,
    });
  }

  private toCreateReferenceInput(userId: string, citation: CitationSnapshot): CreateReferenceInput {
    return {
      userId,
      sourceType: citation.sourceType,
      title: citation.title,
      authors: citation.authors?.length ? citation.authors : ['Unknown'],
      year: citation.year ?? undefined,
      venue: citation.venue ?? undefined,
      volume: citation.volume ?? undefined,
      issue: citation.issue ?? undefined,
      pages: citation.pages ?? undefined,
      doi: this.normalizeDoi(citation.doi),
      url: citation.url ?? undefined,
      isbn: citation.isbn ?? undefined,
      publisher: citation.publisher ?? undefined,
      edition: citation.edition ?? undefined,
      editors: citation.editors?.length ? citation.editors : undefined,
      publicationPlace: citation.publicationPlace ?? undefined,
      publicationDate: citation.publicationDate ?? undefined,
      accessedDate: citation.accessedDate ?? undefined,
      articleNumber: citation.articleNumber ?? undefined,
      issn: citation.issn ?? undefined,
      journalAbbreviation: citation.journalAbbreviation ?? undefined,
      pmid: citation.pmid ?? undefined,
      pmcid: citation.pmcid ?? undefined,
      arxivId: citation.arxivId ?? undefined,
      abstract: citation.abstract ?? undefined,
      importSource: citation.importSource,
      notes: citation.notes ?? undefined,
      tags: citation.tags ?? [],
    };
  }

  private normalizeDoi(value?: string | null): string | undefined {
    if (!value || typeof value !== 'string') {
      return undefined;
    }

    const cleaned = value
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .trim();

    if (!cleaned) {
      return undefined;
    }

    return cleaned;
  }

  private getCollectionMarker(sessionId: string): string {
    return `${PAPER_COLLECTION_MARKER_PREFIX}${sessionId}`;
  }

  private buildCollectionName(title: string, sessionId: string): string {
    const safeTitle = (title || 'Untitled Paper').replace(/\s+/g, ' ').trim();
    const clipped = safeTitle.slice(0, 72);
    const suffix = sessionId.slice(-6);
    return `Paper: ${clipped} [${suffix}]`;
  }

  private async resolvePaperTitle(userId: string, sessionId: string): Promise<string> {
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        userId,
      },
      select: {
        researchTopic: {
          select: {
            title: true,
          },
        },
      },
    });

    return session?.researchTopic?.title?.trim() || 'Untitled Paper';
  }

  private buildCitationIdentityKey(citation: CitationSnapshot): string {
    const doi = this.normalizeDoi(citation.doi);
    if (doi) {
      return `doi:${doi.toLowerCase()}`;
    }

    const title = (citation.title || '').trim().toLowerCase();
    const year = citation.year ?? 'na';
    const firstAuthor = (citation.authors?.[0] || '').trim().toLowerCase() || 'na';
    return `title:${title}|year:${year}|author:${firstAuthor}`;
  }
}

export const paperLibraryService = new PaperLibraryService();
