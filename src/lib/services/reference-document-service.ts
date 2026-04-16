/**
 * Reference Document Service
 * Manages PDF document upload, attachment, deduplication, and OA PDF fetching
 * for the Reference Library feature.
 */

import { prisma } from '../prisma';
import { pdfParserService } from './pdf-parser-service';
import { proactiveParsingService } from './proactive-parsing-service';
import { pdfMatchVerificationService } from './pdf-match-verification-service';
import type { ExtractedPdfMetadata } from './pdf-parser-service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as net from 'net';

// Default limits
const DEFAULT_MAX_FILE_SIZE_MB = parseInt(process.env.MAX_REFERENCE_PDF_SIZE_MB || '50', 10);
const DEFAULT_UPLOADS_PATH = process.env.REFERENCE_UPLOADS_PATH || 'uploads/references';
const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL || '';
const MAX_PDF_DISCOVERY_DEPTH = Math.max(2, parseInt(process.env.PDF_DISCOVERY_MAX_DEPTH || '4', 10) || 4);
const MAX_HTML_PDF_CANDIDATES = Math.max(5, parseInt(process.env.PDF_DISCOVERY_MAX_CANDIDATES || '24', 10) || 24);
const DOMAIN_FETCH_MIN_INTERVAL_MS = Math.max(100, parseInt(process.env.PDF_FETCH_DOMAIN_MIN_INTERVAL_MS || '1200', 10) || 1200);
const DOMAIN_FETCH_COOLDOWN_BASE_MS = Math.max(1000, parseInt(process.env.PDF_FETCH_DOMAIN_COOLDOWN_BASE_MS || '15000', 10) || 15000);
const DOMAIN_FETCH_COOLDOWN_MAX_MS = Math.max(DOMAIN_FETCH_COOLDOWN_BASE_MS, parseInt(process.env.PDF_FETCH_DOMAIN_COOLDOWN_MAX_MS || '300000', 10) || 300000);
const DOMAIN_FETCH_RATE_LIMIT_RETRIES = Math.max(0, parseInt(process.env.PDF_FETCH_RATE_LIMIT_RETRIES || '2', 10) || 2);
const ENABLE_REFERENCE_PDF_PROACTIVE_PARSING =
    String(process.env.ENABLE_REFERENCE_PDF_PROACTIVE_PARSING || 'false').trim().toLowerCase() === 'true';

interface DomainFetchState {
    tail: Promise<void>;
    nextAllowedAt: number;
    cooldownUntil: number;
    penaltyLevel: number;
}

const DOMAIN_FETCH_STATE = new Map<string, DomainFetchState>();

export interface UploadDocumentResult {
    success: boolean;
    document?: any;
    link?: any;
    isDuplicate?: boolean;
    existingDocumentId?: string;
    extractedMetadata?: ExtractedPdfMetadata | null;
    error?: string;
}

export interface FetchOAResult {
    success: boolean;
    document?: any;
    link?: any;
    oaUrl?: string;
    errorCode?: 'INVALID_URL' | 'NOT_PDF' | 'DOWNLOAD_FAILED' | 'REFERENCE_NOT_FOUND' | 'ALREADY_ATTACHED';
    error?: string;
}

export interface ImportPdfFromUrlOptions {
    sourceIdentifier?: string;
    sourceType?: 'DOI_FETCH' | 'URL_IMPORT';
    originalFilenameHint?: string;
}

class ReferenceDocumentService {
    private uploadsBasePath: string;
    private maxFileSizeBytes: number;

    constructor() {
        this.uploadsBasePath = path.resolve(process.cwd(), DEFAULT_UPLOADS_PATH);
        this.maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;
    }

    /**
     * Ensure the upload directory for a user exists.
     */
    private ensureUserDir(userId: string): string {
        const userDir = path.join(this.uploadsBasePath, userId);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        return userDir;
    }

    /**
     * Compute SHA-256 hash of a buffer.
     */
    private computeHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * Validate a file buffer before processing.
     */
    private validateFile(buffer: Buffer, filename: string): string | null {
        // Check file size
        if (buffer.length > this.maxFileSizeBytes) {
            return `File exceeds maximum size of ${DEFAULT_MAX_FILE_SIZE_MB}MB`;
        }

        // Check PDF magic bytes
        const header = buffer.slice(0, 5).toString('ascii');
        if (header !== '%PDF-') {
            return 'File does not appear to be a valid PDF';
        }

        return null;
    }

    // ============================================================================
    // UPLOAD & ATTACH
    // ============================================================================

    /**
     * Upload a PDF file and attach it to a reference.
     * Handles deduplication by file hash.
     */
    async uploadDocument(
        userId: string,
        referenceId: string,
        fileBuffer: Buffer,
        filename: string
    ): Promise<UploadDocumentResult> {
        // Validate file
        const validationError = this.validateFile(fileBuffer, filename);
        if (validationError) {
            return { success: false, error: validationError };
        }

        // Verify reference ownership
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) {
            return { success: false, error: 'Reference not found' };
        }

        // Check if this reference already has a primary document
        const existingLink = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
        });
        if (existingLink) {
            return { success: false, error: 'Reference already has a PDF attached. Use replace to update it.' };
        }

        // Compute hash for deduplication
        const fileHash = this.computeHash(fileBuffer);

        // Check for duplicate by hash
        const existingDoc = await prisma.referenceDocument.findUnique({
            where: { fileHash },
        });

        if (existingDoc) {
            // Same file already uploaded — link to this reference instead of re-uploading
            const link = await prisma.referenceDocumentLink.create({
                data: {
                    referenceId,
                    documentId: existingDoc.id,
                    isPrimary: true,
                    linkedBy: userId,
                },
            });

            return {
                success: true,
                document: existingDoc,
                link,
                isDuplicate: true,
                existingDocumentId: existingDoc.id,
            };
        }

        // Store file on disk
        const userDir = this.ensureUserDir(userId);
        const docId = crypto.randomUUID().replace(/-/g, '');
        const storagePath = path.join(userDir, `${docId}.pdf`);

        try {
            fs.writeFileSync(storagePath, fileBuffer);
        } catch (err) {
            return { success: false, error: 'Failed to store file on disk' };
        }

        // Create document record
        const document = await prisma.referenceDocument.create({
            data: {
                userId,
                storagePath,
                originalFilename: filename,
                fileHash,
                fileSizeBytes: fileBuffer.length,
                mimeType: 'application/pdf',
                sourceType: 'UPLOAD',
                status: 'UPLOADED',
            },
        });

        // Create link
        const link = await prisma.referenceDocumentLink.create({
            data: {
                referenceId,
                documentId: document.id,
                isPrimary: true,
                linkedBy: userId,
            },
        });

        // Start async parsing (fire and forget)
        this.processDocumentAsync(document.id);

        // Return immediately with UPLOADED status, metadata will come after parsing
        return {
            success: true,
            document,
            link,
            isDuplicate: false,
        };
    }

    /**
     * Upload a PDF without linking to a specific reference.
     * Extracts metadata from the PDF and returns it to the caller
     * so they can auto-create or match a reference.
     */
    async uploadDocumentStandalone(
        userId: string,
        fileBuffer: Buffer,
        filename: string
    ): Promise<UploadDocumentResult> {
        // Validate file
        const validationError = this.validateFile(fileBuffer, filename);
        if (validationError) {
            return { success: false, error: validationError };
        }

        // Compute hash for deduplication
        const fileHash = this.computeHash(fileBuffer);

        // Check for duplicate by hash
        const existingDoc = await prisma.referenceDocument.findUnique({
            where: { fileHash },
        });

        if (existingDoc) {
            return {
                success: true,
                document: existingDoc,
                isDuplicate: true,
                existingDocumentId: existingDoc.id,
            };
        }

        // Store file
        const userDir = this.ensureUserDir(userId);
        const docId = crypto.randomUUID().replace(/-/g, '');
        const storagePath = path.join(userDir, `${docId}.pdf`);

        try {
            fs.writeFileSync(storagePath, fileBuffer);
        } catch (err) {
            return { success: false, error: 'Failed to store file on disk' };
        }

        // Quick metadata extraction before saving
        const extractedMetadata = await pdfParserService.extractMetadataOnly(storagePath);

        // Create document record
        const document = await prisma.referenceDocument.create({
            data: {
                userId,
                storagePath,
                originalFilename: filename,
                fileHash,
                fileSizeBytes: fileBuffer.length,
                mimeType: 'application/pdf',
                sourceType: 'UPLOAD',
                status: 'UPLOADED',
                // Save metadata immediately
                pdfTitle: extractedMetadata?.title,
                pdfAuthors: extractedMetadata?.authors,
                pdfSubject: extractedMetadata?.subject,
                pdfCreator: extractedMetadata?.creator,
                pdfProducer: extractedMetadata?.producer,
                pdfCreationDate: extractedMetadata?.creationDate,
                pdfDoi: extractedMetadata?.doi,
            },
        });

        // Start async parsing
        this.processDocumentAsync(document.id);

        return {
            success: true,
            document,
            isDuplicate: false,
            extractedMetadata,
        };
    }

    // ============================================================================
    // DETACH & REPLACE
    // ============================================================================

    /**
     * Detach (unlink) a document from a reference.
     * The document file stays if referenced elsewhere; cleaned up if orphaned.
     */
    async detachDocument(userId: string, referenceId: string): Promise<{ success: boolean; error?: string }> {
        // Verify reference ownership
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) {
            return { success: false, error: 'Reference not found' };
        }

        // Find and remove the link
        const link = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
            include: { document: true },
        });

        if (!link) {
            return { success: false, error: 'No document attached to this reference' };
        }

        // Remove the link
        await prisma.referenceDocumentLink.delete({
            where: { id: link.id },
        });

        // Check if document is orphaned (no other links)
        const otherLinks = await prisma.referenceDocumentLink.count({
            where: { documentId: link.documentId },
        });

        if (otherLinks === 0) {
            // Soft delete: keep file but mark as orphaned for future cleanup
            // In production, a cleanup job would remove these periodically
            // For now, just delete the file
            try {
                if (fs.existsSync(link.document.storagePath)) {
                    fs.unlinkSync(link.document.storagePath);
                }
                await prisma.referenceDocument.delete({
                    where: { id: link.documentId },
                });
            } catch (err) {
                console.error('[RefDocService] Failed to clean up orphaned document:', err);
            }
        }

        return { success: true };
    }

    /**
     * Replace the document attached to a reference.
     */
    async replaceDocument(
        userId: string,
        referenceId: string,
        fileBuffer: Buffer,
        filename: string
    ): Promise<UploadDocumentResult> {
        // First detach existing
        const detachResult = await this.detachDocument(userId, referenceId);
        if (!detachResult.success && detachResult.error !== 'No document attached to this reference') {
            return { success: false, error: detachResult.error };
        }

        // Then upload new
        return this.uploadDocument(userId, referenceId, fileBuffer, filename);
    }

    // ============================================================================
    // QUERY & STATUS
    // ============================================================================

    /**
     * Get the document attached to a reference.
     */
    async getDocumentByReference(userId: string, referenceId: string) {
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) return null;

        const link = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId },
            orderBy: [{ isPrimary: 'desc' }, { linkedAt: 'desc' }],
            include: {
                document: {
                    select: {
                        id: true,
                        originalFilename: true,
                        fileSizeBytes: true,
                        mimeType: true,
                        sourceType: true,
                        sourceIdentifier: true,
                        status: true,
                        errorCode: true,
                        pageCount: true,
                        pdfTitle: true,
                        pdfAuthors: true,
                        pdfSubject: true,
                        pdfDoi: true,
                        pdfCreationDate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        });

        return link;
    }

    /**
     * Get document processing status.
     */
    async getDocumentStatus(userId: string, documentId: string) {
        const doc = await prisma.referenceDocument.findFirst({
            where: { id: documentId, userId },
            select: {
                id: true,
                status: true,
                errorCode: true,
                pageCount: true,
                pdfTitle: true,
                pdfAuthors: true,
                pdfDoi: true,
                updatedAt: true,
            },
        });
        return doc;
    }

    /**
     * Public wrapper used by paper-acquisition-service for URL pre-validation.
     */
    validatePdfImportUrl(candidate: string): string | null {
        return this.validateExternalPdfUrl(candidate);
    }

    // ============================================================================
    // OPEN ACCESS PDF FETCHING (Unpaywall)
    // ============================================================================

    /**
     * Import a PDF from a direct URL and attach it to a reference.
     * Uses the same validation + dedup + async parsing pipeline as DOI fetch.
     */
    async importPdfFromUrl(
        userId: string,
        referenceId: string,
        pdfUrl: string,
        options: ImportPdfFromUrlOptions = {}
    ): Promise<FetchOAResult> {
        // Verify reference exists and belongs to user
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) {
            return { success: false, errorCode: 'REFERENCE_NOT_FOUND', error: 'Reference not found' };
        }

        // Check if already has a document
        const existingLink = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
        });
        if (existingLink) {
            return { success: false, errorCode: 'ALREADY_ATTACHED', error: 'Reference already has a PDF attached' };
        }

        const validatedUrl = this.validateExternalPdfUrl(pdfUrl);
        if (!validatedUrl) {
            return { success: false, errorCode: 'INVALID_URL', error: 'Invalid or unsafe PDF URL' };
        }

        try {
            const downloadResult = await this.downloadPdfBufferFromUrlWithFallback(validatedUrl);
            if (!downloadResult.success) {
                return {
                    success: false,
                    errorCode: downloadResult.errorCode,
                    error: downloadResult.error,
                };
            }

            const pdfBuffer = downloadResult.buffer;

            const validationError = this.validateFile(pdfBuffer, 'downloaded.pdf');
            if (validationError) {
                return { success: false, errorCode: validationError.includes('valid PDF') ? 'NOT_PDF' : 'DOWNLOAD_FAILED', error: validationError };
            }

            // Check for duplicate by hash
            const fileHash = this.computeHash(pdfBuffer);
            const existingDoc = await prisma.referenceDocument.findUnique({
                where: { fileHash },
            });

            if (existingDoc) {
                const link = await prisma.referenceDocumentLink.create({
                    data: {
                        referenceId,
                        documentId: existingDoc.id,
                        isPrimary: true,
                        linkedBy: userId,
                    },
                });

                return {
                    success: true,
                    document: existingDoc,
                    link,
                    oaUrl: downloadResult.resolvedUrl,
                };
            }

            // Store file
            const userDir = this.ensureUserDir(userId);
            const docId = crypto.randomUUID().replace(/-/g, '');
            const storagePath = path.join(userDir, `${docId}.pdf`);
            fs.writeFileSync(storagePath, pdfBuffer);

            const sourceIdentifier = options.sourceIdentifier?.trim() || downloadResult.resolvedUrl;
            const filenameBase = (options.originalFilenameHint || sourceIdentifier || 'reference')
                .replace(/[/\\]/g, '_')
                .trim();
            const originalFilename = `${filenameBase || 'reference'}.pdf`;

            // Create record
            const document = await prisma.referenceDocument.create({
                data: {
                    userId,
                    storagePath,
                    originalFilename,
                    fileHash,
                    fileSizeBytes: pdfBuffer.length,
                    mimeType: 'application/pdf',
                    sourceType: options.sourceType || 'URL_IMPORT',
                    sourceIdentifier,
                    status: 'UPLOADED',
                },
            });

            // Create link
            const link = await prisma.referenceDocumentLink.create({
                data: {
                    referenceId,
                    documentId: document.id,
                    isPrimary: true,
                    linkedBy: userId,
                },
            });

            // Start async parsing
            this.processDocumentAsync(document.id);

            return {
                success: true,
                document,
                link,
                oaUrl: downloadResult.resolvedUrl,
            };
        } catch (error: any) {
            return {
                success: false,
                errorCode: 'DOWNLOAD_FAILED',
                error: `Failed to import PDF from URL: ${error?.message || 'Unknown error'}`,
            };
        }
    }

    /**
     * Fetch an OA PDF for a DOI via Unpaywall and attach to a reference.
     */
    async fetchOAPdfByDOI(
        userId: string,
        referenceId: string,
        doi: string
    ): Promise<FetchOAResult> {
        // Verify reference exists and belongs to user
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) {
            return { success: false, error: 'Reference not found' };
        }

        // Check if already has a document
        const existingLink = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
        });
        if (existingLink) {
            return { success: false, error: 'Reference already has a PDF attached' };
        }

        if (!UNPAYWALL_EMAIL) {
            return {
                success: false,
                error: 'Unpaywall integration not configured. Set UNPAYWALL_EMAIL in environment variables.',
            };
        }

        // Clean DOI
        const cleanDoi = this.cleanDOI(doi);
        if (!cleanDoi) {
            return { success: false, error: 'Invalid DOI format' };
        }

        try {
            // Query Unpaywall
            const unpayResponse = await fetch(
                `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`,
                { headers: { 'User-Agent': `Papsi/1.0 (${UNPAYWALL_EMAIL})` } }
            );

            if (!unpayResponse.ok) {
                if (unpayResponse.status === 404) {
                    return { success: false, error: 'DOI not found in Unpaywall database' };
                }
                return { success: false, error: `Unpaywall API error: ${unpayResponse.status}` };
            }

            const unpayData = await unpayResponse.json();

            // Find best OA PDF URL
            let pdfUrl: string | null = null;

            // Check best_oa_location first
            if (unpayData.best_oa_location?.url_for_pdf) {
                pdfUrl = unpayData.best_oa_location.url_for_pdf;
            }

            // Fallback: check all OA locations
            if (!pdfUrl && unpayData.oa_locations) {
                for (const loc of unpayData.oa_locations) {
                    if (loc.url_for_pdf) {
                        pdfUrl = loc.url_for_pdf;
                        break;
                    }
                }
            }

            if (!pdfUrl) {
                return {
                    success: false,
                    error: 'No open access PDF available for this DOI. You can upload the PDF manually if you have access.',
                };
            }

            // Download the PDF
            const pdfResponse = await fetch(pdfUrl, {
                headers: {
                    'User-Agent': 'Papsi/1.0 Academic Research Tool',
                    'Accept': 'application/pdf',
                },
                redirect: 'follow',
            });

            if (!pdfResponse.ok) {
                return { success: false, error: `Failed to download PDF from ${pdfUrl}` };
            }

            const contentType = pdfResponse.headers.get('content-type') || '';
            if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
                return { success: false, error: 'The URL did not return a PDF file' };
            }

            const arrayBuffer = await pdfResponse.arrayBuffer();
            const pdfBuffer = Buffer.from(arrayBuffer);

            // Validate it's actually a PDF
            const header = pdfBuffer.slice(0, 5).toString('ascii');
            if (header !== '%PDF-') {
                return { success: false, error: 'Downloaded file is not a valid PDF' };
            }

            // Check for duplicate by hash
            const fileHash = this.computeHash(pdfBuffer);
            const existingDoc = await prisma.referenceDocument.findUnique({
                where: { fileHash },
            });

            if (existingDoc) {
                // Link existing document
                const link = await prisma.referenceDocumentLink.create({
                    data: {
                        referenceId,
                        documentId: existingDoc.id,
                        isPrimary: true,
                        linkedBy: userId,
                    },
                });

                return {
                    success: true,
                    document: existingDoc,
                    link,
                    oaUrl: pdfUrl,
                };
            }

            // Store file
            const userDir = this.ensureUserDir(userId);
            const docId = crypto.randomUUID().replace(/-/g, '');
            const storagePath = path.join(userDir, `${docId}.pdf`);
            fs.writeFileSync(storagePath, pdfBuffer);

            // Create record
            const document = await prisma.referenceDocument.create({
                data: {
                    userId,
                    storagePath,
                    originalFilename: `${cleanDoi.replace(/[/\\]/g, '_')}.pdf`,
                    fileHash,
                    fileSizeBytes: pdfBuffer.length,
                    mimeType: 'application/pdf',
                    sourceType: 'DOI_FETCH',
                    sourceIdentifier: cleanDoi,
                    status: 'UPLOADED',
                },
            });

            // Create link
            const link = await prisma.referenceDocumentLink.create({
                data: {
                    referenceId,
                    documentId: document.id,
                    isPrimary: true,
                    linkedBy: userId,
                },
            });

            // Start async parsing
            this.processDocumentAsync(document.id);

            return {
                success: true,
                document,
                link,
                oaUrl: pdfUrl,
            };
        } catch (error: any) {
            return {
                success: false,
                error: `Failed to fetch OA PDF: ${error?.message || 'Unknown error'}`,
            };
        }
    }

    // ============================================================================
    // SERVE FILE
    // ============================================================================

    /**
     * Get the file path for serving a document to the user.
     * Verifies ownership.
     */
    async getDocumentFilePath(userId: string, documentId: string): Promise<string | null> {
        const doc = await prisma.referenceDocument.findFirst({
            where: {
                id: documentId,
                OR: [
                    { userId },
                    {
                        references: {
                            some: {
                                reference: {
                                    userId,
                                    isActive: true,
                                },
                            },
                        },
                    },
                ],
            },
            select: { storagePath: true },
        });

        if (!doc || !fs.existsSync(doc.storagePath)) {
            return null;
        }

        return doc.storagePath;
    }

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Adaptive async processing: basic PDF parse → structured extraction → notify deep-analysis pipeline.
     *
     * After structured sections are queued, looks up whether the document is linked to
     * any DEEP_* classified citation.  If so, log it so operators know the paper
     * will be ready for evidence extraction without user intervention.
     */
    private processDocumentAsync(documentId: string): void {
        setImmediate(async () => {
            try {
                await pdfParserService.processDocument(documentId);
                await pdfMatchVerificationService.verifyDocumentLinks(documentId, 'post-pdf-parser');
                if (ENABLE_REFERENCE_PDF_PROACTIVE_PARSING) {
                    proactiveParsingService.triggerForDocument(documentId, 'pdf-upload');
                }

                const links = await prisma.referenceDocumentLink.findMany({
                    where: { documentId, isPrimary: true },
                    select: { referenceId: true },
                });
                const referenceIds = links.map(l => l.referenceId);
                if (referenceIds.length > 0) {
                    const DEEP_LABELS = new Set(['DEEP_ANCHOR', 'DEEP_SUPPORT', 'DEEP_STRESS_TEST']);
                    const linkedCitations = await prisma.citation.findMany({
                        where: {
                            libraryReferenceId: { in: referenceIds },
                            isActive: true,
                        },
                        select: { id: true, citationKey: true, deepAnalysisLabel: true, aiMeta: true },
                    });

                    const deepCitations = linkedCitations.filter(c => {
                        if (c.deepAnalysisLabel && DEEP_LABELS.has(c.deepAnalysisLabel)) return true;
                        const rec = (c.aiMeta as any)?.deepAnalysisRecommendation;
                        return typeof rec === 'string' && DEEP_LABELS.has(rec);
                    });

                    if (deepCitations.length > 0) {
                        const labels = deepCitations.map(c => {
                            const label = c.deepAnalysisLabel || (c.aiMeta as any)?.deepAnalysisRecommendation || 'DEEP';
                            return `${c.citationKey ?? c.id}[${label}]`;
                        }).join(', ');
                        console.log(`[RefDocService] PDF for ${deepCitations.length} DEEP citation(s) uploaded — PDF.js parsing queued: ${labels}`);
                    }
                }
            } catch (error) {
                console.error(`[RefDocService] Async processing failed for ${documentId}:`, error);
            }
        });
    }

    /**
     * Validate external PDF URL to reduce SSRF risk.
     */
    private validateExternalPdfUrl(candidate: string): string | null {
        if (!candidate || typeof candidate !== 'string') return null;

        let parsed: URL;
        try {
            parsed = new URL(candidate.trim());
        } catch {
            return null;
        }

        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return null;
        }

        if (this.isPrivateOrLocalAddress(parsed.hostname)) {
            return null;
        }

        return parsed.toString();
    }

    private isPrivateOrLocalAddress(hostnameRaw: string): boolean {
        const hostname = (hostnameRaw || '').trim().toLowerCase();
        if (!hostname) return true;

        if (
            hostname === 'localhost' ||
            hostname === '0.0.0.0' ||
            hostname === '::1' ||
            hostname.endsWith('.local')
        ) {
            return true;
        }

        const ipType = net.isIP(hostname);
        if (ipType === 0) {
            return false;
        }

        if (ipType === 4) {
            if (
                hostname.startsWith('10.') ||
                hostname.startsWith('127.') ||
                hostname.startsWith('192.168.') ||
                hostname.startsWith('169.254.')
            ) {
                return true;
            }

            const octets = hostname.split('.').map(part => parseInt(part, 10));
            if (octets.length === 4) {
                const second = octets[1];
                // 172.16.0.0 - 172.31.255.255
                if (octets[0] === 172 && Number.isFinite(second) && second >= 16 && second <= 31) {
                    return true;
                }
                // 100.64.0.0 - 100.127.255.255 (carrier-grade NAT)
                if (octets[0] === 100 && Number.isFinite(second) && second >= 64 && second <= 127) {
                    return true;
                }
            }

            return false;
        }

        // IPv6 local / link-local / unique local
        if (
            hostname === '::1' ||
            hostname.startsWith('fe80:') ||
            hostname.startsWith('fc') ||
            hostname.startsWith('fd')
        ) {
            return true;
        }

        return false;
    }

    private async downloadPdfBufferFromUrlWithFallback(
        candidateUrl: string,
        visited: Set<string> = new Set(),
        depth = 0
    ): Promise<
        | { success: true; buffer: Buffer; resolvedUrl: string }
        | { success: false; errorCode: 'NOT_PDF' | 'DOWNLOAD_FAILED'; error: string }
    > {
        if (depth > MAX_PDF_DISCOVERY_DEPTH) {
            return {
                success: false,
                errorCode: 'NOT_PDF',
                error: 'Could not find a direct PDF file in the provided URL',
            };
        }

        const safeUrl = this.validateExternalPdfUrl(candidateUrl);
        if (!safeUrl) {
            return {
                success: false,
                errorCode: 'DOWNLOAD_FAILED',
                error: 'Resolved URL is invalid or unsafe',
            };
        }

        if (visited.has(safeUrl)) {
            return {
                success: false,
                errorCode: 'NOT_PDF',
                error: 'Could not find a direct PDF file in the provided URL',
            };
        }
        visited.add(safeUrl);

        const fetchResult = await this.fetchWithCookieRedirects(safeUrl);
        if (!fetchResult.success) {
            return {
                success: false,
                errorCode: 'DOWNLOAD_FAILED',
                error: fetchResult.error,
            };
        }
        const response = fetchResult.response;

        if (!response.ok) {
            return {
                success: false,
                errorCode: 'DOWNLOAD_FAILED',
                error: `Failed to fetch URL (HTTP ${response.status})`,
            };
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > 0 && contentLength > this.maxFileSizeBytes) {
            return {
                success: false,
                errorCode: 'DOWNLOAD_FAILED',
                error: `File exceeds maximum size of ${DEFAULT_MAX_FILE_SIZE_MB}MB`,
            };
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const finalUrl = fetchResult.finalUrl || response.url || safeUrl;

        if (this.isLikelyPdfContentType(contentType) || this.hasPdfSignature(buffer)) {
            return {
                success: true,
                buffer,
                resolvedUrl: finalUrl,
            };
        }

        if (!this.isLikelyHtmlPayload(contentType, buffer)) {
            return {
                success: false,
                errorCode: 'NOT_PDF',
                error: 'The URL did not return a PDF file',
            };
        }

        const html = buffer.toString('utf8', 0, Math.min(buffer.length, 1_000_000));
        const candidates = this.extractPdfCandidateUrlsFromHtml(html, finalUrl);

        for (const candidate of candidates) {
            const nested = await this.downloadPdfBufferFromUrlWithFallback(candidate, visited, depth + 1);
            if (nested.success) {
                return nested;
            }
        }

        return {
            success: false,
            errorCode: 'NOT_PDF',
            error: 'The provided URL is not a direct PDF and no downloadable PDF link was found on the page',
        };
    }

    private buildPdfFetchHeaders(): Record<string, string> {
        return {
            'User-Agent': 'Papsi/1.0 Academic Research Tool',
            'Accept': 'application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        };
    }

    private isLikelyPdfContentType(contentType: string): boolean {
        const normalized = (contentType || '').toLowerCase();
        return normalized.includes('application/pdf') || normalized.includes('application/octet-stream');
    }

    private hasPdfSignature(buffer: Buffer): boolean {
        if (!buffer || buffer.length < 5) return false;
        return buffer.slice(0, 5).toString('ascii') === '%PDF-';
    }

    private isLikelyHtmlPayload(contentType: string, buffer: Buffer): boolean {
        const normalized = (contentType || '').toLowerCase();
        if (normalized.includes('text/html') || normalized.includes('application/xhtml+xml')) {
            return true;
        }

        const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 512)).trim().toLowerCase();
        return (
            preview.startsWith('<!doctype html') ||
            preview.startsWith('<html') ||
            preview.startsWith('<script') ||
            preview.startsWith('<apm_do_not_touch>')
        );
    }

    private extractPdfCandidateUrlsFromHtml(html: string, baseUrl: string): string[] {
        const primaryCandidates: string[] = [];
        const secondaryCandidates: string[] = [];
        const seen = new Set<string>();

        const addCandidate = (raw: string, priority: 'primary' | 'secondary' = 'secondary') => {
            if (!raw || typeof raw !== 'string') return;

            const decoded = raw
                .trim()
                .replace(/\\u0026/gi, '&')
                .replace(/\\u003d/gi, '=')
                .replace(/\\u002f/gi, '/')
                .replace(/\\\//g, '/')
                .replace(/&amp;/gi, '&')
                .replace(/&quot;/gi, '"')
                .replace(/&#39;/gi, "'");
            if (!decoded) return;

            let absoluteUrl: string;
            try {
                absoluteUrl = new URL(decoded, baseUrl).toString();
            } catch {
                return;
            }

            const safe = this.validateExternalPdfUrl(absoluteUrl);
            if (!safe || seen.has(safe)) return;
            seen.add(safe);
            if (priority === 'primary') {
                primaryCandidates.push(safe);
            } else {
                secondaryCandidates.push(safe);
            }
        };

        const signals = ['.pdf', '/pdf/', 'pdf=', 'downloadpdf', 'stamppdf/getpdf.jsp'];
        const looksLikePdfTarget = (value: string): boolean => {
            const normalized = value.toLowerCase();
            return signals.some(signal => normalized.includes(signal));
        };
        const hasPdfActionSignal = (value: string): boolean => {
            const normalized = value
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            if (!normalized) return false;
            return (
                normalized.includes(' pdf') ||
                normalized.startsWith('pdf') ||
                normalized.includes('view pdf') ||
                normalized.includes('download pdf') ||
                normalized.includes('full text') ||
                normalized.includes('full-text') ||
                normalized.includes('full article') ||
                normalized.includes('download article')
            );
        };
        const readAttr = (attrs: string, attrName: string): string => {
            const match = attrs.match(new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i'));
            return match?.[1] || '';
        };
        const extractUrlsFromInlineScript = (value: string): string[] => {
            if (!value) return [];
            const urls: string[] = [];
            const regex = /['"]((?:https?:\/\/|\/)[^'"]+)['"]/gi;
            for (const match of Array.from(value.matchAll(regex))) {
                if (typeof match[1] === 'string' && match[1].trim()) {
                    urls.push(match[1].trim());
                }
            }
            return urls;
        };

        const metaRegex = /<meta[^>]+(?:name|property)\s*=\s*["']citation_pdf_url["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi;
        for (const match of Array.from(html.matchAll(metaRegex))) {
            addCandidate(match[1] || '', 'primary');
        }

        const linkPdfRegex = /<link[^>]+type\s*=\s*["']application\/pdf["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
        for (const match of Array.from(html.matchAll(linkPdfRegex))) {
            addCandidate(match[1] || '', 'primary');
        }

        const attrRegex = /<(?:iframe|embed|object|a)[^>]+(?:src|href|data)\s*=\s*["']([^"']+)["'][^>]*>/gi;
        for (const match of Array.from(html.matchAll(attrRegex))) {
            const value = match[1] || '';
            if (looksLikePdfTarget(value)) {
                addCandidate(value, 'primary');
            }
        }

        const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        for (const match of Array.from(html.matchAll(anchorRegex))) {
            const attrs = match[1] || '';
            const innerText = (match[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const href = readAttr(attrs, 'href');
            const title = readAttr(attrs, 'title');
            const ariaLabel = readAttr(attrs, 'aria-label');
            const label = `${innerText} ${title} ${ariaLabel}`.trim();
            const looksLikePdfLabel = hasPdfActionSignal(label);
            const looksLikePdfHref = looksLikePdfTarget(href);

            if (href && (looksLikePdfLabel || looksLikePdfHref)) {
                addCandidate(href, looksLikePdfHref ? 'primary' : 'secondary');
            }

            if (looksLikePdfLabel) {
                const onclick = readAttr(attrs, 'onclick');
                for (const url of extractUrlsFromInlineScript(onclick)) {
                    addCandidate(url, 'secondary');
                }
            }
        }

        const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
        for (const match of Array.from(html.matchAll(buttonRegex))) {
            const attrs = match[1] || '';
            const innerText = (match[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const title = readAttr(attrs, 'title');
            const ariaLabel = readAttr(attrs, 'aria-label');
            const label = `${innerText} ${title} ${ariaLabel}`.trim();
            if (!hasPdfActionSignal(label)) {
                continue;
            }

            const dataHref = readAttr(attrs, 'data-href');
            const dataUrl = readAttr(attrs, 'data-url');
            const formAction = readAttr(attrs, 'formaction');
            const onclick = readAttr(attrs, 'onclick');

            if (dataHref) addCandidate(dataHref, looksLikePdfTarget(dataHref) ? 'primary' : 'secondary');
            if (dataUrl) addCandidate(dataUrl, looksLikePdfTarget(dataUrl) ? 'primary' : 'secondary');
            if (formAction) addCandidate(formAction, looksLikePdfTarget(formAction) ? 'primary' : 'secondary');
            for (const url of extractUrlsFromInlineScript(onclick)) {
                addCandidate(url, looksLikePdfTarget(url) ? 'primary' : 'secondary');
            }
        }

        const jsonKeyRegex = /"(?:citation_pdf_url|pdfUrl|pdf_url|url_for_pdf|downloadUrl|fullTextPdfUrl|contentUrl|pdfLink)"\s*:\s*"([^"]+)"/gi;
        for (const match of Array.from(html.matchAll(jsonKeyRegex))) {
            addCandidate(match[1] || '', 'primary');
        }

        const jsonUrlRegex = /"url"\s*:\s*"([^"]+)"/gi;
        for (const match of Array.from(html.matchAll(jsonUrlRegex))) {
            const value = match[1] || '';
            if (looksLikePdfTarget(value)) {
                addCandidate(value, 'primary');
            }
        }

        const absoluteRegex = /https?:\/\/[^\s"'<>]+/gi;
        for (const match of Array.from(html.matchAll(absoluteRegex))) {
            const value = match[0] || '';
            if (looksLikePdfTarget(value)) {
                addCandidate(value, 'primary');
            }
        }

        const ieeeStampRegex = /(?:\/?stampPDF\/getPDF\.jsp\?[^\s"'<>]+)/gi;
        for (const match of Array.from(html.matchAll(ieeeStampRegex))) {
            addCandidate(match[0] || '', 'primary');
        }

        const merged = [...primaryCandidates, ...secondaryCandidates];
        if (merged.length > MAX_HTML_PDF_CANDIDATES) {
            return merged.slice(0, MAX_HTML_PDF_CANDIDATES);
        }

        return merged;
    }

    private sleep(ms: number): Promise<void> {
        if (!Number.isFinite(ms) || ms <= 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private getDomainKey(urlValue: string): string | null {
        try {
            const parsed = new URL(urlValue);
            return parsed.hostname.trim().toLowerCase() || null;
        } catch {
            return null;
        }
    }

    private getOrCreateDomainFetchState(domainKey: string): DomainFetchState {
        const existing = DOMAIN_FETCH_STATE.get(domainKey);
        if (existing) {
            return existing;
        }
        const created: DomainFetchState = {
            tail: Promise.resolve(),
            nextAllowedAt: 0,
            cooldownUntil: 0,
            penaltyLevel: 0,
        };
        DOMAIN_FETCH_STATE.set(domainKey, created);
        return created;
    }

    private async withDomainThrottle<T>(
        urlValue: string,
        task: () => Promise<T>
    ): Promise<T> {
        const domainKey = this.getDomainKey(urlValue);
        if (!domainKey) {
            return task();
        }

        const state = this.getOrCreateDomainFetchState(domainKey);
        const previousTail = state.tail;
        let resolveCurrent: (() => void) | undefined;
        state.tail = new Promise<void>(resolve => {
            resolveCurrent = () => resolve();
        });

        await previousTail;
        try {
            const now = Date.now();
            const waitMs = Math.max(
                0,
                state.nextAllowedAt - now,
                state.cooldownUntil - now
            );
            if (waitMs > 0) {
                await this.sleep(waitMs);
            }

            state.nextAllowedAt = Date.now() + DOMAIN_FETCH_MIN_INTERVAL_MS;
            return await task();
        } finally {
            if (resolveCurrent) {
                resolveCurrent();
            }
        }
    }

    private parseRetryAfterMs(retryAfterHeader: string | null): number | null {
        if (!retryAfterHeader) return null;
        const value = retryAfterHeader.trim();
        if (!value) return null;

        if (/^\d+$/.test(value)) {
            const seconds = parseInt(value, 10);
            if (!Number.isFinite(seconds) || seconds < 0) return null;
            return Math.min(seconds * 1000, DOMAIN_FETCH_COOLDOWN_MAX_MS);
        }

        const target = new Date(value).getTime();
        if (!Number.isFinite(target)) return null;
        const delta = target - Date.now();
        if (delta <= 0) return null;
        return Math.min(delta, DOMAIN_FETCH_COOLDOWN_MAX_MS);
    }

    private isRateLimitedOrBlockedStatus(status: number): boolean {
        return status === 403 || status === 429 || status === 503;
    }

    private noteDomainRateLimited(
        urlValue: string,
        status: number,
        retryAfterMs: number | null
    ): number {
        const domainKey = this.getDomainKey(urlValue);
        if (!domainKey) {
            return Math.max(1000, retryAfterMs || DOMAIN_FETCH_COOLDOWN_BASE_MS);
        }

        const state = this.getOrCreateDomainFetchState(domainKey);
        state.penaltyLevel = Math.min(state.penaltyLevel + 1, 8);

        const computedBackoff = Math.min(
            DOMAIN_FETCH_COOLDOWN_BASE_MS * Math.pow(2, state.penaltyLevel - 1),
            DOMAIN_FETCH_COOLDOWN_MAX_MS
        );
        const cooldownMs = Math.max(retryAfterMs || 0, computedBackoff);
        state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + cooldownMs);

        console.warn(
            `[RefDocService] Domain throttle raised for ${domainKey} after HTTP ${status}. Cooldown=${Math.ceil(cooldownMs / 1000)}s, penalty=${state.penaltyLevel}`
        );
        return cooldownMs;
    }

    private noteDomainSuccess(urlValue: string): void {
        const domainKey = this.getDomainKey(urlValue);
        if (!domainKey) return;

        const state = this.getOrCreateDomainFetchState(domainKey);
        state.penaltyLevel = Math.max(0, state.penaltyLevel - 1);
        if (state.penaltyLevel === 0 && state.cooldownUntil < Date.now()) {
            state.cooldownUntil = 0;
        }
    }

    private noteDomainTransportError(urlValue: string): void {
        const domainKey = this.getDomainKey(urlValue);
        if (!domainKey) return;

        const state = this.getOrCreateDomainFetchState(domainKey);
        state.penaltyLevel = Math.min(state.penaltyLevel + 1, 8);
        const cooldownMs = Math.min(DOMAIN_FETCH_COOLDOWN_BASE_MS, DOMAIN_FETCH_COOLDOWN_MAX_MS);
        state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + Math.floor(cooldownMs / 2));
    }

    private async fetchWithCookieRedirects(
        initialUrl: string,
        maxRedirects = 8
    ): Promise<
        | { success: true; response: Response; finalUrl: string }
        | { success: false; error: string }
    > {
        const cookieJar = new Map<string, string>();
        let currentUrl = initialUrl;
        let rateLimitRetryCount = 0;

        for (let i = 0; i <= maxRedirects; i++) {
            const headers = this.buildPdfFetchHeaders();
            const cookieHeader = this.serializeCookieJar(cookieJar);
            if (cookieHeader) {
                headers.Cookie = cookieHeader;
            }

            let response: Response;
            try {
                response = await this.withDomainThrottle(currentUrl, async () => {
                    return fetch(currentUrl, {
                        headers,
                        redirect: 'manual',
                    });
                });
            } catch (error: any) {
                this.noteDomainTransportError(currentUrl);
                return {
                    success: false,
                    error: error?.message || `Failed to fetch URL ${currentUrl}`,
                };
            }

            this.captureResponseCookies(response.headers, cookieJar);

            if (this.isRateLimitedOrBlockedStatus(response.status)) {
                const retryAfterMs = this.parseRetryAfterMs(response.headers.get('retry-after'));
                const cooldownMs = this.noteDomainRateLimited(currentUrl, response.status, retryAfterMs);

                if (rateLimitRetryCount < DOMAIN_FETCH_RATE_LIMIT_RETRIES) {
                    rateLimitRetryCount += 1;
                    const waitMs = Math.max(1000, retryAfterMs || Math.min(cooldownMs, DOMAIN_FETCH_COOLDOWN_MAX_MS));
                    await this.sleep(waitMs);
                    continue;
                }

                const domain = this.getDomainKey(currentUrl) || 'unknown-host';
                return {
                    success: false,
                    error: `Domain ${domain} is rate-limiting or blocking requests (HTTP ${response.status})`,
                };
            }

            this.noteDomainSuccess(currentUrl);
            rateLimitRetryCount = 0;

            if (!this.isRedirectStatus(response.status)) {
                return {
                    success: true,
                    response,
                    finalUrl: response.url || currentUrl,
                };
            }

            const location = response.headers.get('location');
            if (!location) {
                return {
                    success: false,
                    error: `Failed to follow redirect for URL ${currentUrl}`,
                };
            }

            let nextUrl: string;
            try {
                nextUrl = new URL(location, currentUrl).toString();
            } catch {
                return {
                    success: false,
                    error: `Invalid redirect URL returned by ${currentUrl}`,
                };
            }

            const validatedNext = this.validateExternalPdfUrl(nextUrl);
            if (!validatedNext) {
                return {
                    success: false,
                    error: 'Resolved redirect URL is invalid or unsafe',
                };
            }

            currentUrl = validatedNext;
        }

        return {
            success: false,
            error: `Too many redirects while fetching ${initialUrl}`,
        };
    }

    private isRedirectStatus(status: number): boolean {
        return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
    }

    private serializeCookieJar(cookieJar: Map<string, string>): string {
        if (!cookieJar || cookieJar.size === 0) return '';
        return Array.from(cookieJar.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }

    private captureResponseCookies(headers: Headers, cookieJar: Map<string, string>): void {
        const setCookieHeaders = this.readSetCookieHeaders(headers);
        for (const line of setCookieHeaders) {
            const trimmed = (line || '').trim();
            if (!trimmed) continue;
            const match = trimmed.match(/^([^=;\s]+)=([^;]*)/);
            if (!match) continue;
            const cookieName = match[1];
            const cookieValue = match[2];
            if (!cookieName) continue;
            cookieJar.set(cookieName, cookieValue);
        }
    }

    private readSetCookieHeaders(headers: Headers): string[] {
        const anyHeaders = headers as any;
        if (typeof anyHeaders.getSetCookie === 'function') {
            const values = anyHeaders.getSetCookie();
            if (Array.isArray(values)) {
                return values.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0);
            }
        }

        const combined = headers.get('set-cookie');
        if (!combined) {
            return [];
        }

        // Split cookie list while preserving commas inside Expires attributes.
        return combined
            .split(/,(?=[^;,]+=)/g)
            .map(part => part.trim())
            .filter(Boolean);
    }

    /**
     * Clean and validate DOI format.
     */
    private cleanDOI(doi: string): string | null {
        if (!doi || typeof doi !== 'string') return null;

        let cleaned = doi.trim()
            .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
            .replace(/^doi:/i, '')
            .trim();

        if (/^10\.\d{4,9}\/[^\s]+$/i.test(cleaned)) {
            return cleaned;
        }

        return null;
    }
}

export const referenceDocumentService = new ReferenceDocumentService();
