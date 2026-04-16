import * as crypto from 'crypto';
import { CitationSourceType } from '@prisma/client';
import { prisma } from '../prisma';
import { referenceConnectorService } from './reference-connector-service';
import {
  normalizeDoi as normalizeDoiValue,
  normalizeIdentifier,
  normalizeSearchText,
} from '../utils/reference-matching-normalization';

type SuppressionType = 'SUPPLEMENTARY' | 'ERRATUM' | 'EDITORIAL' | 'COMMENTARY' | 'RETRACTION' | null;
type CandidateConfidence = 'auto_high' | 'auto_guarded' | 'review' | 'low';

type ReferenceRecord = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  arxivId: string | null;
  sourceType: CitationSourceType;
  citationKey: string | null;
  externalId: string | null;
  pdfUrl: string | null;
  attachmentHints: string[];
};

type DocumentRecord = {
  id: string;
  originalFilename: string;
  sourceIdentifier: string | null;
  status: string;
  pdfTitle: string | null;
  pdfAuthors: string | null;
  pdfDoi: string | null;
  parsedText: string | null;
};

type ObservedDocumentProfile = {
  documentId: string;
  originalFilename: string;
  filenameNormalized: string;
  sourceIdentifierNormalized: string | null;
  title: string | null;
  titleTokens: Set<string>;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  arxivId: string | null;
  authorLastNames: Set<string>;
  yearHints: Set<number>;
  venueSignals: Set<string>;
  filenameTokens: Set<string>;
  suppressionType: SuppressionType;
  textSample: string;
};

type ResolvedDoiMetadata = {
  doi: string;
  titleNormalized: string;
  titleTokens: Set<string>;
  authors: Set<string>;
  year: number | null;
};

type ScoredCandidate = {
  documentId: string;
  referenceId: string;
  score: number;
  confidence: CandidateConfidence;
  titleSimilarity: number;
  authorOverlap: number;
  hardConflict: boolean;
  hardConflictReason?: string;
  suppressionType: SuppressionType;
  reasons: string[];
  marginToNext?: number;
};

export interface ReconciliationProviders {
  mendeleyAccessToken?: string;
  zoteroApiKey?: string;
  zoteroUserId?: string;
  zoteroGroupId?: string;
}

export interface ReconcileLibraryOptions {
  userId: string;
  actorUserId?: string;
  tenantId?: string | null;
  referenceIds?: string[];
  documentIds?: string[];
  applyAutoLinks?: boolean;
  dryRun?: boolean;
  providers?: ReconciliationProviders;
  referenceAttachmentHints?: Record<string, string[]>;
  batchId?: string;
  includeAlreadyLinkedDocuments?: boolean;
}

export interface ReconciliationCandidate {
  documentId: string;
  referenceId: string;
  score: number;
  confidence: CandidateConfidence;
  titleSimilarity: number;
  authorOverlap: number;
  hardConflict: boolean;
  hardConflictReason?: string;
  suppressionType: SuppressionType;
  reasons: string[];
  marginToNext: number;
}

export interface ReconciliationReviewItem {
  documentId: string;
  reason: string;
  topCandidates: ReconciliationCandidate[];
}

export interface ReconciliationAppliedLink {
  documentId: string;
  referenceId: string;
  score: number;
  confidence: CandidateConfidence;
  auditLogId?: string;
}

export interface ReconciliationRunResult {
  batchId: string;
  evaluatedDocuments: number;
  evaluatedReferences: number;
  autoLinked: ReconciliationAppliedLink[];
  reviewQueue: ReconciliationReviewItem[];
  unmatchedDocumentIds: string[];
  skippedByHardConflict: Array<{ documentId: string; reason: string }>;
}

export interface RollbackResult {
  batchId: string;
  reverted: number;
  errors: string[];
}

type LinkAuditAction = 'LIBRARY_REFERENCE_AUTO_LINKED' | 'LIBRARY_REFERENCE_MANUAL_LINKED';

const DOI_REGEX = /(?:doi[:\s]+|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s,;)}\]]+)/ig;
const PMID_REGEX = /\bpmid[:\s#]*([0-9]{6,9})\b/i;
const PMCID_REGEX = /\bpmcid[:\s#]*(pmc[0-9]{4,})\b/i;
const ARXIV_REGEX = /\barxiv[:\s]*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z\-]+\/[0-9]{7}(?:v\d+)?)\b/i;
const YEAR_REGEX = /\b(19\d{2}|20\d{2}|21\d{2})\b/g;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'on', 'for', 'to', 'in', 'at', 'by', 'from', 'with', 'without', 'and', 'or', 'as', 'via', 'using']);
const SUPPLEMENTARY_REGEX = /\b(supplementary|supplemental|supporting\s+information|appendix|appendices)\b/i;
const ERRATUM_REGEX = /\b(erratum|correction|corrigendum|addendum)\b/i;
const EDITORIAL_REGEX = /\b(editorial|editor(?:'s)?\s+note)\b/i;
const COMMENTARY_REGEX = /\b(commentary|response\s+to|letter\s+to\s+the\s+editor)\b/i;
const RETRACTION_REGEX = /\b(retraction|retracted)\b/i;
const SURNAME_PARTICLES = new Set(['da', 'de', 'del', 'della', 'der', 'di', 'du', 'ibn', 'la', 'le', 'van', 'von']);
const MAX_CROSSREF_CONCURRENCY = Math.max(1, Math.min(8, Number.parseInt(String(process.env.CROSSREF_MAX_CONCURRENCY || '4'), 10) || 4));
const CROSSREF_TIMEOUT_MS = Math.max(2000, Number.parseInt(String(process.env.CROSSREF_TIMEOUT_MS || '6000'), 10) || 6000);
const CROSSREF_RETRIES = Math.max(0, Math.min(2, Number.parseInt(String(process.env.CROSSREF_RETRIES || '1'), 10) || 1));

function normalizeText(value: unknown): string {
  return normalizeSearchText(value);
}

function normalizeDoi(value: unknown): string | null {
  return normalizeDoiValue(value);
}

function tokenizeTitle(value: string): Set<string> {
  return new Set(normalizeText(value).split(' ').map((t) => t.trim()).filter((t) => t.length >= 2 && !TITLE_STOP_WORDS.has(t)));
}

function tokenizeFilename(name: string): Set<string> {
  return tokenizeTitle(String(name || '').replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' '));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let i = 0;
  for (const token of Array.from(a)) if (b.has(token)) i += 1;
  const u = a.size + b.size - i;
  return u > 0 ? i / u : 0;
}

function overlapRatio(expected: Set<string>, observed: Set<string>): number {
  if (expected.size === 0 || observed.size === 0) return 0;
  let overlap = 0;
  for (const token of Array.from(expected)) if (observed.has(token)) overlap += 1;
  return overlap / expected.size;
}

function toAuthorLastNameSet(value: unknown): Set<string> {
  const names: string[] = [];
  if (Array.isArray(value)) for (const item of value) if (typeof item === 'string' && item.trim()) names.push(item.trim());
  if (typeof value === 'string') for (const token of value.replace(/\band\b/gi, ',').split(/[;,]/)) if (token.trim()) names.push(token.trim());
  const set = new Set<string>();
  for (const name of names) {
    const candidate = name.includes(',') ? name.split(',')[0] || name : name;
    const parts = normalizeText(candidate).split(/\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    const last = parts[parts.length - 1];
    if (last) set.add(last);

    if (parts.length >= 2) {
      const secondLast = parts[parts.length - 2];
      if (secondLast && secondLast.length >= 2 && !SURNAME_PARTICLES.has(secondLast)) {
        set.add(secondLast);
      }
    }

    const compound: string[] = [last];
    let idx = parts.length - 2;
    while (idx >= 0 && SURNAME_PARTICLES.has(parts[idx])) {
      compound.unshift(parts[idx]);
      idx -= 1;
    }
    if (compound.length > 1) {
      set.add(compound.join(' '));
    }
  }
  return set;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

function normalizedEditSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - (distance / maxLen));
}

function toCandidateConfidence(score: number): CandidateConfidence {
  if (score >= 95) return 'auto_high';
  if (score >= 85) return 'auto_guarded';
  if (score >= 70) return 'review';
  return 'low';
}

function extractLikelyTitleFromText(parsedText: string): string | null {
  const lines = String(parsedText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  let best: { line: string; score: number } | null = null;
  for (const line of lines.slice(0, 40)) {
    if (/^(abstract|keywords?|introduction|copyright|journal|vol(?:ume)?\.?|issue|published|received|accepted)\b/i.test(line)) continue;
    if (line.length < 20 || line.length > 240) continue;
    if (/10\.\d{4,9}\//i.test(line) || /^https?:\/\//i.test(line) || /^www\./i.test(line)) continue;
    if (/^[-\d\s.,;:()]+$/.test(line)) continue;

    const normalized = normalizeText(line);
    const words = normalized.split(' ').filter(Boolean);
    if (words.length < 4 || words.length > 22) continue;

    let score = 0;
    if (words.length >= 6 && words.length <= 18) score += 2;
    if (!/[;|]/.test(line)) score += 1;
    if (line.length >= 35 && line.length <= 180) score += 2;
    if (/^[A-Z]/.test(line)) score += 1;
    if (/[:\-]/.test(line)) score += 0.5;

    if (!best || score > best.score) {
      best = { line, score };
    }
  }
  return best && best.score >= 3 ? best.line : null;
}

function extractIdentifier(regex: RegExp, text: string): string | null {
  const match = String(text || '').slice(0, 100000).match(regex);
  return normalizeIdentifier(match?.[1] || null);
}

function extractFirstDoiFromText(text: string): string | null {
  for (const match of Array.from(String(text || '').slice(0, 160000).matchAll(DOI_REGEX))) {
    const doi = normalizeDoi(match[1]);
    if (doi) return doi;
  }
  return null;
}

function extractYearHints(text: string): Set<number> {
  const set = new Set<number>();
  const source = String(text || '').slice(0, 40000);
  const refMarker = source.search(/\n\s*(references|bibliography|works\s+cited|literature\s+cited)\b/i);
  const sample = refMarker > 2000 ? source.slice(0, refMarker) : source.slice(0, 12000);
  const maxYear = new Date().getUTCFullYear() + 1;
  for (const match of Array.from(sample.matchAll(YEAR_REGEX))) {
    const year = Number.parseInt(match[1], 10);
    if (Number.isFinite(year) && year >= 1900 && year <= maxYear) set.add(year);
    if (set.size >= 20) break;
  }
  return set;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const pattern = `\\b${escapeRegExp(phrase).replace(/\s+/g, '\\s+')}\\b`;
  return new RegExp(pattern, 'i').test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectSuppressionType(...inputs: Array<string | null | undefined>): SuppressionType {
  const corpus = inputs.map((item) => String(item || '').toLowerCase()).join('\n');
  if (!corpus.trim()) return null;
  if (RETRACTION_REGEX.test(corpus)) return 'RETRACTION';
  if (ERRATUM_REGEX.test(corpus)) return 'ERRATUM';
  if (SUPPLEMENTARY_REGEX.test(corpus)) return 'SUPPLEMENTARY';
  if (EDITORIAL_REGEX.test(corpus)) return 'EDITORIAL';
  if (COMMENTARY_REGEX.test(corpus)) return 'COMMENTARY';
  return null;
}

function detectReferenceSuppression(reference: ReferenceRecord): SuppressionType {
  return detectSuppressionType(reference.title, reference.citationKey);
}

function normalizeAttachmentHint(value: string): string | null {
  let normalized = String(value || '')
    .trim()
    .replace(/^file:\/\//i, '')
    .replace(/\\/g, '/')
    .split('?')[0]
    .split('#')[0]
    .replace(/^:+/, '')
    .replace(/\|.*$/g, '')
    .trim()
    .toLowerCase();

  if (!normalized) return null;
  if (normalized.endsWith(':pdf')) {
    normalized = normalized.slice(0, -4).trim();
  }
  if (!normalized) return null;
  return normalized;
}

function basenameOf(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return (parts[parts.length - 1] || normalized).toLowerCase();
}

export class ReferenceReconciliationService {
  private readonly crossrefCache = new Map<string, Promise<ResolvedDoiMetadata | null>>();
  private activeCrossrefRequests = 0;
  private readonly crossrefWaitQueue: Array<() => void> = [];

  async runReconciliation(options: ReconcileLibraryOptions): Promise<ReconciliationRunResult> {
    const batchId = options.batchId || crypto.randomUUID();
    const actorUserId = options.actorUserId || options.userId;
    const applyAutoLinks = options.applyAutoLinks !== false && options.dryRun !== true;
    const attachmentHintsByReferenceId = this.normalizeAttachmentHintMap(options.referenceAttachmentHints);

    const references = await this.loadReferences(options.userId, options.referenceIds, attachmentHintsByReferenceId);
    const documents = await this.loadDocuments(
      options.userId,
      options.documentIds,
      options.includeAlreadyLinkedDocuments !== false
    );

    const scoredByDocument = new Map<string, ScoredCandidate[]>();
    const hardConflicts: Array<{ documentId: string; reason: string }> = [];

    for (const document of documents) {
      const observed = await this.buildObservedProfile(document, options.providers);
      const scored: ScoredCandidate[] = [];
      for (const reference of references) {
        const candidate = await this.evaluateCandidate(reference, observed);
        scored.push(candidate);
      }
      scored.sort((a, b) => b.score - a.score);
      scoredByDocument.set(document.id, scored);
      const hasValidCandidate = scored.some((candidate) => !candidate.hardConflict);
      const firstHardConflict = scored.find((candidate) => candidate.hardConflict);
      if (!hasValidCandidate && firstHardConflict) {
        hardConflicts.push({
          documentId: document.id,
          reason: firstHardConflict.hardConflictReason || 'Hard conflict',
        });
      }
    }

    const selected = this.selectAssignments(scoredByDocument, hardConflicts);

    let applied: ReconciliationAppliedLink[] = [];
    if (applyAutoLinks && selected.autoAssignments.length > 0) {
      applied = await this.applyAssignments({
        userId: options.userId,
        actorUserId,
        tenantId: options.tenantId || null,
        batchId,
        assignments: selected.autoAssignments,
      });
    } else {
      applied = selected.autoAssignments.map((candidate) => ({
        documentId: candidate.documentId,
        referenceId: candidate.referenceId,
        score: candidate.score,
        confidence: candidate.confidence,
      }));
    }

    await prisma.auditLog.create({
      data: {
        actorUserId,
        tenantId: options.tenantId || null,
        action: 'LIBRARY_RECONCILIATION_RUN',
        resource: 'reference_document_link',
        meta: {
          batchId,
          userId: options.userId,
          dryRun: options.dryRun === true,
          applyAutoLinks,
          evaluatedDocuments: documents.length,
          evaluatedReferences: references.length,
          autoLinked: applied.length,
          reviewQueue: selected.reviewQueue.length,
          unmatched: selected.unmatchedDocumentIds.length,
          skippedByHardConflict: selected.skippedByHardConflict.length,
        },
      },
    }).catch(() => undefined);

    return {
      batchId,
      evaluatedDocuments: documents.length,
      evaluatedReferences: references.length,
      autoLinked: applied,
      reviewQueue: selected.reviewQueue,
      unmatchedDocumentIds: selected.unmatchedDocumentIds,
      skippedByHardConflict: selected.skippedByHardConflict,
    };
  }

  async rollbackBatch(input: {
    userId: string;
    actorUserId?: string;
    tenantId?: string | null;
    batchId: string;
  }): Promise<RollbackResult> {
    const batchId = String(input.batchId || '').trim();
    if (!batchId) throw new Error('batchId is required for rollback');

    const actorUserId = input.actorUserId || input.userId;
    let matchedEvents: Array<{ id: string; meta: unknown }> = [];
    let jsonPathFilterSupported = true;
    try {
      matchedEvents = await prisma.auditLog.findMany({
        where: {
          resource: 'reference_document_link',
          action: {
            in: ['LIBRARY_REFERENCE_AUTO_LINKED', 'LIBRARY_REFERENCE_MANUAL_LINKED'],
          },
          AND: [
            { meta: { path: ['batchId'], equals: batchId } },
            { meta: { path: ['userId'], equals: input.userId } },
          ],
        },
        select: { id: true, meta: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
    } catch {
      jsonPathFilterSupported = false;
    }

    // Fallback for deployments that do not support JSON-path filtering in Prisma.
    if (!jsonPathFilterSupported) {
      const fallbackEvents = await prisma.auditLog.findMany({
        where: {
          resource: 'reference_document_link',
          action: {
            in: ['LIBRARY_REFERENCE_AUTO_LINKED', 'LIBRARY_REFERENCE_MANUAL_LINKED'],
          },
        },
        select: { id: true, meta: true },
        orderBy: { createdAt: 'desc' },
        take: 10000,
      });
      matchedEvents = fallbackEvents.filter((event) => {
        const meta = (event.meta || {}) as Record<string, any>;
        return meta?.batchId === batchId && meta?.userId === input.userId;
      });
    }

    const errors: string[] = [];
    let reverted = 0;
    for (const event of matchedEvents) {
      const meta = (event.meta || {}) as Record<string, any>;
      const rollback = (meta.rollback || {}) as Record<string, any>;
      const targetLinkId = String(rollback.targetLinkId || '');
      const referenceId = String(rollback.referenceId || '');
      if (!targetLinkId || !referenceId) {
        errors.push(`Malformed rollback payload in audit event ${event.id}`);
        continue;
      }
      try {
        await this.rollbackSingleAssignment(rollback);
        reverted += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Rollback failed for audit event ${event.id}`);
      }
    }

    await prisma.auditLog.create({
      data: {
        actorUserId,
        tenantId: input.tenantId || null,
        action: 'LIBRARY_REFERENCE_LINK_ROLLBACK',
        resource: 'reference_document_link',
        meta: { batchId, userId: input.userId, reverted, errors },
      },
    }).catch(() => undefined);

    return { batchId, reverted, errors };
  }

  async applyManualLink(input: {
    userId: string;
    actorUserId?: string;
    tenantId?: string | null;
    batchId?: string;
    documentId: string;
    referenceId: string;
    reason?: string;
  }): Promise<{ batchId: string; link: ReconciliationAppliedLink }> {
    const actorUserId = input.actorUserId || input.userId;
    const batchId = String(input.batchId || '').trim() || crypto.randomUUID();
    const reference = (await this.loadReferences(input.userId, [input.referenceId], {}))[0];
    const document = (await this.loadDocuments(input.userId, [input.documentId], true))[0];

    if (!reference) {
      throw new Error('Reference not found for manual link');
    }
    if (!document) {
      throw new Error('Document not found for manual link');
    }

    const observed = await this.buildObservedProfile(document);
    const evaluated = await this.evaluateCandidate(reference, observed);
    if (evaluated.hardConflict) {
      throw new Error(evaluated.hardConflictReason || 'Manual link blocked by hard conflict');
    }

    const applied = await this.applyAssignments({
      userId: input.userId,
      actorUserId,
      tenantId: input.tenantId || null,
      batchId,
      assignments: [{
        documentId: input.documentId,
        referenceId: input.referenceId,
        score: evaluated.score,
        confidence: evaluated.confidence,
        titleSimilarity: evaluated.titleSimilarity,
        authorOverlap: evaluated.authorOverlap,
        hardConflict: false,
        suppressionType: evaluated.suppressionType,
        reasons: [
          ...evaluated.reasons,
          input.reason ? `Manual decision: ${input.reason}` : 'Manual decision applied',
        ],
        marginToNext: evaluated.marginToNext ?? evaluated.score,
      }],
      auditAction: 'LIBRARY_REFERENCE_MANUAL_LINKED',
      decisionMeta: {
        mode: 'manual_link',
        reason: input.reason || null,
      },
    });

    const link = applied[0];
    if (!link) {
      throw new Error('Manual link could not be applied');
    }

    return { batchId, link };
  }

  async recordManualRejection(input: {
    userId: string;
    actorUserId?: string;
    tenantId?: string | null;
    batchId?: string;
    documentId: string;
    referenceId?: string | null;
    reason?: string;
  }): Promise<{ batchId: string }> {
    const actorUserId = input.actorUserId || input.userId;
    const batchId = String(input.batchId || '').trim() || crypto.randomUUID();

    const document = await prisma.referenceDocument.findFirst({
      where: { id: input.documentId, userId: input.userId },
      select: { id: true },
    });
    if (!document) {
      throw new Error('Document not found for rejection');
    }

    await prisma.auditLog.create({
      data: {
        actorUserId,
        tenantId: input.tenantId || null,
        action: 'LIBRARY_REFERENCE_MANUAL_REJECTED',
        resource: 'reference_document_link',
        meta: {
          batchId,
          userId: input.userId,
          documentId: input.documentId,
          referenceId: input.referenceId || null,
          reason: input.reason || 'Manual rejection in review queue',
        },
      },
    });

    return { batchId };
  }

  async getBatchAudit(batchId: string, userId: string) {
    const events = await prisma.auditLog.findMany({
      where: {
        resource: 'reference_document_link',
        OR: [
          { action: 'LIBRARY_RECONCILIATION_RUN' },
          { action: 'LIBRARY_REFERENCE_AUTO_LINKED' },
          { action: 'LIBRARY_REFERENCE_MANUAL_LINKED' },
          { action: 'LIBRARY_REFERENCE_MANUAL_REJECTED' },
          { action: 'LIBRARY_REFERENCE_LINK_ROLLBACK' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    return events.filter((event) => {
      const meta = (event.meta || {}) as Record<string, any>;
      return meta?.batchId === batchId && (!meta?.userId || meta.userId === userId);
    });
  }

  private async loadReferences(
    userId: string,
    referenceIds?: string[],
    attachmentHintsByReferenceId: Record<string, string[]> = {}
  ): Promise<ReferenceRecord[]> {
    const normalizedIds = Array.isArray(referenceIds)
      ? Array.from(new Set(referenceIds.map((id) => String(id || '').trim()).filter(Boolean)))
      : [];

    const records = await prisma.referenceLibrary.findMany({
      where: {
        userId,
        isActive: true,
        ...(normalizedIds.length > 0 ? { id: { in: normalizedIds } } : {}),
      },
      select: {
        id: true,
        title: true,
        authors: true,
        year: true,
        venue: true,
        doi: true,
        pmid: true,
        pmcid: true,
        arxivId: true,
        sourceType: true,
        citationKey: true,
        externalId: true,
        pdfUrl: true,
      },
    });

    return records.map((record) => ({
      ...record,
      attachmentHints: attachmentHintsByReferenceId[record.id] || [],
    }));
  }

  private async loadDocuments(
    userId: string,
    documentIds?: string[],
    includeAlreadyLinkedDocuments = true
  ): Promise<DocumentRecord[]> {
    const normalizedIds = Array.isArray(documentIds)
      ? Array.from(new Set(documentIds.map((id) => String(id || '').trim()).filter(Boolean)))
      : [];

    const where = {
      userId,
      ...(normalizedIds.length > 0 ? { id: { in: normalizedIds } } : {}),
      ...(includeAlreadyLinkedDocuments ? {} : { references: { none: { isPrimary: true } } }),
    };
    const select = {
      id: true,
      originalFilename: true,
      sourceIdentifier: true,
      status: true,
      pdfTitle: true,
      pdfAuthors: true,
      pdfDoi: true,
      parsedText: true,
    } as const;

    if (normalizedIds.length > 0) {
      return prisma.referenceDocument.findMany({
        where,
        select,
        orderBy: { updatedAt: 'desc' },
      });
    }

    const results: DocumentRecord[] = [];
    const pageSize = 500;
    let cursor: string | undefined;
    while (true) {
      const page = await prisma.referenceDocument.findMany({
        where,
        select,
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      results.push(...page);
      if (page.length < pageSize) break;
      cursor = page[page.length - 1].id;
    }

    return results;
  }

  private async buildObservedProfile(
    document: DocumentRecord,
    providers?: ReconciliationProviders
  ): Promise<ObservedDocumentProfile> {
    const parsedText = String(document.parsedText || '');
    const textSample = parsedText.slice(0, 20000);
    const inferredTitle = extractLikelyTitleFromText(parsedText);
    const observedTitle = String(document.pdfTitle || inferredTitle || '').trim() || null;
    const observedDoi = normalizeDoi(document.pdfDoi) || extractFirstDoiFromText(parsedText);

    const externalMendeley = providers?.mendeleyAccessToken
      ? await referenceConnectorService.searchMendeleyCatalogByPdfSignal({
          accessToken: providers.mendeleyAccessToken,
          doi: observedDoi,
          title: observedTitle,
        }).catch(() => null)
      : null;

    const externalZotero = providers?.zoteroApiKey
      ? await referenceConnectorService.searchZoteroLibraryByPdfSignal({
          apiKey: providers.zoteroApiKey,
          userId: providers.zoteroUserId,
          groupId: providers.zoteroGroupId,
          doi: observedDoi,
          title: observedTitle,
        }).catch(() => null)
      : null;

    const title = observedTitle || externalMendeley?.title || externalZotero?.title || null;
    const doi = normalizeDoi(observedDoi || externalMendeley?.doi || externalZotero?.doi);
    const yearHints = extractYearHints(parsedText);
    if (externalMendeley?.year) yearHints.add(externalMendeley.year);
    if (externalZotero?.year) yearHints.add(externalZotero.year);

    const venueSignals = new Set<string>();
    const mVenue = normalizeText(externalMendeley?.venue || '');
    const zVenue = normalizeText(externalZotero?.venue || '');
    if (mVenue.length >= 6) venueSignals.add(mVenue);
    if (zVenue.length >= 6) venueSignals.add(zVenue);
    const normalizedSignalText = normalizeText(
      `${String(document.originalFilename || '')}\n${String(document.sourceIdentifier || '')}\n${textSample}`
    );

    return {
      documentId: document.id,
      originalFilename: String(document.originalFilename || ''),
      filenameNormalized: String(document.originalFilename || '').trim().toLowerCase(),
      sourceIdentifierNormalized: String(document.sourceIdentifier || '').trim().toLowerCase() || null,
      title,
      titleTokens: tokenizeTitle(title || ''),
      doi,
      pmid: extractIdentifier(PMID_REGEX, textSample) || normalizeIdentifier(externalMendeley?.pmid || externalZotero?.pmid),
      pmcid: extractIdentifier(PMCID_REGEX, textSample) || normalizeIdentifier(externalMendeley?.pmcid || externalZotero?.pmcid),
      arxivId: extractIdentifier(ARXIV_REGEX, textSample) || normalizeIdentifier(externalMendeley?.arxivId || externalZotero?.arxivId),
      authorLastNames: toAuthorLastNameSet(document.pdfAuthors || externalMendeley?.authors || externalZotero?.authors || []),
      yearHints,
      venueSignals,
      filenameTokens: tokenizeFilename(document.originalFilename || ''),
      suppressionType: detectSuppressionType(title, document.originalFilename, textSample),
      textSample: normalizedSignalText,
    };
  }

  private async evaluateCandidate(reference: ReferenceRecord, observed: ObservedDocumentProfile): Promise<ScoredCandidate> {
    let score = 0;
    const reasons: string[] = [];
    let hardConflict = false;
    let hardConflictReason: string | undefined;

    const expectedDoi = normalizeDoi(reference.doi);
    const expectedPmid = normalizeIdentifier(reference.pmid);
    const expectedPmcid = normalizeIdentifier(reference.pmcid);
    const expectedArxiv = normalizeIdentifier(reference.arxivId);
    const expectedTitleNormalized = normalizeText(reference.title || '');
    const observedTitleNormalized = normalizeText(observed.title || '');
    const expectedTitleTokens = tokenizeTitle(reference.title || '');
    const expectedAuthors = toAuthorLastNameSet(reference.authors || []);
    const titleSimilarity = jaccard(expectedTitleTokens, observed.titleTokens);
    const titleEditSimilarity = normalizedEditSimilarity(expectedTitleNormalized, observedTitleNormalized);
    const authorOverlap = overlapRatio(expectedAuthors, observed.authorLastNames);
    const referenceSuppression = detectReferenceSuppression(reference);

    if (expectedDoi && observed.doi && expectedDoi !== observed.doi) {
      hardConflict = true;
      hardConflictReason = `DOI mismatch (${expectedDoi} vs ${observed.doi})`;
    }
    if (!hardConflict && expectedPmid && observed.pmid && expectedPmid !== observed.pmid) {
      hardConflict = true;
      hardConflictReason = `PMID mismatch (${expectedPmid} vs ${observed.pmid})`;
    }
    if (!hardConflict && expectedPmcid && observed.pmcid && expectedPmcid !== observed.pmcid) {
      hardConflict = true;
      hardConflictReason = `PMCID mismatch (${expectedPmcid} vs ${observed.pmcid})`;
    }
    if (!hardConflict && expectedArxiv && observed.arxivId && expectedArxiv !== observed.arxivId) {
      hardConflict = true;
      hardConflictReason = `ArXiv mismatch (${expectedArxiv} vs ${observed.arxivId})`;
    }
    if (!hardConflict && observed.suppressionType && referenceSuppression !== observed.suppressionType) {
      hardConflict = true;
      hardConflictReason = `Suppressed document type (${observed.suppressionType}) conflicts with citation type`;
    }
    if (hardConflict) {
      return {
        documentId: observed.documentId,
        referenceId: reference.id,
        score: -100,
        confidence: 'low',
        titleSimilarity,
        authorOverlap,
        hardConflict: true,
        hardConflictReason,
        suppressionType: observed.suppressionType,
        reasons: [hardConflictReason || 'Hard conflict'],
      };
    }

    if (expectedDoi && observed.doi && expectedDoi === observed.doi) {
      score += 95;
      reasons.push('Exact DOI match');
    } else if (!expectedDoi && observed.doi) {
      const resolved = await this.resolveCrossrefDoi(observed.doi);
      if (resolved) {
        const rtToken = jaccard(expectedTitleTokens, resolved.titleTokens);
        const rtEdit = normalizedEditSimilarity(expectedTitleNormalized, resolved.titleNormalized);
        const rt = Math.max(rtToken, rtEdit);
        const ra = overlapRatio(expectedAuthors, resolved.authors);
        if (rt >= 0.9) {
          score += 28;
          reasons.push('Crossref DOI title strong match');
        } else if (rt >= 0.8) {
          score += 20;
          reasons.push('Crossref DOI title match');
        }
        if (ra >= 0.6) {
          score += 12;
          reasons.push('Crossref DOI author overlap');
        }
        if (reference.year && resolved.year && reference.year === resolved.year) {
          score += 8;
          reasons.push('Crossref DOI year match');
        }
      }
    }

    if (expectedPmid && observed.pmid && expectedPmid === observed.pmid) {
      score += 92;
      reasons.push('PMID exact match');
    }
    if (expectedPmcid && observed.pmcid && expectedPmcid === observed.pmcid) {
      score += 92;
      reasons.push('PMCID exact match');
    }
    if (expectedArxiv && observed.arxivId && expectedArxiv === observed.arxivId) {
      score += 92;
      reasons.push('arXiv exact match');
    }

    const attachmentHintSignal = this.evaluateAttachmentHintSignal(reference.attachmentHints, observed);
    if (attachmentHintSignal.score > 0) {
      score += attachmentHintSignal.score;
      reasons.push(...attachmentHintSignal.reasons);
    }

    if (titleSimilarity >= 0.9 || titleEditSimilarity >= 0.92) {
      score += 40;
      reasons.push('Title similarity strong');
    } else if (titleSimilarity >= 0.8 || titleEditSimilarity >= 0.85) {
      score += 30;
      reasons.push('Title similarity moderate');
    } else if (titleSimilarity >= 0.65 || titleEditSimilarity >= 0.75) {
      score += 18;
      reasons.push('Title similarity partial');
    } else if (observed.title && reference.title) {
      score -= 15;
      reasons.push('Title mismatch penalty');
    }

    if (authorOverlap >= 0.75) {
      score += 15;
      reasons.push('Author overlap >= 0.75');
    } else if (authorOverlap >= 0.5) {
      score += 10;
      reasons.push('Author overlap 0.50-0.74');
    } else if (authorOverlap >= 0.25) {
      score += 6;
      reasons.push('Author overlap 0.25-0.49');
    } else if (expectedAuthors.size >= 2 && observed.authorLastNames.size >= 2) {
      score -= 10;
      reasons.push('Author mismatch penalty');
    }

    if (reference.year && observed.yearHints.has(reference.year)) {
      score += 8;
      reasons.push('Year exact match');
    } else if (reference.year && (observed.yearHints.has(reference.year - 1) || observed.yearHints.has(reference.year + 1))) {
      score += 4;
      reasons.push('Year near match');
    }

    const venue = normalizeText(reference.venue || '');
    const venueMatched = venue.length >= 8 && (
      observed.venueSignals.has(venue)
      || containsWholePhrase(observed.textSample, venue)
    );
    if (venueMatched) {
      score += 6;
      reasons.push('Venue signal match');
    } else if (venue && observed.venueSignals.size > 0 && !observed.venueSignals.has(venue)) {
      score -= 8;
      reasons.push('Venue mismatch penalty');
    }

    const citationKeyTokens = tokenizeTitle(reference.citationKey || '');
    if (jaccard(citationKeyTokens, observed.filenameTokens) >= 0.7 || jaccard(expectedTitleTokens, observed.filenameTokens) >= 0.7) {
      score += 4;
      reasons.push('Filename/citation-key strong overlap');
    }

    if (observed.suppressionType) {
      score -= 35;
      reasons.push(`Suppression penalty (${observed.suppressionType})`);
    }

    const boundedScore = Math.max(-100, Math.min(100, score));

    return {
      documentId: observed.documentId,
      referenceId: reference.id,
      score: boundedScore,
      confidence: toCandidateConfidence(boundedScore),
      titleSimilarity,
      authorOverlap,
      hardConflict: false,
      suppressionType: observed.suppressionType,
      reasons,
    };
  }

  private selectAssignments(
    scoredByDocument: Map<string, ScoredCandidate[]>,
    hardConflicts: Array<{ documentId: string; reason: string }>
  ) {
    const hardConflictByDoc = new Map(hardConflicts.map((item) => [item.documentId, item.reason]));
    const candidateAuto: ScoredCandidate[] = [];
    const reviewQueue: ReconciliationReviewItem[] = [];
    const unmatchedDocumentIds: string[] = [];
    const skippedByHardConflict: Array<{ documentId: string; reason: string }> = [];

    for (const [documentId, candidates] of Array.from(scoredByDocument.entries())) {
      const valid = candidates.filter((candidate) => !candidate.hardConflict);
      if (hardConflictByDoc.has(documentId)) {
        skippedByHardConflict.push({ documentId, reason: hardConflictByDoc.get(documentId) as string });
      }

      if (valid.length === 0) {
        unmatchedDocumentIds.push(documentId);
        continue;
      }

      const top = valid[0];
      const second = valid[1];
      const margin = second ? top.score - second.score : 100;
      top.marginToNext = margin;
      const tieRequiresReview = Boolean(second && margin <= 10);

      if (tieRequiresReview) {
        reviewQueue.push({
          documentId,
          reason: 'Top candidates are too close (<= 10 score margin)',
          topCandidates: valid.slice(0, 3).map((candidate, idx, arr) => ({
            ...candidate,
            marginToNext: idx < arr.length - 1 ? candidate.score - arr[idx + 1].score : candidate.score,
          })),
        });
        continue;
      }

      const isAutoHigh = top.score >= 95;
      const isAutoGuarded = top.score >= 85 && margin >= 15;
      if (isAutoHigh || isAutoGuarded) {
        candidateAuto.push(top);
        continue;
      }

      if (top.score >= 70) {
        reviewQueue.push({
          documentId,
          reason: 'Candidate requires human review (score between 70 and auto-link threshold)',
          topCandidates: valid.slice(0, 3).map((candidate, idx, arr) => ({
            ...candidate,
            marginToNext: idx < arr.length - 1 ? candidate.score - arr[idx + 1].score : candidate.score,
          })),
        });
      } else {
        unmatchedDocumentIds.push(documentId);
      }
    }

    candidateAuto.sort((a, b) => b.score - a.score);
    const assignedDocs = new Set<string>();
    const assignedRefs = new Set<string>();
    const autoAssignments: ReconciliationCandidate[] = [];

    for (const candidate of candidateAuto) {
      if (assignedDocs.has(candidate.documentId) || assignedRefs.has(candidate.referenceId)) {
        reviewQueue.push({
          documentId: candidate.documentId,
          reason: 'Candidate blocked by higher-confidence assignment for the same reference/document',
          topCandidates: [{ ...candidate, marginToNext: candidate.marginToNext ?? candidate.score }],
        });
        continue;
      }
      assignedDocs.add(candidate.documentId);
      assignedRefs.add(candidate.referenceId);
      autoAssignments.push({ ...candidate, marginToNext: candidate.marginToNext ?? candidate.score });
    }

    return { autoAssignments, reviewQueue, unmatchedDocumentIds, skippedByHardConflict };
  }

  private async applyAssignments(input: {
    userId: string;
    actorUserId: string;
    tenantId: string | null;
    batchId: string;
    assignments: ReconciliationCandidate[];
    auditAction?: LinkAuditAction;
    decisionMeta?: Record<string, any>;
  }): Promise<ReconciliationAppliedLink[]> {
    const applied: ReconciliationAppliedLink[] = [];

    for (const assignment of input.assignments) {
      const result = await prisma.$transaction(async (tx) => {
        const reference = await tx.referenceLibrary.findFirst({
          where: { id: assignment.referenceId, userId: input.userId, isActive: true },
          select: { id: true, pdfUrl: true },
        });
        const document = await tx.referenceDocument.findFirst({
          where: { id: assignment.documentId, userId: input.userId },
          select: { id: true, sourceIdentifier: true },
        });
        if (!reference || !document) return null;

        const existingTarget = await tx.referenceDocumentLink.findFirst({
          where: { referenceId: assignment.referenceId, documentId: assignment.documentId },
          select: { id: true, isPrimary: true },
        });
        const previousRefPrimary = await tx.referenceDocumentLink.findFirst({
          where: { referenceId: assignment.referenceId, isPrimary: true },
          select: { id: true },
        });
        const previousDocPrimary = await tx.referenceDocumentLink.findFirst({
          where: { documentId: assignment.documentId, isPrimary: true },
          select: { id: true },
        });

        if (previousRefPrimary && previousRefPrimary.id !== existingTarget?.id) {
          await tx.referenceDocumentLink.update({ where: { id: previousRefPrimary.id }, data: { isPrimary: false } });
        }
        if (previousDocPrimary && previousDocPrimary.id !== existingTarget?.id && previousDocPrimary.id !== previousRefPrimary?.id) {
          await tx.referenceDocumentLink.update({ where: { id: previousDocPrimary.id }, data: { isPrimary: false } });
        }

        let targetLinkId = '';
        let targetCreated = false;
        if (existingTarget) {
          await tx.referenceDocumentLink.update({
            where: { id: existingTarget.id },
            data: { isPrimary: true, linkedAt: new Date(), linkedBy: input.actorUserId },
          });
          targetLinkId = existingTarget.id;
        } else {
          const created = await tx.referenceDocumentLink.create({
            data: {
              referenceId: assignment.referenceId,
              documentId: assignment.documentId,
              isPrimary: true,
              linkedBy: input.actorUserId,
            },
          });
          targetCreated = true;
          targetLinkId = created.id;
        }

        if (typeof document.sourceIdentifier === 'string' && /^https?:\/\//i.test(document.sourceIdentifier)) {
          await tx.referenceLibrary.update({
            where: { id: assignment.referenceId },
            data: { pdfUrl: document.sourceIdentifier },
          });
        }

        const audit = await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            tenantId: input.tenantId,
            action: input.auditAction || 'LIBRARY_REFERENCE_AUTO_LINKED',
            resource: 'reference_document_link',
            meta: {
              batchId: input.batchId,
              userId: input.userId,
              documentId: assignment.documentId,
              referenceId: assignment.referenceId,
              score: assignment.score,
              confidence: assignment.confidence,
              reasons: assignment.reasons,
              rollback: {
                targetLinkId,
                targetCreated,
                referenceId: assignment.referenceId,
                documentId: assignment.documentId,
                previousRefPrimaryId: previousRefPrimary?.id || null,
                previousDocPrimaryId: previousDocPrimary?.id || null,
                previousReferencePdfUrl: reference.pdfUrl,
              },
              decisionMeta: input.decisionMeta || null,
            },
          },
        });

        return {
          documentId: assignment.documentId,
          referenceId: assignment.referenceId,
          score: assignment.score,
          confidence: assignment.confidence,
          auditLogId: audit.id,
        };
      });

      if (result) applied.push(result);
    }

    return applied;
  }

  private async rollbackSingleAssignment(rollback: Record<string, any>): Promise<void> {
    const targetLinkId = String(rollback.targetLinkId || '');
    const targetCreated = Boolean(rollback.targetCreated);
    const previousRefPrimaryId = typeof rollback.previousRefPrimaryId === 'string' ? rollback.previousRefPrimaryId : null;
    const previousDocPrimaryId = typeof rollback.previousDocPrimaryId === 'string' ? rollback.previousDocPrimaryId : null;
    const referenceId = String(rollback.referenceId || '');
    const previousReferencePdfUrl = rollback.previousReferencePdfUrl ?? undefined;

    await prisma.$transaction(async (tx) => {
      if (targetCreated) {
        await tx.referenceDocumentLink.deleteMany({ where: { id: targetLinkId } });
      } else {
        await tx.referenceDocumentLink.updateMany({ where: { id: targetLinkId }, data: { isPrimary: false } });
      }
      if (previousRefPrimaryId) {
        await tx.referenceDocumentLink.updateMany({ where: { id: previousRefPrimaryId }, data: { isPrimary: true } });
      }
      if (previousDocPrimaryId) {
        await tx.referenceDocumentLink.updateMany({ where: { id: previousDocPrimaryId }, data: { isPrimary: true } });
      }
      if (previousReferencePdfUrl !== undefined && referenceId) {
        await tx.referenceLibrary.updateMany({ where: { id: referenceId }, data: { pdfUrl: previousReferencePdfUrl } });
      }
    });
  }

  private normalizeAttachmentHintMap(
    input?: Record<string, string[]>
  ): Record<string, string[]> {
    if (!input || typeof input !== 'object') return {};
    const normalized: Record<string, string[]> = {};

    for (const [referenceId, hints] of Object.entries(input)) {
      if (!referenceId || !Array.isArray(hints) || hints.length === 0) continue;
      const cleaned = Array.from(
        new Set(
          hints
            .map((hint) => normalizeAttachmentHint(hint))
            .filter((hint): hint is string => Boolean(hint))
        )
      ).slice(0, 20);
      if (cleaned.length > 0) normalized[referenceId] = cleaned;
    }

    return normalized;
  }

  private evaluateAttachmentHintSignal(
    hints: string[],
    observed: ObservedDocumentProfile
  ): { score: number; reasons: string[] } {
    if (!Array.isArray(hints) || hints.length === 0) {
      return { score: 0, reasons: [] };
    }

    const reasons: string[] = [];
    let bestScore = 0;
    let bestOverlap = 0;

    const observedBase = basenameOf(observed.filenameNormalized || observed.originalFilename || '');
    const observedPathTokens = tokenizeFilename(observedBase);
    const observedSource = String(observed.sourceIdentifierNormalized || '');

    for (const rawHint of hints) {
      const hint = normalizeAttachmentHint(rawHint);
      if (!hint) continue;

      const hintBase = basenameOf(hint);
      if (hintBase && hintBase === observedBase) {
        return {
          score: 60,
          reasons: ['Attachment filename exact match from citation import'],
        };
      }

      if (observedSource && (observedSource.includes(hint) || observedSource.includes(hintBase))) {
        bestScore = Math.max(bestScore, 45);
      }

      const hintTokens = tokenizeFilename(hintBase || hint);
      const overlap = jaccard(hintTokens, observedPathTokens);
      bestOverlap = Math.max(bestOverlap, overlap);
    }

    if (bestScore >= 45) {
      reasons.push('Attachment source identifier match from citation import');
    }

    if (bestOverlap >= 0.9) {
      bestScore = Math.max(bestScore, 42);
      reasons.push('Attachment filename token overlap >= 0.90');
    } else if (bestOverlap >= 0.75) {
      bestScore = Math.max(bestScore, 32);
      reasons.push('Attachment filename token overlap 0.75-0.89');
    } else if (bestOverlap >= 0.6) {
      bestScore = Math.max(bestScore, 20);
      reasons.push('Attachment filename token overlap 0.60-0.74');
    }

    return { score: bestScore, reasons };
  }

  private async withCrossrefPermit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeCrossrefRequests >= MAX_CROSSREF_CONCURRENCY) {
      await new Promise<void>((resolve) => {
        this.crossrefWaitQueue.push(resolve);
      });
    }

    this.activeCrossrefRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeCrossrefRequests = Math.max(0, this.activeCrossrefRequests - 1);
      const next = this.crossrefWaitQueue.shift();
      if (next) next();
    }
  }

  private async resolveCrossrefDoi(doi: string): Promise<ResolvedDoiMetadata | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;
    const cached = this.crossrefCache.get(normalized);
    if (cached) return cached;

    const resolver = (async () => {
      const crossrefEmail = String(process.env.CROSSREF_CONTACT_EMAIL || process.env.SUPPORT_EMAIL || '').trim();
      const userAgent = crossrefEmail
        ? `Papsi/1.0 Reference Reconciliation (mailto:${crossrefEmail})`
        : 'Papsi/1.0 Reference Reconciliation';

      for (let attempt = 0; attempt <= CROSSREF_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CROSSREF_TIMEOUT_MS);
        try {
          const response = await this.withCrossrefPermit(() => fetch(
            `https://api.crossref.org/works/${encodeURIComponent(normalized)}`,
            {
              headers: {
                'User-Agent': userAgent,
                Accept: 'application/json',
              },
              signal: controller.signal,
            }
          ));
          clearTimeout(timeout);

          if (response.status === 404) return null;
          if (response.status === 429 || response.status >= 500) {
            if (attempt < CROSSREF_RETRIES) {
              await sleep(250 * (attempt + 1));
              continue;
            }
            return null;
          }
          if (!response.ok) return null;

          const payload = await response.json();
          const message = payload?.message || {};
          const title = Array.isArray(message?.title) ? String(message.title[0] || '').trim() : '';
          const titleNormalized = normalizeText(title);
          const authors = new Set<string>();
          if (Array.isArray(message?.author)) {
            const normalizedAuthors = toAuthorLastNameSet(
              message.author.map((author: Record<string, unknown>) =>
                `${String(author?.family || '')} ${String(author?.given || '')}`.trim()
              )
            );
            for (const name of Array.from(normalizedAuthors)) authors.add(name);
          }
          const year = Array.isArray(message?.issued?.['date-parts']?.[0])
            ? Number.parseInt(String(message.issued['date-parts'][0][0] || ''), 10)
            : null;
          return {
            doi: normalized,
            titleNormalized,
            titleTokens: tokenizeTitle(title),
            authors,
            year: Number.isFinite(year as number) ? (year as number) : null,
          };
        } catch {
          clearTimeout(timeout);
          if (attempt < CROSSREF_RETRIES) {
            await sleep(250 * (attempt + 1));
            continue;
          }
          return null;
        }
      }

      return null;
    })();

    this.crossrefCache.set(normalized, resolver);
    return resolver;
  }
}

export const referenceReconciliationService = new ReferenceReconciliationService();
