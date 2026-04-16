/**
 * PDF Import API
 * POST /api/library/import-pdf - Import reference by uploading a PDF
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { authenticateUser } from '@/lib/auth-middleware';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { referenceDocumentService } from '@/lib/services/reference-document-service';
import { referenceReconciliationService } from '@/lib/services/reference-reconciliation-service';
import { libraryConnectionService } from '@/lib/services/library-connection-service';
import { prisma } from '@/lib/prisma';
import { normalizeDoi as normalizeDoiValue, normalizeSearchText } from '@/lib/utils/reference-matching-normalization';
import * as crypto from 'crypto';

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_REFERENCE_PDF_SIZE_MB || '50', 10);
const MAX_FILES_PER_REQUEST = parseInt(process.env.MAX_REFERENCE_IMPORT_FILES || '30', 10);
const IMPORT_CONCURRENCY = Math.max(
  1,
  Math.min(8, parseInt(process.env.REFERENCE_IMPORT_CONCURRENCY || '4', 10) || 4)
);

function normalizeDoi(value?: string | null): string | undefined {
  return normalizeDoiValue(value) || undefined;
}

function parseAuthors(authors?: string): string[] {
  if (!authors) return [];

  // Support common separators from PDF metadata.
  return authors
    .split(/;|,|\band\b/gi)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeTitleForMatch(value?: string | null): string {
  return normalizeSearchText(value);
}

function normalizeAuthorLastName(value?: string | null): string {
  const cleaned = normalizeSearchText(String(value || '').replace(/,/g, ' '));
  if (!cleaned) return '';
  const parts = cleaned.split(/[\s,]+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function tokenizeTitleForMatch(value?: string | null): Set<string> {
  return new Set(
    normalizeTitleForMatch(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of Array.from(a)) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function extractDoiFromRawPdf(buffer: Buffer): string | undefined {
  // Inspect only a bounded prefix to avoid expensive scans on large PDFs.
  const rawText = buffer.subarray(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString('latin1');
  const patterns = [
    /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)/i,
    /doi[:\s]+(10\.\d{4,9}\/\S+)/i,
    /(10\.\d{4,9}\/\S{3,})/i,
  ];

  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    const normalized = normalizeDoi(match?.[1]);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function decodePdfLiteral(input: string): string {
  if (!input) return '';
  const withEscapes = input.replace(/\\([\\()])/g, '$1');
  return withEscapes
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\f/g, '\f')
    .replace(/\\b/g, '\b')
    .replace(/\\(\d{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

function decodePdfHexLiteral(input: string): string {
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '');
  if (!cleaned) return '';

  const normalized = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`;
  let decoded = '';
  for (let i = 0; i < normalized.length; i += 2) {
    decoded += String.fromCharCode(parseInt(normalized.slice(i, i + 2), 16));
  }
  return decoded;
}

function sanitizePdfInfoValue(value: string): string | undefined {
  const cleaned = value
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function extractPdfInfoValue(rawPdfText: string, key: 'Title' | 'Author'): string | undefined {
  const literalMatch = rawPdfText.match(new RegExp(`\\/${key}\\s*\\(([^)]{1,1024})\\)`, 'i'));
  if (literalMatch?.[1]) {
    return sanitizePdfInfoValue(decodePdfLiteral(literalMatch[1]));
  }

  const hexMatch = rawPdfText.match(new RegExp(`\\/${key}\\s*<([0-9a-fA-F\\s]{2,2048})>`, 'i'));
  if (hexMatch?.[1]) {
    return sanitizePdfInfoValue(decodePdfHexLiteral(hexMatch[1]));
  }

  return undefined;
}

function extractMetadataFromRawPdf(buffer: Buffer): {
  title?: string;
  authors?: string;
  doi?: string;
} {
  const rawPdfText = buffer
    .subarray(0, Math.min(buffer.length, 1024 * 1024))
    .toString('latin1');

  return {
    title: extractPdfInfoValue(rawPdfText, 'Title'),
    authors: extractPdfInfoValue(rawPdfText, 'Author'),
    doi: extractDoiFromRawPdf(buffer),
  };
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  worker: (item: TItem) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

interface ImportPdfResult {
  fileName: string;
  success: boolean;
  documentId?: string;
  referenceId?: string;
  referenceTitle?: string;
  doi?: string | null;
  doiEnriched?: boolean;
  pdfAttached?: boolean;
  pdfAlreadyExistsForReference?: boolean;
  pdfStatus?: string | null;
  linkedCitationCount?: number;
  error?: string;
}

async function findExistingReferenceForPdf(input: {
  userId: string;
  doi?: string | null;
  title?: string | null;
  authors?: string[] | null;
}) {
  const normalizedDoi = normalizeDoi(input.doi);
  if (normalizedDoi) {
    const byDoi = await prisma.referenceLibrary.findFirst({
      where: {
        userId: input.userId,
        isActive: true,
        doi: { equals: normalizedDoi, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (byDoi) return byDoi;
  }

  const title = String(input.title || '').trim();
  if (!title) return null;

  const normalizedTitle = normalizeTitleForMatch(title);
  if (!normalizedTitle) return null;
  const expectedFirstAuthorLast = normalizeAuthorLastName(input.authors?.[0] || '');
  const titleTokens = tokenizeTitleForMatch(normalizedTitle);
  const longestTitleToken = normalizedTitle
    .split(' ')
    .filter((token) => token.length >= 4)
    .sort((a, b) => b.length - a.length)[0];

  const titleQueryClauses: Prisma.ReferenceLibraryWhereInput[] = [
    { title: { equals: title, mode: 'insensitive' } },
  ];
  if (title.length >= 18) {
    titleQueryClauses.push({
      title: {
        contains: title.slice(0, Math.min(90, title.length)),
        mode: 'insensitive',
      },
    });
  }
  if (longestTitleToken) {
    titleQueryClauses.push({
      title: {
        contains: longestTitleToken,
        mode: 'insensitive',
      },
    });
  }

  const fetchCandidates = () => prisma.referenceLibrary.findMany({
    where: {
      userId: input.userId,
      isActive: true,
      OR: titleQueryClauses,
    },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });
  const candidates = await fetchCandidates();

  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((candidate) => {
      const candidateTitleNormalized = normalizeTitleForMatch(candidate.title);
      const candidateTitleTokens = tokenizeTitleForMatch(candidateTitleNormalized);
      const titleSimilarity = jaccard(titleTokens, candidateTitleTokens);

      let score = titleSimilarity * 100;
      if (candidateTitleNormalized === normalizedTitle) score += 35;
      else if (
        candidateTitleNormalized.includes(normalizedTitle)
        || normalizedTitle.includes(candidateTitleNormalized)
      ) score += 16;

      if (expectedFirstAuthorLast) {
        const hasFirstAuthorMatch = Array.isArray(candidate.authors)
          && candidate.authors.some(author => normalizeAuthorLastName(author) === expectedFirstAuthorLast);
        if (hasFirstAuthorMatch) score += 12;
        else score -= 6;
      }

      return { score, titleSimilarity, candidate };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;
  if (best.titleSimilarity < 0.45 && best.score < 55) return null;
  return best.candidate;
}

async function linkReferenceToUserCitations(input: {
  userId: string;
  referenceId: string;
  referenceDoi?: string | null;
  referenceTitle?: string | null;
  referenceYear?: number | null;
  referenceAuthors?: string[] | null;
}): Promise<number> {
  const citationIds = new Set<string>();
  const normalizedDoi = normalizeDoi(input.referenceDoi);

  if (normalizedDoi) {
    const doiMatches = await prisma.citation.findMany({
      where: {
        isActive: true,
        libraryReferenceId: null,
        session: { userId: input.userId },
        doi: { equals: normalizedDoi, mode: 'insensitive' },
      },
      select: { id: true },
      take: 500,
    });
    doiMatches.forEach(match => citationIds.add(match.id));
  }

  const title = String(input.referenceTitle || '').trim();
  const normalizedTitle = normalizeTitleForMatch(title);
  if (normalizedTitle) {
    const expectedYear = Number.isFinite(Number(input.referenceYear)) ? Number(input.referenceYear) : null;
    const expectedAuthorLast = normalizeAuthorLastName(input.referenceAuthors?.[0] || '');

    const titleMatches = await prisma.citation.findMany({
      where: {
        isActive: true,
        libraryReferenceId: null,
        session: { userId: input.userId },
        title: { equals: title, mode: 'insensitive' },
      },
      select: {
        id: true,
        year: true,
        authors: true,
      },
      take: 300,
    });

    for (const match of titleMatches) {
      if (expectedYear && match.year && Math.abs(match.year - expectedYear) > 1) {
        continue;
      }
      if (expectedAuthorLast) {
        const hasAuthor = Array.isArray(match.authors)
          && match.authors.some(author => normalizeAuthorLastName(author) === expectedAuthorLast);
        if (!hasAuthor) continue;
      }
      citationIds.add(match.id);
    }
  }

  if (citationIds.size === 0) {
    return 0;
  }

  const updated = await prisma.citation.updateMany({
    where: {
      id: { in: Array.from(citationIds) },
      libraryReferenceId: null,
    },
    data: {
      libraryReferenceId: input.referenceId,
    },
  });

  return updated.count;
}

async function importSinglePdf(
  userId: string,
  file: File,
  collectionIdValue?: string
): Promise<ImportPdfResult> {
  if (file.type !== 'application/pdf') {
    return {
      fileName: file.name,
      success: false,
      error: 'Only PDF files are accepted',
    };
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return {
      fileName: file.name,
      success: false,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB`,
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  const existingDocument = await prisma.referenceDocument.findUnique({
    where: { fileHash },
    select: {
      id: true,
      pdfTitle: true,
      pdfAuthors: true,
      pdfDoi: true,
      status: true,
    },
  });

  const existingLinkedReference = existingDocument?.id
    ? await prisma.referenceDocumentLink.findFirst({
      where: {
        documentId: existingDocument.id,
        isPrimary: true,
        reference: {
          userId,
          isActive: true,
        },
      },
      include: {
        reference: true,
      },
    })
    : null;

  if (existingLinkedReference) {
    const linkedCitationCount = await linkReferenceToUserCitations({
      userId,
      referenceId: existingLinkedReference.reference.id,
      referenceDoi: existingLinkedReference.reference.doi,
      referenceTitle: existingLinkedReference.reference.title,
      referenceYear: existingLinkedReference.reference.year,
      referenceAuthors: existingLinkedReference.reference.authors,
    });

    if (collectionIdValue) {
      try {
        await referenceLibraryService.addToCollection(userId, collectionIdValue, [existingLinkedReference.reference.id]);
      } catch (collectionErr) {
        console.error('Failed to add existing PDF-linked reference to collection:', collectionErr);
      }
    }

    return {
      fileName: file.name,
      success: true,
      documentId: existingDocument?.id,
      referenceId: existingLinkedReference.reference.id,
      referenceTitle: existingLinkedReference.reference.title,
      doi: normalizeDoi(existingLinkedReference.reference.doi) || normalizeDoi(existingDocument?.pdfDoi) || null,
      doiEnriched: Boolean(existingLinkedReference.reference.doi),
      pdfAttached: false,
      pdfAlreadyExistsForReference: true,
      pdfStatus: existingDocument?.status,
      linkedCitationCount,
    };
  }

  const extractedMetadata = extractMetadataFromRawPdf(buffer);
  const mergedMetadata = {
    title: extractedMetadata.title || existingDocument?.pdfTitle || undefined,
    authors: extractedMetadata.authors || existingDocument?.pdfAuthors || undefined,
    doi:
      normalizeDoi(extractedMetadata.doi) ||
      normalizeDoi(existingDocument?.pdfDoi) ||
      undefined,
  };
  const extractedDoi = mergedMetadata.doi;

  let reference: any = null;
  let doiEnriched = false;

  if (extractedDoi) {
    try {
      reference = await referenceLibraryService.importFromDOI(userId, extractedDoi);
      doiEnriched = true;
    } catch (doiErr) {
      const msg = doiErr instanceof Error ? doiErr.message : '';
      if (msg.includes('already exists')) {
        reference = await prisma.referenceLibrary.findFirst({
          where: {
            userId,
            isActive: true,
            doi: { equals: extractedDoi, mode: 'insensitive' },
          },
        });
        if (reference) {
          doiEnriched = true;
        }
      } else if (msg) {
        console.warn(`[PDF Import] DOI lookup failed for ${extractedDoi}: ${msg}`);
      }
    }
  }

  if (!reference) {
    reference = await findExistingReferenceForPdf({
      userId,
      doi: extractedDoi,
      title: mergedMetadata.title,
      authors: parseAuthors(mergedMetadata.authors),
    });
  }

  if (!reference) {
    const fallbackTitle = mergedMetadata.title?.trim() || file.name.replace(/\.pdf$/i, '').trim() || 'Untitled PDF';
    reference = await referenceLibraryService.createReference({
      userId,
      title: fallbackTitle,
      authors: parseAuthors(mergedMetadata.authors),
      doi: extractedDoi || undefined,
      sourceType: extractedDoi ? 'JOURNAL_ARTICLE' : 'OTHER',
      importSource: extractedDoi ? 'DOI_LOOKUP' : 'MANUAL',
      notes: extractedDoi ? 'Created from uploaded PDF using extracted DOI.' : 'Created from uploaded PDF metadata.',
    });
  }

  if (collectionIdValue && reference?.id) {
    try {
      await referenceLibraryService.addToCollection(userId, collectionIdValue, [reference.id]);
    } catch (collectionErr) {
      console.error('Failed to add PDF-imported reference to collection:', collectionErr);
    }
  }

  const attachResult = await referenceDocumentService.uploadDocument(
    userId,
    reference.id,
    buffer,
    file.name
  );

  if (!attachResult.success && attachResult.error !== 'Reference already has a PDF attached. Use replace to update it.') {
    return {
      fileName: file.name,
      success: false,
      referenceId: reference.id,
      referenceTitle: reference.title,
      error: attachResult.error || 'Failed to attach PDF to reference',
    };
  }

  const alreadyHadPdf = attachResult.error === 'Reference already has a PDF attached. Use replace to update it.';
  const linkedCitationCount = await linkReferenceToUserCitations({
    userId,
    referenceId: reference.id,
    referenceDoi: reference.doi || extractedDoi,
    referenceTitle: reference.title || mergedMetadata.title,
    referenceYear: reference.year || undefined,
    referenceAuthors: Array.isArray(reference.authors) ? reference.authors : parseAuthors(mergedMetadata.authors),
  });

  return {
    fileName: file.name,
    success: true,
    documentId: attachResult.document?.id,
    referenceId: reference.id,
    referenceTitle: reference.title,
    doi: extractedDoi || null,
    doiEnriched,
    pdfAttached: attachResult.success,
    pdfAlreadyExistsForReference: alreadyHadPdf,
    pdfStatus: attachResult.document?.status || null,
    linkedCitationCount,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const formData = await request.formData();
    const filesFromField = formData.getAll('files');
    const singleFile = formData.get('file');
    const files = (filesFromField.length > 0 ? filesFromField : [singleFile]).filter(
      (entry): entry is File => entry instanceof File
    );
    const collectionId = formData.get('collectionId');
    const collectionIdValue = typeof collectionId === 'string' && collectionId.trim().length > 0
      ? collectionId.trim()
      : undefined;
    const reconcileField = formData.get('reconcile');
    const shouldReconcile = typeof reconcileField === 'string'
      ? reconcileField.trim().toLowerCase() !== 'false'
      : true;
    // Resolve provider tokens from stored connections (tokens never touch the client)
    let effectiveMendeleyAccessToken: string | undefined;
    let effectiveZoteroApiKey: string | undefined;
    let effectiveZoteroUserId: string | undefined;
    const effectiveZoteroGroupId: string | undefined = undefined;
    try {
      const { accessToken } = await libraryConnectionService.ensureValidToken(user.id, 'mendeley');
      effectiveMendeleyAccessToken = accessToken;
    } catch { /* no Mendeley connection */ }
    try {
      const { accessToken, providerUserId } = await libraryConnectionService.ensureValidToken(user.id, 'zotero');
      effectiveZoteroApiKey = accessToken;
      effectiveZoteroUserId = providerUserId ?? undefined;
    } catch { /* no Zotero connection */ }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many files. Maximum ${MAX_FILES_PER_REQUEST} files per upload.` },
        { status: 400 }
      );
    }

    const results = await mapWithConcurrency(files, IMPORT_CONCURRENCY, async (file) => {
      try {
        return await importSinglePdf(user.id, file, collectionIdValue);
      } catch (itemErr) {
        return {
          fileName: file.name,
          success: false,
          error: itemErr instanceof Error ? itemErr.message : 'Import failed',
        } satisfies ImportPdfResult;
      }
    });

    const imported = results.filter((result) => result.success).length;
    const failed = results.length - imported;
    const citationsLinked = results.reduce((sum, result) => sum + Number(result.linkedCitationCount || 0), 0);
    const firstSuccess = results.find((result) => result.success);
    const successfulDocumentIds = Array.from(new Set(
      results
        .filter((result) => result.success && typeof result.documentId === 'string' && result.documentId.trim().length > 0)
        .map((result) => String(result.documentId))
    ));

    let reconciliation: any = null;
    if (shouldReconcile && successfulDocumentIds.length > 0) {
      reconciliation = await referenceReconciliationService.runReconciliation({
        userId: user.id,
        actorUserId: user.id,
        tenantId: (user as any).tenantId || null,
        documentIds: successfulDocumentIds,
        applyAutoLinks: true,
        dryRun: false,
        includeAlreadyLinkedDocuments: true,
        providers: {
          mendeleyAccessToken: effectiveMendeleyAccessToken,
          zoteroApiKey: effectiveZoteroApiKey,
          zoteroUserId: effectiveZoteroUserId,
          zoteroGroupId: effectiveZoteroGroupId,
        },
      }).catch((reconcileErr: unknown) => ({
        error: reconcileErr instanceof Error ? reconcileErr.message : 'Reconciliation failed',
      }));
    }

    // Backward compatibility for older single-file UI consumers.
    if (results.length === 1 && firstSuccess) {
      return NextResponse.json(
        {
          ...firstSuccess,
          reference: {
            id: firstSuccess.referenceId,
            title: firstSuccess.referenceTitle,
          },
          results,
          reconciliation,
          summary: { total: 1, imported, failed, citationsLinked },
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        results,
        reconciliation,
        summary: {
          total: results.length,
          imported,
          failed,
          citationsLinked,
        },
      },
      { status: failed > 0 ? 207 : 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /too large|entity too large|request body.*large|payload.*large|body exceeded/i.test(message)
    ) {
      return NextResponse.json(
        {
          error:
            'Upload payload too large. Reduce file size/count or increase reverse-proxy upload limit (for Nginx: client_max_body_size).',
        },
        { status: 413 }
      );
    }

    console.error('PDF import error:', err);
    return NextResponse.json(
      { error: message || 'Failed to import from PDF' },
      { status: 500 }
    );
  }
}
