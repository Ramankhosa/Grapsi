import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma';
import type { DeepAnalysisLabel, PreparedPaperSection, PreparedPaperText } from './deep-analysis-types';
import {
  detectSections,
  normalizeExtractedText,
  HARD_STOP_HEADING,
  SOFT_DROP_HEADING,
  stripTrailingSections,
} from './proactive-parsing-service';
import { removeNullCharacters, sanitizeForPostgres } from '../utils/postgres-sanitize';
import { normalizeDoi as normalizeDoiValue, normalizeSearchText } from '../utils/reference-matching-normalization';

interface CitationIdentity {
  id: string;
  doi?: string | null;
  title: string;
  year?: number | null;
  authors?: string[];
  libraryReferenceId?: string | null;
}

interface SessionResolutionOptions {
  userId?: string | null;
}

export interface PreparedCitationTextResult {
  preparedText: PreparedPaperText;
  referenceId: string | null;
  documentId: string | null;
  parserUsed: 'PDFJS' | 'GROBID' | 'REGEX_FALLBACK';
  textAvailable: boolean;
  warning?: string | null;
  pdfAttachment: {
    filePath: string;
    filename: string;
    mimeType: string;
  } | null;
}

export interface CitationTextReadinessResult {
  ready: boolean;
  reason: string | null;
  referenceId: string | null;
  documentId: string | null;
  parserCandidate: 'PDFJS' | 'GROBID' | 'REGEX_FALLBACK' | null;
  textAvailable: boolean;
  hasAttachedSource: boolean;
}

interface MatchedReferenceDocument {
  referenceId: string;
  referencePdfUrl: string | null;
  document: {
    id: string;
    status: string;
    parsedText: string | null;
    sectionsJson: unknown;
    parserUsed: string | null;
    mimeType: string;
    sourceType: string;
    sourceIdentifier: string | null;
    storagePath: string;
    originalFilename: string | null;
  };
}

const MAX_TOKENS = 25_000;
const MAX_CHARS = MAX_TOKENS * 4;
const RESOLUTION_CACHE_TTL_MS = 5 * 60 * 1000;
const RESOLUTION_CACHE_MISS_TTL_MS = 45 * 1000;
const MAX_RESOLUTION_CACHE_SIZE = 2_000;
const DEPTH_TOKEN_BUDGET: Record<DeepAnalysisLabel, number> = {
  DEEP_ANCHOR: 25_000,
  DEEP_SUPPORT: 12_000,
  DEEP_STRESS_TEST: 14_000,
  LIT_ONLY: 8_000,
};

const normalize = (value: string) =>
  normalizeSearchText(value);

const normalizeDoi = (value?: string | null): string => {
  return normalizeDoiValue(value) || '';
};

const estimateTokens = (text: string): number => Math.ceil(String(text || '').length / 4);

const clampByTokenBudget = (text: string, maxChars = MAX_CHARS): string => {
  if (text.length <= maxChars) {
    return text;
  }

  const candidate = text.slice(0, maxChars);
  const paragraphBreak = candidate.lastIndexOf('\n\n');
  if (paragraphBreak > maxChars * 0.6) {
    return candidate.slice(0, paragraphBreak).trim();
  }

  const lineBreak = candidate.lastIndexOf('\n');
  if (lineBreak > maxChars * 0.6) {
    return candidate.slice(0, lineBreak).trim();
  }

  return candidate.trim();
};

const maxCharsForDepth = (depthLabel: DeepAnalysisLabel, multiplier = 1): number => {
  const budget = DEPTH_TOKEN_BUDGET[depthLabel] || MAX_TOKENS;
  return Math.max(8_000, Math.floor(budget * 4 * multiplier));
};

class TextPreparationService {
  private resolvedReferenceCache = new Map<string, {
    value: MatchedReferenceDocument | null;
    expiresAt: number;
  }>();

  private getResolutionCacheKey(userId: string, sessionId: string, citation: CitationIdentity): string {
    const authorKey = normalize((citation.authors || [])[0] || '');
    const titleKey = normalize(citation.title || '').slice(0, 180);
    const doiKey = normalizeDoi(citation.doi);
    const yearKey = Number.isFinite(Number(citation.year)) ? String(citation.year) : '';
    return [
      userId,
      sessionId,
      citation.id,
      citation.libraryReferenceId || '',
      doiKey,
      titleKey,
      yearKey,
      authorKey,
    ].join('|');
  }

  private getCachedResolvedReference(cacheKey: string): MatchedReferenceDocument | null | undefined {
    const cached = this.resolvedReferenceCache.get(cacheKey);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.resolvedReferenceCache.delete(cacheKey);
      return undefined;
    }
    return cached.value;
  }

  private setCachedResolvedReference(cacheKey: string, value: MatchedReferenceDocument | null): void {
    if (this.resolvedReferenceCache.size >= MAX_RESOLUTION_CACHE_SIZE) {
      const now = Date.now();
      Array.from(this.resolvedReferenceCache.entries()).forEach(([key, cached]) => {
        if (cached.expiresAt <= now) {
          this.resolvedReferenceCache.delete(key);
        }
      });
      if (this.resolvedReferenceCache.size >= MAX_RESOLUTION_CACHE_SIZE) {
        const firstKey = this.resolvedReferenceCache.keys().next().value;
        if (firstKey) {
          this.resolvedReferenceCache.delete(firstKey);
        }
      }
    }

    this.resolvedReferenceCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + (value ? RESOLUTION_CACHE_TTL_MS : RESOLUTION_CACHE_MISS_TTL_MS),
    });
  }

  private async resolveSessionUserId(
    sessionId: string,
    options?: SessionResolutionOptions
  ): Promise<string | null> {
    if (options?.userId) {
      return options.userId;
    }

    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    return session?.userId || null;
  }

  async prepareForCitation(
    sessionId: string,
    citation: CitationIdentity,
    depthLabel: DeepAnalysisLabel,
    options?: SessionResolutionOptions
  ): Promise<PreparedCitationTextResult> {
    const userId = await this.resolveSessionUserId(sessionId, options);
    if (!userId) {
      throw new Error('Drafting session not found');
    }

    const matched = await this.resolveReferenceDocument(userId, sessionId, citation);
    if (!matched?.document) {
      throw new Error(`No full-text document linked for citation ${citation.id}`);
    }

    const resolvedStoragePath = this.resolveStoragePath(matched.document.storagePath);
    const mimeType = String(matched.document.mimeType || '').trim() || 'application/pdf';
    const hasPdfAttachment = Boolean(
      resolvedStoragePath
      && fs.existsSync(resolvedStoragePath)
      && (mimeType.toLowerCase().includes('pdf') || /\.pdf$/i.test(resolvedStoragePath))
    );
    const pdfAttachment = hasPdfAttachment
      ? {
        filePath: resolvedStoragePath!,
        filename: matched.document.originalFilename || path.basename(resolvedStoragePath!),
        mimeType,
      }
      : null;

    let preparedText: PreparedPaperText;
    let textAvailable = false;
    let warning: string | null = null;

    try {
      preparedText = await this.prepareFromDocument(matched.document, depthLabel);
      textAvailable = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!pdfAttachment) {
        throw error;
      }

      warning = `Parsed text unavailable (${message}); proceeding with native PDF extraction`;
      preparedText = this.buildPdfOnlyPreparedText(citation, depthLabel);
      textAvailable = false;
    }

    return {
      preparedText,
      referenceId: matched.referenceId,
      documentId: matched.document.id,
      parserUsed: preparedText.source,
      textAvailable,
      warning,
      pdfAttachment,
    };
  }

  async checkCitationReadiness(
    sessionId: string,
    citation: CitationIdentity,
    options?: SessionResolutionOptions
  ): Promise<CitationTextReadinessResult> {
    const userId = await this.resolveSessionUserId(sessionId, options);
    if (!userId) {
      return {
        ready: false,
        reason: 'Drafting session not found',
        referenceId: null,
        documentId: null,
        parserCandidate: null,
        textAvailable: false,
        hasAttachedSource: false,
      };
    }

    const matched = await this.resolveReferenceDocument(userId, sessionId, citation);
    if (!matched?.document) {
      return {
        ready: false,
        reason: 'No linked full-text reference document found',
        referenceId: null,
        documentId: null,
        parserCandidate: null,
        textAvailable: false,
        hasAttachedSource: false,
      };
    }

    const hasParsedText = typeof matched.document.parsedText === 'string' && matched.document.parsedText.trim().length > 0;
    const storedSections = this.parseSectionsJson(matched.document.sectionsJson);
    const hasStoredSections = Boolean(storedSections && storedSections.length > 0);
    const hasTextData = hasParsedText || hasStoredSections;
    const rawStoragePath = String(matched.document.storagePath || '').trim();
    const mime = String(matched.document.mimeType || '').toLowerCase();
    const hasPdfAttachment = mime.includes('pdf') || (rawStoragePath ? /\.pdf$/i.test(rawStoragePath) : false);
    const hasAttachedSource = hasTextData || hasPdfAttachment;

    if (hasTextData) {
      const parserCandidate = hasStoredSections ? 'PDFJS' : 'REGEX_FALLBACK';
      return {
        ready: true,
        reason: null,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate,
        textAvailable: true,
        hasAttachedSource,
      };
    }

    const storagePath = this.resolveStoragePath(matched.document.storagePath);
    if (!storagePath || !fs.existsSync(storagePath)) {
      const missingPath = storagePath || matched.document.storagePath || '(missing storagePath)';
      return {
        ready: false,
        reason: `Document file not found at ${missingPath}`,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate: null,
        textAvailable: false,
        hasAttachedSource,
      };
    }

    const looksLikePdfPath = /\.pdf$/i.test(storagePath);
    if (!mime.includes('pdf') && !looksLikePdfPath) {
      return {
        ready: false,
        reason: `Document mime type ${matched.document.mimeType || 'unknown'} is not a PDF`,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate: null,
        textAvailable: false,
        hasAttachedSource,
      };
    }

    return {
      ready: true,
      reason: 'Native PDF extraction available (parsed text optional)',
      referenceId: matched.referenceId,
      documentId: matched.document.id,
      parserCandidate: null,
      textAvailable: false,
      hasAttachedSource,
    };
  }

  private async resolveReferenceDocument(
    userId: string,
    sessionId: string,
    citation: CitationIdentity
  ): Promise<MatchedReferenceDocument | null> {
    const cacheKey = this.getResolutionCacheKey(userId, sessionId, citation);
    const cached = this.getCachedResolvedReference(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const documentSelect = {
      id: true,
      status: true,
      parsedText: true,
      sectionsJson: true,
      parserUsed: true,
      mimeType: true,
      sourceType: true,
      sourceIdentifier: true,
      storagePath: true,
      originalFilename: true,
    } as const;

    // ── Fast path: direct lookup via libraryReferenceId ──
    // If the citation was imported from the library, resolve directly
    // without fuzzy matching — this is the most reliable path.
    const directRefId = citation.libraryReferenceId
      || await this.lookupLibraryReferenceIdFromCitation(citation.id);

    if (directRefId) {
      const directRef = await prisma.referenceLibrary.findFirst({
        where: { id: directRefId, userId, isActive: true },
        include: {
          documents: {
            where: { isPrimary: true },
            include: { document: { select: documentSelect } },
          },
        },
      });

      const directDoc = directRef?.documents[0]?.document;
      if (directDoc) {
        const resolved = {
          referenceId: directRef.id,
          referencePdfUrl: directRef.pdfUrl || null,
          document: {
            id: directDoc.id,
            status: directDoc.status,
            parsedText: directDoc.parsedText,
            sectionsJson: directDoc.sectionsJson,
            parserUsed: directDoc.parserUsed,
            mimeType: directDoc.mimeType,
            sourceType: directDoc.sourceType,
            sourceIdentifier: directDoc.sourceIdentifier,
            storagePath: directDoc.storagePath,
            originalFilename: directDoc.originalFilename,
          },
        };
        this.setCachedResolvedReference(cacheKey, resolved);
        return resolved;
      }
    }

    // ── Fallback: fuzzy DOI/title matching ──
    const marker = `AUTO_PAPER_SESSION:${sessionId}`;
    const citationDoi = normalizeDoi(citation.doi);
    const citationTitle = normalize(citation.title || '');
    const citationYear = Number.isFinite(Number(citation.year)) ? Number(citation.year) : null;
    const firstAuthor = normalize((citation.authors || [])[0] || '');

    const whereOr: any[] = [];
    if (citationDoi) {
      whereOr.push({ doi: { equals: citationDoi, mode: 'insensitive' } });
    }
    if (citation.title?.trim()) {
      whereOr.push({ title: { equals: citation.title.trim(), mode: 'insensitive' } });
      whereOr.push({ title: { contains: citation.title.trim().slice(0, 120), mode: 'insensitive' } });
    }

    const candidates = await prisma.referenceLibrary.findMany({
      where: {
        userId,
        isActive: true,
        ...(whereOr.length > 0 ? { OR: whereOr } : {}),
      },
      take: 60,
      include: {
        collections: {
          include: {
            collection: {
              select: { description: true },
            },
          },
        },
        documents: {
          where: { isPrimary: true },
          include: { document: { select: documentSelect } },
        },
      },
    });

    const scored: Array<{ score: number; item: MatchedReferenceDocument }> = [];

    for (const reference of candidates) {
      const inPaperCollection = reference.collections.some(link =>
        String(link.collection?.description || '').includes(marker)
      );
      const referenceDoi = normalizeDoi(reference.doi);
      const referenceTitle = normalize(reference.title || '');
      const referenceFirstAuthor = normalize(reference.authors?.[0] || '');

      let score = 0;
      if (inPaperCollection) score += 60;
      if (citationDoi && referenceDoi === citationDoi) score += 100;
      if (citationTitle && referenceTitle && citationTitle === referenceTitle) score += 60;
      if (citationTitle && referenceTitle && (citationTitle.includes(referenceTitle) || referenceTitle.includes(citationTitle))) {
        score += 25;
      }
      if (citationYear && reference.year === citationYear) score += 10;
      if (firstAuthor && referenceFirstAuthor && firstAuthor === referenceFirstAuthor) score += 10;

      const primary = reference.documents[0]?.document;
      if (!primary) continue;
      if (primary.parsedText && primary.parsedText.trim().length > 0) score += 20;
      if (primary.status === 'READY') score += 15;

      scored.push({
        score,
        item: {
          referenceId: reference.id,
          referencePdfUrl: reference.pdfUrl || null,
          document: {
            id: primary.id,
            status: primary.status,
            parsedText: primary.parsedText,
            sectionsJson: primary.sectionsJson,
            parserUsed: primary.parserUsed,
            mimeType: primary.mimeType,
            sourceType: primary.sourceType,
            sourceIdentifier: primary.sourceIdentifier,
            storagePath: primary.storagePath,
            originalFilename: primary.originalFilename,
          },
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const hasParsedText = (candidate: { score: number; item: MatchedReferenceDocument }) =>
      typeof candidate.item.document.parsedText === 'string' && candidate.item.document.parsedText.trim().length > 0;
    const topCandidate = scored[0];

    let selected = topCandidate || null;
    if (selected && !hasParsedText(selected)) {
      const nearbyWithText = scored.find(candidate =>
        hasParsedText(candidate)
        && selected.score - candidate.score <= 12
      );
      if (nearbyWithText) {
        selected = nearbyWithText;
      }
    }

    if (selected) {
      const topScore = topCandidate?.score ?? selected.score;
      const selectedIsTop = selected === topCandidate;
      const shouldBackfill = !directRefId
        && selected.score >= 90
        && (selectedIsTop || (topScore - selected.score <= 5));

      if (shouldBackfill) {
        this.backfillLibraryReferenceId(citation.id, selected.item.referenceId).catch(() => {});
      }

      this.setCachedResolvedReference(cacheKey, selected.item);
      return selected.item;
    }

    this.setCachedResolvedReference(cacheKey, null);
    return null;
  }

  private async lookupLibraryReferenceIdFromCitation(citationId: string): Promise<string | null> {
    const row = await prisma.citation.findUnique({
      where: { id: citationId },
      select: { libraryReferenceId: true },
    });
    return row?.libraryReferenceId || null;
  }

  private async backfillLibraryReferenceId(citationId: string, referenceId: string): Promise<void> {
    await prisma.citation.update({
      where: { id: citationId },
      data: { libraryReferenceId: referenceId },
    });
  }

  private async prepareFromDocument(
    document: MatchedReferenceDocument['document'],
    depthLabel: DeepAnalysisLabel
  ): Promise<PreparedPaperText> {
    let storedSections = this.parseSectionsJson(document.sectionsJson);

    if (storedSections && storedSections.length > 0) {
      const totalChars = storedSections.reduce((sum, s) => sum + s.heading.length + s.text.length, 0);
      let cumChars = 0;
      let hardStopIdx = -1;

      for (let i = 0; i < storedSections.length; i++) {
        const progress = totalChars > 0 ? cumChars / totalChars : 0;
        if (progress >= 0.2 && HARD_STOP_HEADING.test(storedSections[i].heading)) {
          hardStopIdx = i;
          break;
        }
        cumChars += storedSections[i].heading.length + storedSections[i].text.length;
      }
      if (hardStopIdx >= 0) {
        storedSections = storedSections.slice(0, hardStopIdx);
      }

      // SOFT_DROP: filter out acknowledgments/author bios but keep appendices
      storedSections = storedSections.filter(s => !SOFT_DROP_HEADING.test(s.heading));
    }

    if (storedSections && storedSections.length > 0) {
      console.log(`[TextPrep] Document ${document.id}: using pre-parsed sections (${storedSections.length} sections)`);
      const selectedSections = this.selectSectionsByDepth(storedSections, depthLabel);
      const fullBody = this.joinSections(storedSections);
      const selectedText = this.joinSections(selectedSections.length > 0 ? selectedSections : storedSections);
      const bounded = clampByTokenBudget(selectedText, maxCharsForDepth(depthLabel));

      return {
        fullText: bounded,
        rawFullText: clampByTokenBudget(fullBody, maxCharsForDepth(depthLabel, 1.6)),
        sections: selectedSections.length > 0 ? selectedSections : storedSections,
        source: 'PDFJS',
        estimatedTokens: estimateTokens(bounded),
      };
    }

    const rawText = document.parsedText || '';
    const cleaned = normalizeExtractedText(this.regexClean(rawText));
    if (!cleaned) {
      throw new Error('Document has no parseable full text');
    }

    const sections = detectSections(cleaned);
    if (sections.length > 0) {
      await prisma.referenceDocument.update({
        where: { id: document.id },
        data: { sectionsJson: sanitizeForPostgres(sections) as any, parserUsed: document.parserUsed || 'PDFJS' },
      }).catch(() => undefined);

      const selectedSections = this.selectSectionsByDepth(sections, depthLabel);
      const fullBody = this.joinSections(sections);
      const selectedText = this.joinSections(selectedSections.length > 0 ? selectedSections : sections);
      const bounded = clampByTokenBudget(selectedText, maxCharsForDepth(depthLabel));

      return {
        fullText: bounded,
        rawFullText: clampByTokenBudget(fullBody, maxCharsForDepth(depthLabel, 1.6)),
        sections: selectedSections.length > 0 ? selectedSections : sections,
        source: 'PDFJS',
        estimatedTokens: estimateTokens(bounded),
      };
    }

    await prisma.referenceDocument.update({
      where: { id: document.id },
      data: { parserUsed: document.parserUsed || 'REGEX_FALLBACK' },
    }).catch(() => undefined);

    const bounded = clampByTokenBudget(cleaned, maxCharsForDepth(depthLabel));
    const rawForVerification = normalizeExtractedText(
      stripTrailingSections(removeNullCharacters(String(rawText || '')).replace(/\r\n/g, '\n'))
    );

    return {
      fullText: bounded,
      rawFullText: clampByTokenBudget(rawForVerification || cleaned, maxCharsForDepth(depthLabel, 1.6)),
      source: 'REGEX_FALLBACK',
      estimatedTokens: estimateTokens(bounded),
    };
  }

  private parseSectionsJson(raw: unknown): PreparedPaperSection[] | null {
    if (!Array.isArray(raw)) {
      return null;
    }

    const sections = raw
      .map(item => {
        if (!item || typeof item !== 'object') return null;
        const heading = removeNullCharacters(String((item as any).heading || '').trim()) || 'Untitled Section';
        const text = removeNullCharacters(String((item as any).text || '').trim());
        if (!text) return null;
        return { heading, text };
      })
      .filter((item): item is PreparedPaperSection => Boolean(item));

    return sections.length > 0 ? sections : null;
  }

  private buildPdfOnlyPreparedText(
    citation: CitationIdentity,
    depthLabel: DeepAnalysisLabel
  ): PreparedPaperText {
    const fallbackText = normalizeExtractedText(
      [
        `Title: ${String(citation.title || '').trim() || 'Untitled paper'}`,
        citation.year ? `Year: ${citation.year}` : null,
        Array.isArray(citation.authors) && citation.authors.length > 0
          ? `Authors: ${citation.authors.slice(0, 10).join('; ')}`
          : null,
        citation.doi ? `DOI: ${citation.doi}` : null,
        'Parsed text is not available for this citation. Use attached PDF for native extraction.',
      ].filter(Boolean).join('\n')
    );

    const bounded = clampByTokenBudget(
      fallbackText || 'Parsed text unavailable. Use attached PDF for native extraction.',
      maxCharsForDepth(depthLabel, 0.6)
    );

    return {
      fullText: bounded,
      rawFullText: bounded,
      source: 'REGEX_FALLBACK',
      estimatedTokens: estimateTokens(bounded),
    };
  }

  private resolveStoragePath(storagePath?: string | null): string | null {
    const candidate = String(storagePath || '').trim();
    if (!candidate) return null;
    return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
  }

  regexClean(text: string): string {
    let value = removeNullCharacters(String(text || '')).replace(/\r\n/g, '\n');

    // Use the same deterministic truncation logic as proactive parsing.
    value = stripTrailingSections(value);

    const lines = value.split('\n');
    const shortLineCounts = new Map<string, number>();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      if (line.length <= 80 && wordCount <= 8) {
        shortLineCounts.set(line, (shortLineCounts.get(line) || 0) + 1);
      }
    }

    const KEEP_PATTERN = /^(?:algorithm|theorem|lemma|corollary|proposition|definition|proof|figure|table|equation|step|case|example|property|claim|remark|observation)\s+\d/i;

    const cleanedLines = lines.filter(rawLine => {
      const line = rawLine.trim();
      if (!line) return true;
      if (/^[\[(]?\d{1,4}[\])]?$/.test(line)) return false;
      const shortCount = shortLineCounts.get(line) || 0;
      if (line.length <= 80 && shortCount >= 3) {
        if (KEEP_PATTERN.test(line)) return true;
        return false;
      }
      return true;
    });

    value = cleanedLines.join('\n');
    value = value
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return clampByTokenBudget(value);
  }

  private selectSectionsByDepth(
    sections: PreparedPaperSection[],
    depthLabel: DeepAnalysisLabel
  ): PreparedPaperSection[] {
    if (depthLabel === 'DEEP_ANCHOR') {
      return sections;
    }

    const supportPattern = /method|material|dataset|participant|experiment|evaluation|result|finding|analysis|experimental|setup|data|performance|outcome|benchmark|ablation|implementation|approach|design|procedure|framework|sample|measure|test|comparison|effect|impact/i;
    const stressPattern = /method|material|result|finding|discussion|limitation|threat|failure|conclusion|analysis|validity|bias|caveat|weakness|boundary|constraint|generalizab/i;

    const pattern = depthLabel === 'DEEP_STRESS_TEST' ? stressPattern : supportPattern;
    const selected = sections.filter(section => pattern.test(section.heading));

    if (selected.length > 0) {
      return selected;
    }

    if (depthLabel === 'DEEP_STRESS_TEST') {
      const thirdPoint = Math.ceil((sections.length * 2) / 3);
      return sections.slice(Math.max(0, thirdPoint - 1));
    }

    const midpoint = Math.ceil(sections.length / 2);
    return sections.slice(Math.max(0, midpoint - 1));
  }

  private joinSections(sections: PreparedPaperSection[]): string {
    const raw = sections
      .map(section => `## ${section.heading}\n\n${section.text}`)
      .join('\n\n')
      .trim();
    return normalizeExtractedText(raw);
  }
}

export const textPreparationService = new TextPreparationService();
export { TextPreparationService };
