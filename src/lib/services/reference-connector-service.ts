import { CitationImportSource, CitationSourceType } from '@prisma/client';
import { prisma } from '../prisma';
import { referenceLibraryService } from './reference-library-service';

interface ImportResultSummary {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  referenceIds: string[];
}

export interface ImportFromMendeleyOptions {
  accessToken: string;
  limit?: number;
}

export interface ImportFromZoteroOptions {
  apiKey: string;
  userId?: string;
  groupId?: string;
  limit?: number;
}

type NormalizedExternalReference = {
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
  publicationPlace?: string;
  publicationDate?: string;
  articleNumber?: string;
  issn?: string;
  journalAbbreviation?: string;
  pmid?: string;
  pmcid?: string;
  arxivId?: string;
  abstract?: string;
  sourceType: CitationSourceType;
  importSource: CitationImportSource;
  externalId?: string;
  tags?: string[];
  notes?: string;
  pdfUrl?: string;
};

function toIntYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1000 && value < 3000) {
    return value;
  }
  if (typeof value !== 'string') return undefined;
  const match = value.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : undefined;
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mapMendeleyType(type: string | undefined): CitationSourceType {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'journal' || normalized === 'journal_article' || normalized === 'article') return 'JOURNAL_ARTICLE';
  if (normalized === 'conference_proceedings' || normalized === 'conference') return 'CONFERENCE_PAPER';
  if (normalized === 'book') return 'BOOK';
  if (normalized === 'book_section') return 'BOOK_CHAPTER';
  if (normalized === 'thesis') return 'THESIS';
  if (normalized === 'report') return 'REPORT';
  if (normalized === 'web_page' || normalized === 'webpage') return 'WEBSITE';
  if (normalized === 'patent') return 'PATENT';
  if (normalized === 'working_paper') return 'WORKING_PAPER';
  return 'OTHER';
}

function mapZoteroType(type: string | undefined): CitationSourceType {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'journalarticle') return 'JOURNAL_ARTICLE';
  if (normalized === 'conferencepaper') return 'CONFERENCE_PAPER';
  if (normalized === 'book') return 'BOOK';
  if (normalized === 'booksection') return 'BOOK_CHAPTER';
  if (normalized === 'thesis') return 'THESIS';
  if (normalized === 'report') return 'REPORT';
  if (normalized === 'webpage') return 'WEBSITE';
  if (normalized === 'patent') return 'PATENT';
  return 'OTHER';
}

class ReferenceConnectorService {
  async importFromMendeley(userId: string, options: ImportFromMendeleyOptions): Promise<ImportResultSummary> {
    const accessToken = trimString(options.accessToken);
    if (!accessToken) {
      throw new Error('Mendeley access token is required');
    }

    const pageSize = Math.min(Math.max(options.limit || 200, 1), 500);
    const allDocuments: any[] = [];
    let nextUrl: string | null = `https://api.mendeley.com/documents?view=all&limit=${pageSize}`;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.mendeley-document.1+json',
        },
      });

      if (!response.ok) {
        if (allDocuments.length > 0) break; // partial success on later pages
        throw new Error(`Mendeley import failed (${response.status})`);
      }

      const payload = await response.json();
      if (Array.isArray(payload)) {
        allDocuments.push(...payload);
      }

      // Mendeley uses Link header with rel="next" for pagination
      nextUrl = this.parseLinkNext(response.headers.get('link'));
    }

    return this.persistNormalizedReferences(
      userId,
      allDocuments.map((doc: any) => this.normalizeMendeleyDocument(doc))
    );
  }

  async importFromZotero(userId: string, options: ImportFromZoteroOptions): Promise<ImportResultSummary> {
    const apiKey = trimString(options.apiKey);
    if (!apiKey) {
      throw new Error('Zotero API key is required');
    }

    const userLibraryId = trimString(options.userId);
    const groupLibraryId = trimString(options.groupId);
    if (!userLibraryId && !groupLibraryId) {
      throw new Error('Provide either Zotero userId or groupId');
    }

    const pageSize = Math.min(Math.max(options.limit || 100, 1), 100); // Zotero max per page is 100
    const base = userLibraryId
      ? `https://api.zotero.org/users/${encodeURIComponent(userLibraryId)}`
      : `https://api.zotero.org/groups/${encodeURIComponent(groupLibraryId as string)}`;

    const allItems: any[] = [];
    let start = 0;
    let totalResults = Infinity;

    while (start < totalResults) {
      const response = await fetch(
        `${base}/items?format=json&include=data&itemType=-attachment&limit=${pageSize}&start=${start}&sort=dateAdded&direction=desc`,
        {
          headers: {
            'Zotero-API-Key': apiKey,
            'Zotero-API-Version': '3',
          },
        }
      );

      if (!response.ok) {
        if (allItems.length > 0) break; // partial success on later pages
        throw new Error(`Zotero import failed (${response.status})`);
      }

      // Zotero returns Total-Results header with the total count
      const totalHeader = response.headers.get('Total-Results');
      if (totalHeader) {
        totalResults = parseInt(totalHeader, 10) || Infinity;
      }

      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : [];
      if (items.length === 0) break;

      allItems.push(...items);
      start += items.length;
    }

    return this.persistNormalizedReferences(
      userId,
      allItems.map((item: any) => this.normalizeZoteroItem(item))
    );
  }

  async searchMendeleyCatalogByPdfSignal(input: {
    accessToken: string;
    doi?: string | null;
    title?: string | null;
  }): Promise<NormalizedExternalReference | null> {
    const accessToken = trimString(input.accessToken);
    if (!accessToken) return null;

    const doi = trimString(input.doi || '');
    const title = trimString(input.title || '');
    if (!doi && !title) return null;

    const attempts: string[] = [];
    if (doi) {
      attempts.push(`https://api.mendeley.com/search/catalog?doi=${encodeURIComponent(doi)}&limit=1&view=all`);
    }
    if (title) {
      attempts.push(`https://api.mendeley.com/search/catalog?query=${encodeURIComponent(title)}&limit=1&view=all`);
    }

    for (const url of attempts) {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.mendeley-document.1+json',
          },
        });
        if (!response.ok) continue;
        const payload = await response.json();
        const doc = Array.isArray(payload) ? payload[0] : null;
        if (doc) {
          return this.normalizeMendeleyDocument(doc);
        }
      } catch {
        // Ignore provider outages and continue with local matching.
      }
    }

    return null;
  }

  async searchZoteroLibraryByPdfSignal(input: {
    apiKey: string;
    userId?: string;
    groupId?: string;
    doi?: string | null;
    title?: string | null;
  }): Promise<NormalizedExternalReference | null> {
    const apiKey = trimString(input.apiKey);
    const userId = trimString(input.userId);
    const groupId = trimString(input.groupId);
    if (!apiKey || (!userId && !groupId)) {
      return null;
    }

    const queries = [trimString(input.doi || ''), trimString(input.title || '')].filter(Boolean) as string[];
    if (queries.length === 0) return null;

    const base = userId
      ? `https://api.zotero.org/users/${encodeURIComponent(userId)}`
      : `https://api.zotero.org/groups/${encodeURIComponent(groupId as string)}`;

    for (const query of queries) {
      try {
        const response = await fetch(
          `${base}/items?format=json&include=data&itemType=-attachment&q=${encodeURIComponent(query)}&qmode=titleCreatorYear&limit=1`,
          {
            headers: {
              'Zotero-API-Key': apiKey,
              'Zotero-API-Version': '3',
            },
          }
        );
        if (!response.ok) continue;
        const payload = await response.json();
        const item = Array.isArray(payload) ? payload[0] : null;
        if (item) {
          return this.normalizeZoteroItem(item);
        }
      } catch {
        // Ignore provider outages and continue with local matching.
      }
    }

    return null;
  }

  private async persistNormalizedReferences(
    userId: string,
    normalizedReferences: Array<NormalizedExternalReference | null>
  ): Promise<ImportResultSummary> {
    const importedIds: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    let skipped = 0;
    let updated = 0;

    for (const normalized of normalizedReferences) {
      if (!normalized || !normalized.title) {
        skipped += 1;
        continue;
      }

      try {
        // Check for existing reference by externalId + importSource (provider-level dedup)
        if (normalized.externalId) {
          const existing = await prisma.referenceLibrary.findFirst({
            where: {
              userId,
              externalId: normalized.externalId,
              importSource: normalized.importSource,
              isActive: true,
            },
            select: { id: true },
          });

          if (existing) {
            await prisma.referenceLibrary.update({
              where: { id: existing.id },
              data: {
                title: normalized.title,
                authors: normalized.authors,
                year: normalized.year,
                venue: normalized.venue,
                volume: normalized.volume,
                issue: normalized.issue,
                pages: normalized.pages,
                doi: normalized.doi,
                url: normalized.url,
                isbn: normalized.isbn,
                publisher: normalized.publisher,
                edition: normalized.edition,
                publicationPlace: normalized.publicationPlace,
                publicationDate: normalized.publicationDate,
                articleNumber: normalized.articleNumber,
                issn: normalized.issn,
                journalAbbreviation: normalized.journalAbbreviation,
                pmid: normalized.pmid,
                pmcid: normalized.pmcid,
                arxivId: normalized.arxivId,
                abstract: normalized.abstract,
                sourceType: normalized.sourceType,
                notes: normalized.notes,
                tags: normalized.tags || [],
                pdfUrl: normalized.pdfUrl,
              },
            });
            updated += 1;
            importedIds.push(existing.id);
            continue;
          }
        }

        const created = await referenceLibraryService.createReference({
          userId,
          title: normalized.title,
          authors: normalized.authors,
          year: normalized.year,
          venue: normalized.venue,
          volume: normalized.volume,
          issue: normalized.issue,
          pages: normalized.pages,
          doi: normalized.doi,
          url: normalized.url,
          isbn: normalized.isbn,
          publisher: normalized.publisher,
          edition: normalized.edition,
          publicationPlace: normalized.publicationPlace,
          publicationDate: normalized.publicationDate,
          articleNumber: normalized.articleNumber,
          issn: normalized.issn,
          journalAbbreviation: normalized.journalAbbreviation,
          pmid: normalized.pmid,
          pmcid: normalized.pmcid,
          arxivId: normalized.arxivId,
          abstract: normalized.abstract,
          sourceType: normalized.sourceType,
          importSource: normalized.importSource,
          externalId: normalized.externalId,
          notes: normalized.notes,
          tags: normalized.tags || [],
          pdfUrl: normalized.pdfUrl,
        });
        importedIds.push(created.id);
      } catch (error: any) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('already exists')) {
          skipped += 1;
          continue;
        }
        errors.push(error instanceof Error ? error.message : 'Unknown import error');
      }
    }

    return {
      imported: importedIds.length - updated,
      updated,
      skipped,
      errors,
      warnings,
      referenceIds: importedIds,
    };
  }

  private normalizeMendeleyDocument(doc: any): NormalizedExternalReference | null {
    const title = trimString(doc?.title);
    if (!title) return null;

    const authors = Array.isArray(doc?.authors)
      ? doc.authors
          .map((author: any) => trimString(`${author?.first_name || ''} ${author?.last_name || ''}`))
          .filter(Boolean) as string[]
      : [];

    const identifiers = doc?.identifiers || {};
    const keywords = Array.isArray(doc?.keywords) ? doc.keywords.map((k: any) => trimString(k)).filter(Boolean) : [];
    const files = Array.isArray(doc?.files) ? doc.files : [];
    const firstFile = files[0] || null;

    return {
      title,
      authors,
      year: toIntYear(doc?.year),
      venue: trimString(doc?.source),
      volume: trimString(doc?.volume),
      issue: trimString(doc?.issue),
      pages: trimString(doc?.pages),
      doi: trimString(identifiers?.doi || doc?.doi),
      url: trimString(doc?.webpage || doc?.url),
      isbn: trimString(identifiers?.isbn),
      issn: trimString(identifiers?.issn),
      pmid: trimString(identifiers?.pmid),
      pmcid: trimString(identifiers?.pmcid),
      arxivId: trimString(identifiers?.arxiv),
      publisher: trimString(doc?.publisher),
      publicationDate: trimString(doc?.month),
      sourceType: mapMendeleyType(doc?.type),
      importSource: 'MENDELEY_IMPORT',
      externalId: trimString(doc?.id),
      tags: keywords as string[],
      abstract: trimString(doc?.abstract),
      notes: trimString(doc?.notes),
      pdfUrl: trimString(firstFile?.download_url || firstFile?.url),
    };
  }

  private normalizeZoteroItem(item: any): NormalizedExternalReference | null {
    const data = item?.data || item;
    const title = trimString(data?.title);
    if (!title) return null;

    const creators = Array.isArray(data?.creators) ? data.creators : [];
    const authors = creators
      .filter((creator: any) => {
        const type = String(creator?.creatorType || '').toLowerCase();
        return type === 'author' || type === 'editor';
      })
      .map((creator: any) => {
        // Zotero uses firstName/lastName (camelCase), not first_name/last_name
        if (creator?.name) return trimString(creator.name);
        const first = String(creator?.firstName || '').trim();
        const last = String(creator?.lastName || '').trim();
        if (last && first) return `${first} ${last}`;
        return trimString(last || first);
      })
      .filter(Boolean) as string[];

    const tags = Array.isArray(data?.tags)
      ? data.tags.map((tag: any) => trimString(tag?.tag || tag)).filter(Boolean) as string[]
      : [];

    // Zotero stores PMID/PMCID/arXiv in the "extra" field as key-value lines
    const extra = String(data?.extra || '');
    const pmid = trimString(data?.pmid) || this.extractExtraField(extra, 'PMID');
    const pmcid = trimString(data?.pmcid) || this.extractExtraField(extra, 'PMCID');
    const arxivId = trimString(data?.arxivId) || this.extractExtraField(extra, 'arXiv');

    return {
      title,
      authors,
      year: toIntYear(data?.date),
      venue: trimString(data?.publicationTitle || data?.proceedingsTitle || data?.bookTitle),
      volume: trimString(data?.volume),
      issue: trimString(data?.issue),
      pages: trimString(data?.pages),
      doi: trimString(data?.DOI),
      url: trimString(data?.url),
      isbn: trimString(data?.ISBN),
      issn: trimString(data?.ISSN),
      publisher: trimString(data?.publisher),
      edition: trimString(data?.edition),
      publicationPlace: trimString(data?.place),
      publicationDate: trimString(data?.date),
      pmid,
      pmcid,
      arxivId,
      sourceType: mapZoteroType(data?.itemType),
      importSource: 'ZOTERO_IMPORT',
      externalId: trimString(item?.key || data?.key),
      tags,
      abstract: trimString(data?.abstractNote),
      notes: extra || undefined,
      pdfUrl: undefined,
    };
  }

  /** Parse Mendeley `Link` header to extract the `rel="next"` URL */
  private parseLinkNext(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const parts = linkHeader.split(',');
    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="next"/);
      if (match) return match[1];
    }
    return null;
  }

  /** Extract a field value from Zotero's extra field (e.g. "PMID: 12345678") */
  private extractExtraField(extra: string, key: string): string | undefined {
    const regex = new RegExp(`^${key}:\\s*(.+)$`, 'im');
    const match = extra.match(regex);
    return match ? trimString(match[1]) : undefined;
  }
}

export const referenceConnectorService = new ReferenceConnectorService();
