import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { prisma } from '../prisma';
import { referenceDocumentService } from './reference-document-service';
import { referenceLibraryService } from './reference-library-service';
import type { SearchResult } from './literature-search-service';
import { sanitizeTextForPostgres } from '../utils/postgres-sanitize';

export type PaperAcquisitionOutcomeCode =
  | 'ALREADY_ATTACHED'
  | 'REUSED_BY_DOI'
  | 'DOWNLOADED'
  | 'TEXT_PASTED'
  | 'NOT_PDF'
  | 'NO_PDF_URL'
  | 'DOWNLOAD_FAILED'
  | 'REFERENCE_NOT_FOUND'
  | 'INTERNAL_ERROR';

export type PaperAcquisitionErrorCode =
  | 'REFERENCE_NOT_FOUND'
  | 'ALREADY_ATTACHED'
  | 'INVALID_URL'
  | 'NOT_PDF'
  | 'DOWNLOAD_FAILED'
  | 'INVALID_TEXT'
  | 'INTERNAL_ERROR';

export interface PaperAcquisitionItemInput {
  searchRunId: string;
  paperId: string;
  result: SearchResult & Record<string, any>;
  isRelevant?: boolean;
  deepAnalysisRecommendation?: string;
}

export interface PaperAcquisitionItemResult {
  searchRunId: string;
  paperId: string;
  title?: string;
  doi?: string;
  success: boolean;
  outcome: PaperAcquisitionOutcomeCode;
  message?: string;
  referenceId?: string;
  documentId?: string;
  pdfStatus?: 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE';
  documentSourceType?: 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE';
  source?: 'database' | 'pdf_url' | 'existing';
  attemptedPdfUrl?: string;
}

export interface AcquireFromUserUrlResult {
  success: boolean;
  referenceId: string;
  documentId?: string;
  pdfStatus?: 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE';
  documentSourceType?: 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE';
  errorCode?: PaperAcquisitionErrorCode;
  error?: string;
}

export interface StoreFullTextPasteResult {
  success: boolean;
  referenceId: string;
  documentId?: string;
  characterCount?: number;
  documentSourceType?: 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE';
  errorCode?: PaperAcquisitionErrorCode;
  error?: string;
}

export interface ReferenceFullTextResult {
  success: boolean;
  referenceId: string;
  documentId?: string;
  status?: 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE';
  sourceType?: 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE';
  text?: string;
  pageCount?: number | null;
  error?: string;
}

export interface PaperAcquisitionBatchResult {
  total: number;
  attempted: number;
  succeeded: number;
  reused: number;
  downloaded: number;
  alreadyAttached: number;
  failed: number;
  results: PaperAcquisitionItemResult[];
}

class PaperAcquisitionService {
  private readonly MAX_CONCURRENT = Math.max(1, parseInt(process.env.PAPER_ACQUISITION_CONCURRENCY || '3', 10) || 3);
  private readonly uploadsBasePath = path.resolve(process.cwd(), process.env.REFERENCE_UPLOADS_PATH || 'uploads/references');

  async acquireSingle(userId: string, input: PaperAcquisitionItemInput): Promise<PaperAcquisitionItemResult> {
    const result = input.result || {};
    const doi = this.normalizeDoi(result.doi);
    const title = typeof result.title === 'string' ? result.title : undefined;
    const directPdfUrl = this.extractDirectPdfUrl(result);
    const pdfUrlCandidates = this.extractPdfUrlCandidates(result, doi);
    const firstAttemptedUrl = pdfUrlCandidates[0] || undefined;

    try {
      const reference = await this.ensureReferenceForResult(userId, result);
      if (!reference) {
        return {
          searchRunId: input.searchRunId,
          paperId: input.paperId,
          title,
          doi: doi || undefined,
          success: false,
          outcome: 'REFERENCE_NOT_FOUND',
          message: 'Could not create or resolve reference record',
          attemptedPdfUrl: firstAttemptedUrl,
        };
      }

      const existingPrimary = await prisma.referenceDocumentLink.findFirst({
        where: { referenceId: reference.id, isPrimary: true },
        include: { document: true },
      });
      if (existingPrimary?.document) {
        return {
          searchRunId: input.searchRunId,
          paperId: input.paperId,
          title,
          doi: doi || undefined,
          success: true,
          outcome: 'ALREADY_ATTACHED',
          referenceId: reference.id,
          documentId: existingPrimary.document.id,
          pdfStatus: this.normalizePdfStatus(existingPrimary.document.status),
          documentSourceType: this.normalizeDocumentSourceType(existingPrimary.document.sourceType, {
            sourceIdentifier: (existingPrimary.document as any).sourceIdentifier,
            mimeType: (existingPrimary.document as any).mimeType,
          }),
          source: 'existing',
          attemptedPdfUrl: firstAttemptedUrl,
        };
      }

      if (doi) {
        const existingDoc = await this.findExistingDocumentByDoi(doi);
        if (existingDoc) {
          await this.attachDocumentToReference(userId, reference.id, existingDoc.id);
          await this.setReferencePdfUrl(reference.id, directPdfUrl);
          return {
            searchRunId: input.searchRunId,
            paperId: input.paperId,
            title,
            doi,
            success: true,
            outcome: 'REUSED_BY_DOI',
            referenceId: reference.id,
            documentId: existingDoc.id,
            pdfStatus: this.normalizePdfStatus(existingDoc.status),
            documentSourceType: this.normalizeDocumentSourceType(existingDoc.sourceType, {
              sourceIdentifier: existingDoc.sourceIdentifier,
              mimeType: existingDoc.mimeType,
            }),
            source: 'database',
            attemptedPdfUrl: firstAttemptedUrl,
          };
        }
      }

      if (pdfUrlCandidates.length === 0) {
        return {
          searchRunId: input.searchRunId,
          paperId: input.paperId,
          title,
          doi: doi || undefined,
          success: false,
          outcome: 'NO_PDF_URL',
          referenceId: reference.id,
          message: 'No candidate URL available to discover a PDF',
        };
      }

      let sawNotPdf = false;
      let sawDownloadFailure = false;
      let lastError = '';
      let lastAttemptedUrl = '';

      for (const candidateUrl of pdfUrlCandidates) {
        const importResult = await referenceDocumentService.importPdfFromUrl(
          userId,
          reference.id,
          candidateUrl,
          {
            sourceIdentifier: doi || candidateUrl,
            sourceType: doi ? 'DOI_FETCH' : 'URL_IMPORT',
            originalFilenameHint: doi || title || input.paperId,
          }
        );

        if (importResult.success && importResult.document) {
          const resolvedPdfUrl = importResult.oaUrl || candidateUrl;
          await this.setReferencePdfUrl(reference.id, resolvedPdfUrl);

          return {
            searchRunId: input.searchRunId,
            paperId: input.paperId,
            title,
            doi: doi || undefined,
            success: true,
            outcome: 'DOWNLOADED',
            referenceId: reference.id,
            documentId: importResult.document.id,
            pdfStatus: this.normalizePdfStatus(importResult.document.status),
            documentSourceType: this.normalizeDocumentSourceType(importResult.document.sourceType, {
              sourceIdentifier: (importResult.document as any).sourceIdentifier,
              mimeType: (importResult.document as any).mimeType,
            }),
            source: 'pdf_url',
            attemptedPdfUrl: candidateUrl,
          };
        }

        lastAttemptedUrl = candidateUrl;
        lastError = importResult.error || 'Failed to retrieve PDF from URL';
        if (importResult.errorCode === 'NOT_PDF') {
          sawNotPdf = true;
        } else {
          sawDownloadFailure = true;
        }
      }

      const outcome: PaperAcquisitionOutcomeCode = sawDownloadFailure
        ? 'DOWNLOAD_FAILED'
        : sawNotPdf
          ? 'NOT_PDF'
          : 'DOWNLOAD_FAILED';
      const summary = `Failed to retrieve PDF after trying ${pdfUrlCandidates.length} link(s).`;

      return {
        searchRunId: input.searchRunId,
        paperId: input.paperId,
        title,
        doi: doi || undefined,
        success: false,
        outcome,
        referenceId: reference.id,
        message: lastError ? `${summary} Last error: ${lastError}` : summary,
        attemptedPdfUrl: lastAttemptedUrl || firstAttemptedUrl,
      };
    } catch (error: any) {
      return {
        searchRunId: input.searchRunId,
        paperId: input.paperId,
        title,
        doi: doi || undefined,
        success: false,
        outcome: 'INTERNAL_ERROR',
        message: error?.message || 'Unexpected acquisition error',
        attemptedPdfUrl: firstAttemptedUrl,
      };
    }
  }

  async acquireBatch(userId: string, inputs: PaperAcquisitionItemInput[]): Promise<PaperAcquisitionBatchResult> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return {
        total: 0,
        attempted: 0,
        succeeded: 0,
        reused: 0,
        downloaded: 0,
        alreadyAttached: 0,
        failed: 0,
        results: [],
      };
    }

    const results: PaperAcquisitionItemResult[] = new Array(inputs.length);
    let cursor = 0;
    const workerCount = Math.min(this.MAX_CONCURRENT, inputs.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= inputs.length) break;
        results[index] = await this.acquireSingle(userId, inputs[index]);
      }
    });

    await Promise.all(workers);

    const succeeded = results.filter(item => item.success).length;
    const reused = results.filter(item => item.outcome === 'REUSED_BY_DOI').length;
    const downloaded = results.filter(item => item.outcome === 'DOWNLOADED').length;
    const alreadyAttached = results.filter(item => item.outcome === 'ALREADY_ATTACHED').length;
    const failed = results.filter(item => !item.success).length;

    return {
      total: inputs.length,
      attempted: inputs.length,
      succeeded,
      reused,
      downloaded,
      alreadyAttached,
      failed,
      results,
    };
  }

  async acquireFromUserUrl(
    userId: string,
    referenceId: string,
    url: string
  ): Promise<AcquireFromUserUrlResult> {
    const reference = await prisma.referenceLibrary.findFirst({
      where: { id: referenceId, userId, isActive: true },
      select: { id: true },
    });
    if (!reference) {
      return {
        success: false,
        referenceId,
        errorCode: 'REFERENCE_NOT_FOUND',
        error: 'Reference not found',
      };
    }

    const existingPrimary = await prisma.referenceDocumentLink.findFirst({
      where: { referenceId, isPrimary: true },
      include: {
        document: {
          select: { id: true, status: true, sourceType: true, sourceIdentifier: true, mimeType: true },
        },
      },
    });
    if (existingPrimary?.document) {
      return {
        success: false,
        referenceId,
        documentId: existingPrimary.document.id,
        pdfStatus: this.normalizePdfStatus(existingPrimary.document.status),
        documentSourceType: this.normalizeDocumentSourceType(existingPrimary.document.sourceType, {
          sourceIdentifier: existingPrimary.document.sourceIdentifier,
          mimeType: existingPrimary.document.mimeType,
        }),
        errorCode: 'ALREADY_ATTACHED',
        error: 'Reference already has a PDF attached',
      };
    }

    const validatedUrl = referenceDocumentService.validatePdfImportUrl(url);
    if (!validatedUrl) {
      return {
        success: false,
        referenceId,
        errorCode: 'INVALID_URL',
        error: 'Invalid or unsafe PDF URL',
      };
    }

    const importResult = await referenceDocumentService.importPdfFromUrl(
      userId,
      referenceId,
      validatedUrl,
      {
        sourceIdentifier: validatedUrl,
        sourceType: 'URL_IMPORT',
      }
    );

    if (!importResult.success || !importResult.document) {
      const errorCode = importResult.errorCode === 'NOT_PDF'
        ? 'NOT_PDF'
        : importResult.errorCode === 'INVALID_URL'
          ? 'INVALID_URL'
          : 'DOWNLOAD_FAILED';

      return {
        success: false,
        referenceId,
        errorCode,
        error: importResult.error || 'Failed to import PDF from URL',
      };
    }

    await this.setReferencePdfUrl(referenceId, validatedUrl);

    return {
      success: true,
      referenceId,
      documentId: importResult.document.id,
      pdfStatus: this.normalizePdfStatus(importResult.document.status),
      documentSourceType: this.normalizeDocumentSourceType(importResult.document.sourceType, {
        sourceIdentifier: (importResult.document as any).sourceIdentifier,
        mimeType: (importResult.document as any).mimeType,
      }),
    };
  }

  async storeFullTextPaste(
    userId: string,
    referenceId: string,
    text: string,
    format: 'plain' | 'html' = 'plain'
  ): Promise<StoreFullTextPasteResult> {
    const reference = await prisma.referenceLibrary.findFirst({
      where: { id: referenceId, userId, isActive: true },
      select: { id: true },
    });
    if (!reference) {
      return {
        success: false,
        referenceId,
        errorCode: 'REFERENCE_NOT_FOUND',
        error: 'Reference not found',
      };
    }

    const existingPrimary = await prisma.referenceDocumentLink.findFirst({
      where: { referenceId, isPrimary: true },
      include: {
        document: {
          select: { id: true },
        },
      },
    });
    if (existingPrimary?.document) {
      return {
        success: false,
        referenceId,
        errorCode: 'ALREADY_ATTACHED',
        error: 'Reference already has a document attached',
      };
    }

    const normalizedText = this.normalizePastedText(text, format);
    if (!normalizedText || normalizedText.length < 40) {
      return {
        success: false,
        referenceId,
        errorCode: 'INVALID_TEXT',
        error: 'Please provide more full-text content before saving',
      };
    }

    const contentBuffer = Buffer.from(normalizedText, 'utf8');
    const fileHash = crypto.createHash('sha256').update(contentBuffer).digest('hex');

    const existingDoc = await prisma.referenceDocument.findUnique({
      where: { fileHash },
      select: { id: true, sourceType: true, sourceIdentifier: true, mimeType: true },
    });

    if (existingDoc) {
      await this.attachDocumentToReference(userId, referenceId, existingDoc.id);
      return {
        success: true,
        referenceId,
        documentId: existingDoc.id,
        characterCount: normalizedText.length,
        documentSourceType: this.normalizeDocumentSourceType(existingDoc.sourceType, {
          sourceIdentifier: existingDoc.sourceIdentifier,
          mimeType: existingDoc.mimeType,
        }) || 'TEXT_PASTE',
      };
    }

    const userDir = path.join(this.uploadsBasePath, userId);
    fs.mkdirSync(userDir, { recursive: true });
    const docFileId = crypto.randomUUID().replace(/-/g, '');
    const storagePath = path.join(userDir, `${docFileId}.txt`);
    fs.writeFileSync(storagePath, contentBuffer);

    let createdDocumentId: string;
    try {
      const created = await this.createTextDocumentWithFallbackSource({
        userId,
        storagePath,
        originalFilename: `${docFileId}.txt`,
        fileHash,
        fileSizeBytes: contentBuffer.length,
        parsedText: normalizedText,
      });
      createdDocumentId = created.id;
    } catch (error) {
      if (fs.existsSync(storagePath)) {
        try {
          fs.unlinkSync(storagePath);
        } catch {
          // Ignore cleanup errors.
        }
      }
      throw error;
    }

    await this.attachDocumentToReference(userId, referenceId, createdDocumentId);

    return {
      success: true,
      referenceId,
      documentId: createdDocumentId,
      characterCount: normalizedText.length,
      documentSourceType: 'TEXT_PASTE',
    };
  }

  async getReferenceFullText(userId: string, referenceId: string): Promise<ReferenceFullTextResult> {
    const reference = await prisma.referenceLibrary.findFirst({
      where: { id: referenceId, userId, isActive: true },
      select: { id: true },
    });
    if (!reference) {
      return {
        success: false,
        referenceId,
        error: 'Reference not found',
      };
    }

    const link = await prisma.referenceDocumentLink.findFirst({
      where: { referenceId, isPrimary: true },
      include: {
        document: {
          select: {
            id: true,
            status: true,
            sourceType: true,
            sourceIdentifier: true,
            mimeType: true,
            parsedText: true,
            sectionsJson: true,
            parserUsed: true,
            pageCount: true,
          },
        },
      },
    });

    if (!link?.document) {
      return {
        success: false,
        referenceId,
        error: 'No full text is attached to this paper',
      };
    }

    let resolvedText = typeof link.document.parsedText === 'string' ? link.document.parsedText.trim() : '';
    if (!resolvedText) {
      const derived = this.buildTextFromSectionsJson(link.document.sectionsJson);
      if (derived) {
        resolvedText = derived;
        await prisma.referenceDocument.update({
          where: { id: link.document.id },
          data: {
            parsedText: sanitizeTextForPostgres(derived),
            parserUsed: link.document.parserUsed || 'PDFJS',
          },
        }).catch(() => undefined);
      }
    }

    return {
      success: true,
      referenceId,
      documentId: link.document.id,
      status: this.normalizePdfStatus(link.document.status),
      sourceType: this.normalizeDocumentSourceType(link.document.sourceType, {
        sourceIdentifier: link.document.sourceIdentifier,
        mimeType: link.document.mimeType,
      }),
      text: resolvedText || undefined,
      pageCount: link.document.pageCount,
    };
  }

  private normalizeDoi(doi: unknown): string | null {
    if (typeof doi !== 'string') return null;
    const cleaned = doi
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .trim();
    if (!cleaned) return null;
    if (!/^10\.\d{4,9}\/[^\s]+$/i.test(cleaned)) return null;
    return cleaned;
  }

  private extractDirectPdfUrl(result: SearchResult & Record<string, any>): string | null {
    const candidates = this.extractDirectPdfUrlCandidates(result);
    return candidates[0] || null;
  }

  private extractPdfUrlCandidates(
    result: SearchResult & Record<string, any>,
    doi: string | null
  ): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();

    const pushCandidate = (value: unknown) => {
      const normalized = this.normalizeCandidateUrl(value);
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(normalized);
    };

    const directCandidates = this.extractDirectPdfUrlCandidates(result);
    for (const candidate of directCandidates) {
      pushCandidate(candidate);
    }

    const raw = result.rawData || {};
    const landingCandidates: unknown[] = [
      result.url,
      raw?.url,
      raw?.URL,
      raw?.link,
      raw?.landing_page_url,
      raw?.html_url,
      raw?.primary_location?.landing_page_url,
      raw?.best_oa_location?.landing_page_url,
      raw?.best_oa_location?.url,
      raw?.openAccessPdf?.landingPageUrl,
    ];

    for (const candidate of landingCandidates) {
      pushCandidate(candidate);
    }

    if (Array.isArray(raw?.resources)) {
      for (const resource of raw.resources) {
        pushCandidate(resource?.url);
        pushCandidate(resource?.href);
        pushCandidate(resource?.link);
      }
    }

    if (Array.isArray(raw?.sourceFulltextUrls)) {
      for (const value of raw.sourceFulltextUrls) {
        pushCandidate(value);
      }
    }

    if (doi) {
      pushCandidate(`https://doi.org/${doi}`);
    }

    return candidates.slice(0, 12);
  }

  private extractDirectPdfUrlCandidates(result: SearchResult & Record<string, any>): string[] {
    const raw = result.rawData || {};
    const candidates: unknown[] = [
      result.pdfUrl,
      raw?.pdfUrl,
      raw?.openAccessPdf?.url,
      raw?.primary_location?.pdf_url,
      raw?.best_oa_location?.pdf_url,
      raw?.downloadUrl,
      raw?.url_for_pdf,
      raw?.fullTextPdfUrl,
    ];

    if (Array.isArray(raw?.sourceFulltextUrls)) {
      candidates.push(...raw.sourceFulltextUrls);
    }

    if (Array.isArray(raw?.resources)) {
      for (const resource of raw.resources) {
        candidates.push(resource?.link, resource?.url, resource?.href);
      }
    }

    if (Array.isArray(raw?.link)) {
      for (const link of raw.link) {
        const contentType = String(link?.['content-type'] || link?.content_type || '').toLowerCase();
        if (contentType.includes('pdf')) {
          candidates.push(link?.URL, link?.url);
        }
      }
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const value = this.normalizeCandidateUrl(candidate);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(value);
    }

    return normalized;
  }

  private normalizeCandidateUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    let candidate = value
      .trim()
      .replace(/&amp;/gi, '&');
    if (!candidate) return null;

    if (/^10\.\d{4,9}\/[^\s]+$/i.test(candidate)) {
      candidate = `https://doi.org/${candidate}`;
    } else if (/^(dx\.)?doi\.org\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }

    if (!/^https?:\/\//i.test(candidate)) {
      return null;
    }

    return candidate;
  }

  private async ensureReferenceForResult(
    userId: string,
    result: SearchResult & Record<string, any>
  ): Promise<{ id: string; pdfUrl: string | null } | null> {
    const candidateReferenceId = typeof result.libraryReferenceId === 'string' ? result.libraryReferenceId : null;
    if (candidateReferenceId) {
      const existingById = await prisma.referenceLibrary.findFirst({
        where: { id: candidateReferenceId, userId, isActive: true },
        select: { id: true, pdfUrl: true },
      });
      if (existingById) return existingById;
    }

    const doi = this.normalizeDoi(result.doi);
    if (doi) {
      const existingByDoi = await prisma.referenceLibrary.findFirst({
        where: {
          userId,
          isActive: true,
          doi: { equals: doi, mode: 'insensitive' },
        },
        select: { id: true, pdfUrl: true },
      });
      if (existingByDoi) return existingByDoi;
    }

    const title = typeof result.title === 'string' ? result.title.trim() : '';
    if (!doi && title) {
      const existingByTitle = await prisma.referenceLibrary.findFirst({
        where: {
          userId,
          isActive: true,
          title,
          year: typeof result.year === 'number' ? result.year : undefined,
        },
        select: { id: true, pdfUrl: true },
      });
      if (existingByTitle) return existingByTitle;
    }

    const authors = Array.isArray(result.authors)
      ? result.authors
          .filter((author): author is string => typeof author === 'string' && author.trim().length > 0)
          .map(author => author.trim())
      : [];

    if (!title) {
      return null;
    }

    try {
      const created = await referenceLibraryService.createReference({
        userId,
        title,
        authors: authors.length > 0 ? authors : ['Unknown'],
        year: typeof result.year === 'number' ? result.year : undefined,
        venue: typeof result.venue === 'string' ? result.venue : undefined,
        volume: typeof result.volume === 'string' ? result.volume : undefined,
        issue: typeof result.issue === 'string' ? result.issue : undefined,
        pages: typeof result.pages === 'string' ? result.pages : undefined,
        doi: doi || undefined,
        url: typeof result.url === 'string' ? result.url : undefined,
        isbn: typeof result.isbn === 'string' ? result.isbn : undefined,
        publisher: typeof result.publisher === 'string' ? result.publisher : undefined,
        edition: typeof result.edition === 'string' ? result.edition : undefined,
        editors: Array.isArray(result.editors) ? result.editors : undefined,
        publicationPlace: typeof result.publicationPlace === 'string' ? result.publicationPlace : undefined,
        publicationDate: typeof result.publicationDate === 'string' ? result.publicationDate : undefined,
        accessedDate: typeof result.accessedDate === 'string' ? result.accessedDate : undefined,
        articleNumber: typeof result.articleNumber === 'string' ? result.articleNumber : undefined,
        issn: typeof result.issn === 'string' ? result.issn : undefined,
        journalAbbreviation: typeof result.journalAbbreviation === 'string' ? result.journalAbbreviation : undefined,
        pmid: typeof result.pmid === 'string' ? result.pmid : undefined,
        pmcid: typeof result.pmcid === 'string' ? result.pmcid : undefined,
        arxivId: typeof result.arxivId === 'string' ? result.arxivId : undefined,
        abstract: typeof result.abstract === 'string' ? result.abstract : undefined,
        sourceType: this.mapPublicationTypeToCitationSourceType(result.publicationType),
        importSource: this.mapSearchSourceToImportSource(result.source),
        pdfUrl: this.extractDirectPdfUrl(result) || undefined,
      });

      return { id: created.id, pdfUrl: created.pdfUrl || null };
    } catch (error: any) {
      if (doi) {
        const fallback = await prisma.referenceLibrary.findFirst({
          where: {
            userId,
            isActive: true,
            doi: { equals: doi, mode: 'insensitive' },
          },
          select: { id: true, pdfUrl: true },
        });
        if (fallback) return fallback;
      }
      throw error;
    }
  }

  private async findExistingDocumentByDoi(
    doi: string
  ): Promise<{ id: string; status: any; sourceType: any; sourceIdentifier?: string | null; mimeType?: string | null } | null> {
    const docsByIdentifier = await prisma.referenceDocument.findMany({
      where: {
        sourceIdentifier: {
          equals: doi,
          mode: 'insensitive',
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, status: true, sourceType: true, sourceIdentifier: true, mimeType: true, storagePath: true },
      take: 20,
    });
    for (const doc of docsByIdentifier) {
      if (fs.existsSync(doc.storagePath)) {
        return {
          id: doc.id,
          status: doc.status,
          sourceType: doc.sourceType,
          sourceIdentifier: doc.sourceIdentifier,
          mimeType: doc.mimeType,
        };
      }
    }

    const docsViaReference = await prisma.referenceDocumentLink.findMany({
      where: {
        isPrimary: true,
        reference: {
          isActive: true,
          doi: { equals: doi, mode: 'insensitive' },
        },
      },
      include: {
        document: {
          select: { id: true, status: true, sourceType: true, sourceIdentifier: true, mimeType: true, storagePath: true },
        },
      },
      orderBy: { linkedAt: 'desc' },
      take: 20,
    });
    for (const link of docsViaReference) {
      if (link.document && fs.existsSync(link.document.storagePath)) {
        return {
          id: link.document.id,
          status: link.document.status,
          sourceType: link.document.sourceType,
          sourceIdentifier: link.document.sourceIdentifier,
          mimeType: link.document.mimeType,
        };
      }
    }

    return null;
  }

  private async attachDocumentToReference(userId: string, referenceId: string, documentId: string): Promise<void> {
    const existingLink = await prisma.referenceDocumentLink.findFirst({
      where: { referenceId, documentId },
      select: { id: true, isPrimary: true },
    });

    if (existingLink) {
      if (!existingLink.isPrimary) {
        await prisma.referenceDocumentLink.update({
          where: { id: existingLink.id },
          data: { isPrimary: true, linkedBy: userId, linkedAt: new Date() },
        });
      }
      return;
    }

    await prisma.referenceDocumentLink.create({
      data: {
        referenceId,
        documentId,
        isPrimary: true,
        linkedBy: userId,
      },
    });
  }

  private async setReferencePdfUrl(referenceId: string, pdfUrl: string | null): Promise<void> {
    if (!pdfUrl) return;
    await prisma.referenceLibrary.update({
      where: { id: referenceId },
      data: { pdfUrl },
    });
  }

  private buildTextFromSectionsJson(raw: unknown): string | null {
    if (!Array.isArray(raw)) return null;

    const chunks = raw
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const heading = String((item as any).heading || '').trim();
        const text = String((item as any).text || '').trim();
        if (!text) return '';
        return heading ? `## ${heading}\n\n${text}` : text;
      })
      .filter(Boolean);

    if (chunks.length === 0) return null;
    return chunks.join('\n\n').trim() || null;
  }

  private normalizePdfStatus(status: unknown): 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE' {
    if (status === 'UPLOADED' || status === 'PARSING' || status === 'READY' || status === 'FAILED') {
      return status;
    }
    return 'NONE';
  }

  private normalizeDocumentSourceType(
    sourceType: unknown,
    metadata?: { sourceIdentifier?: unknown; mimeType?: unknown }
  ): 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE' | undefined {
    const sourceIdentifier = typeof metadata?.sourceIdentifier === 'string'
      ? metadata.sourceIdentifier.toLowerCase()
      : '';
    const mimeType = typeof metadata?.mimeType === 'string'
      ? metadata.mimeType.toLowerCase()
      : '';
    if (sourceType === 'TEXT_PASTE' || sourceIdentifier.startsWith('text:') || mimeType.startsWith('text/')) {
      return 'TEXT_PASTE';
    }
    if (sourceType === 'UPLOAD' || sourceType === 'DOI_FETCH' || sourceType === 'URL_IMPORT' || sourceType === 'TEXT_PASTE') {
      return sourceType;
    }
    return undefined;
  }

  private async createTextDocumentWithFallbackSource(input: {
    userId: string;
    storagePath: string;
    originalFilename: string;
    fileHash: string;
    fileSizeBytes: number;
    parsedText: string;
  }): Promise<{ id: string }> {
    const baseData = {
      userId: input.userId,
      storagePath: input.storagePath,
      originalFilename: input.originalFilename,
      fileHash: input.fileHash,
      fileSizeBytes: input.fileSizeBytes,
      mimeType: 'text/plain',
      sourceIdentifier: `text:${input.fileHash}`,
      status: 'READY' as const,
      parsedText: sanitizeTextForPostgres(input.parsedText),
    };

    try {
      return await prisma.referenceDocument.create({
        data: {
          ...baseData,
          sourceType: 'TEXT_PASTE' as any,
        },
        select: { id: true },
      });
    } catch (error: any) {
      if (!this.isSourceTypeEnumCompatibilityError(error)) {
        throw error;
      }

      return prisma.referenceDocument.create({
        data: {
          ...baseData,
          // Compatibility fallback when Prisma client/DB enum has not yet been migrated.
          sourceType: 'URL_IMPORT',
        },
        select: { id: true },
      });
    }
  }

  private isSourceTypeEnumCompatibilityError(error: any): boolean {
    const message = typeof error?.message === 'string' ? error.message : '';
    const normalized = message.toLowerCase();
    return (
      message.includes('Invalid value for argument `sourceType`') ||
      message.includes('Expected ReferenceDocumentSource') ||
      (normalized.includes('invalid input value for enum') && normalized.includes('referencedocumentsource')) ||
      (normalized.includes('referencedocumentsource') && normalized.includes('text_paste'))
    );
  }

  private normalizePastedText(text: string, format: 'plain' | 'html'): string {
    let normalized = (text || '').replace(/\u0000/g, '').replace(/\r\n/g, '\n');
    if (format === 'html') {
      normalized = normalized
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/?(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|td|th|br)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
      normalized = this.decodeHtmlEntities(normalized);
    }

    return normalized
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  private mapPublicationTypeToCitationSourceType(
    publicationType: unknown
  ):
    | 'JOURNAL_ARTICLE'
    | 'CONFERENCE_PAPER'
    | 'BOOK_CHAPTER'
    | 'BOOK'
    | 'THESIS'
    | 'OTHER' {
    switch (publicationType) {
      case 'journal-article':
        return 'JOURNAL_ARTICLE';
      case 'conference-paper':
        return 'CONFERENCE_PAPER';
      case 'book-chapter':
        return 'BOOK_CHAPTER';
      case 'book':
        return 'BOOK';
      case 'thesis':
        return 'THESIS';
      default:
        return 'OTHER';
    }
  }

  private mapSearchSourceToImportSource(
    source: unknown
  ):
    | 'MANUAL'
    | 'SCHOLAR_SEARCH'
    | 'CROSSREF_API'
    | 'SEMANTIC_SCHOLAR'
    | 'OPENALEX'
    | 'LIBRARY_IMPORT' {
    switch (source) {
      case 'google_scholar':
        return 'SCHOLAR_SEARCH';
      case 'crossref':
        return 'CROSSREF_API';
      case 'semantic_scholar':
        return 'SEMANTIC_SCHOLAR';
      case 'openalex':
        return 'OPENALEX';
      case 'library':
        return 'LIBRARY_IMPORT';
      default:
        return 'MANUAL';
    }
  }
}

export const paperAcquisitionService = new PaperAcquisitionService();
