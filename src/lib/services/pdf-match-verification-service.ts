import { prisma } from '../prisma';
import {
  normalizeDoi as normalizeDoiValue,
  normalizeSearchText,
} from '../utils/reference-matching-normalization';

type VerificationPhase = 'post-pdf-parser' | 'post-proactive';
type VerificationDecision = 'keep' | 'detach';

interface ExpectedProfile {
  referenceId: string;
  doi: string | null;
  title: string | null;
  titleNormalized: string;
  titleTokens: Set<string>;
  authorLastNames: Set<string>;
  year: number | null;
  venue: string | null;
}

interface ObservedProfile {
  doi: string | null;
  title: string | null;
  titleNormalized: string;
  titleTokens: Set<string>;
  authorLastNames: Set<string>;
  textSample: string;
  textLength: number;
  hasSupplementarySignal: boolean;
}

interface Evaluation {
  decision: VerificationDecision;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  titleSimilarity: number;
  authorOverlap: number;
  reason: string;
}

const DOI_REGEX = /(?:doi[:\s]+|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s,;)}\]]+)/ig;
const SUPPLEMENTARY_REGEX = /\b(supplementary|supplemental|supporting\s+information|appendix|appendices|correction|erratum|editorial)\b/i;
const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'on', 'for', 'to', 'in', 'at', 'by', 'from', 'with', 'without',
  'and', 'or', 'as', 'via', 'using', 'use', 'based',
]);
const SURNAME_PARTICLES = new Set(['da', 'de', 'del', 'della', 'der', 'di', 'du', 'ibn', 'la', 'le', 'van', 'von']);

function normalizeDoi(value: unknown): string | null {
  return normalizeDoiValue(value);
}

function normalizeText(value: unknown): string {
  return normalizeSearchText(value);
}

function tokenizeTitle(value: string): Set<string> {
  const tokens = normalizeText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !TITLE_STOP_WORDS.has(token));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of Array.from(a)) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function extractLikelyTitleFromText(parsedText: string): string | null {
  if (!parsedText) return null;
  const lines = parsedText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  let best: { line: string; score: number } | null = null;
  for (const line of lines.slice(0, 40)) {
    if (line.startsWith('## ')) continue;
    if (/^(abstract|keywords?|introduction|copyright|journal|vol(?:ume)?\.?|issue|published)\b/i.test(line)) continue;
    if (line.length < 20 || line.length > 240) continue;
    if (/10\.\d{4,9}\//i.test(line) || /^https?:\/\//i.test(line)) continue;
    if (/^[-\d\s.,;:()]+$/.test(line)) continue;

    const words = normalizeText(line).split(' ').filter(Boolean);
    if (words.length < 4 || words.length > 22) continue;

    let score = 0;
    if (words.length >= 6 && words.length <= 18) score += 2;
    if (!/[;|]/.test(line)) score += 1;
    if (line.length >= 35 && line.length <= 180) score += 2;
    if (/^[A-Z]/.test(line)) score += 1;

    if (!best || score > best.score) {
      best = { line, score };
    }
  }

  return best && best.score >= 3 ? best.line : null;
}

function extractFirstDoiFromText(text: string): string | null {
  if (!text) return null;
  const sample = text.slice(0, 120000);
  for (const match of Array.from(sample.matchAll(DOI_REGEX))) {
    const doi = normalizeDoi(match[1]);
    if (doi) return doi;
  }
  return null;
}

function toAuthorLastNameSet(value: unknown): Set<string> {
  const names: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) names.push(item.trim());
    }
  } else if (typeof value === 'string') {
    const normalized = value.replace(/\band\b/gi, ',');
    for (const token of normalized.split(/[;,]/)) {
      const trimmed = token.trim();
      if (trimmed) names.push(trimmed);
    }
  }

  const lastNames = new Set<string>();
  for (const name of names) {
    let candidate = name;
    if (candidate.includes(',')) {
      candidate = candidate.split(',')[0] || candidate;
    }
    const parts = candidate
      .split(/\s+/)
      .map(part => normalizeText(part))
      .filter(Boolean);
    if (parts.length === 0) continue;

    const last = parts[parts.length - 1];
    lastNames.add(last);

    if (parts.length >= 2) {
      const secondLast = parts[parts.length - 2];
      if (secondLast && secondLast.length >= 2 && !SURNAME_PARTICLES.has(secondLast)) {
        lastNames.add(secondLast);
      }
    }

    const compound: string[] = [last];
    let idx = parts.length - 2;
    while (idx >= 0 && SURNAME_PARTICLES.has(parts[idx])) {
      compound.unshift(parts[idx]);
      idx -= 1;
    }
    if (compound.length > 1) {
      lastNames.add(compound.join(' '));
    }
  }
  return lastNames;
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
  return Math.max(0, 1 - (levenshteinDistance(a, b) / maxLen));
}

function overlapRatio(expected: Set<string>, observed: Set<string>): number {
  if (expected.size === 0 || observed.size === 0) return 0;
  let overlap = 0;
  for (const token of Array.from(expected)) {
    if (observed.has(token)) overlap += 1;
  }
  return overlap / expected.size;
}

class PdfMatchVerificationService {
  async verifyDocumentLinks(
    documentId: string,
    phase: VerificationPhase = 'post-pdf-parser'
  ): Promise<{ checked: number; detached: number; kept: number }> {
    const document = await prisma.referenceDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        pdfDoi: true,
        pdfTitle: true,
        pdfAuthors: true,
        parsedText: true,
      },
    });

    if (!document) {
      return { checked: 0, detached: 0, kept: 0 };
    }

    const links = await prisma.referenceDocumentLink.findMany({
      where: { documentId, isPrimary: true },
      include: {
        reference: {
          select: {
            id: true,
            doi: true,
            title: true,
            authors: true,
            year: true,
            venue: true,
          },
        },
      },
    });

    if (links.length === 0) {
      return { checked: 0, detached: 0, kept: 0 };
    }

    const observed = this.buildObservedProfile(document);
    let detached = 0;

    for (const link of links) {
      const expected = this.buildExpectedProfile(link.reference);
      const evaluation = this.evaluate(expected, observed, phase);

      if (evaluation.decision === 'detach') {
        const didDetach = await this.detachPrimaryLink(link.id, link.referenceId, documentId, phase, evaluation);
        if (didDetach) {
          detached += 1;
          console.warn(
            `[PdfMatchVerify] Detached document ${documentId} from reference ${link.referenceId} (${phase}) - ${evaluation.reason} [score=${evaluation.score}, titleSim=${evaluation.titleSimilarity.toFixed(2)}, authorOverlap=${evaluation.authorOverlap.toFixed(2)}]`
          );
        }
      } else if (evaluation.confidence !== 'high') {
        console.log(
          `[PdfMatchVerify] Kept document ${documentId} for reference ${link.referenceId} (${phase}) - ${evaluation.reason} [score=${evaluation.score}, titleSim=${evaluation.titleSimilarity.toFixed(2)}, authorOverlap=${evaluation.authorOverlap.toFixed(2)}]`
        );
      }
    }

    return {
      checked: links.length,
      detached,
      kept: links.length - detached,
    };
  }

  private buildExpectedProfile(reference: {
    id: string;
    doi: string | null;
    title: string;
    authors: string[];
    year: number | null;
    venue: string | null;
  }): ExpectedProfile {
    const title = reference.title?.trim() || null;
    return {
      referenceId: reference.id,
      doi: normalizeDoi(reference.doi),
      title,
      titleNormalized: normalizeText(title || ''),
      titleTokens: tokenizeTitle(title || ''),
      authorLastNames: toAuthorLastNameSet(reference.authors || []),
      year: typeof reference.year === 'number' ? reference.year : null,
      venue: reference.venue?.trim() || null,
    };
  }

  private buildObservedProfile(document: {
    pdfDoi: string | null;
    pdfTitle: string | null;
    pdfAuthors: string | null;
    parsedText: string | null;
  }): ObservedProfile {
    const parsedText = String(document.parsedText || '');
    const textSample = parsedText.slice(0, 16000);
    const inferredTitle = extractLikelyTitleFromText(parsedText);
    const observedTitle = document.pdfTitle?.trim() || inferredTitle || null;
    const doi = normalizeDoi(document.pdfDoi) || extractFirstDoiFromText(parsedText);
    const combinedSignalText = `${observedTitle || ''}\n${textSample}`.toLowerCase();

    return {
      doi,
      title: observedTitle,
      titleNormalized: normalizeText(observedTitle || ''),
      titleTokens: tokenizeTitle(observedTitle || ''),
      authorLastNames: toAuthorLastNameSet(document.pdfAuthors || ''),
      textSample: combinedSignalText,
      textLength: parsedText.length,
      hasSupplementarySignal: SUPPLEMENTARY_REGEX.test(combinedSignalText),
    };
  }

  private evaluate(
    expected: ExpectedProfile,
    observed: ObservedProfile,
    phase: VerificationPhase
  ): Evaluation {
    let score = 0;
    const reasons: string[] = [];

    if (expected.doi && observed.doi) {
      if (expected.doi === observed.doi) {
        score += 80;
        reasons.push('DOI exact match');
      } else {
        return {
          decision: 'detach',
          confidence: 'high',
          score: -100,
          titleSimilarity: 0,
          authorOverlap: 0,
          reason: `DOI mismatch (expected ${expected.doi}, observed ${observed.doi})`,
        };
      }
    }

    const titleSimilarity = expected.titleTokens.size > 0 && observed.titleTokens.size > 0
      ? jaccard(expected.titleTokens, observed.titleTokens)
      : 0;
    const titleEditSimilarity = normalizedEditSimilarity(expected.titleNormalized, observed.titleNormalized);
    const titleSignal = Math.max(titleSimilarity, titleEditSimilarity);
    if (titleSignal >= 0.8) {
      score += 25;
      reasons.push('Title very close');
    } else if (titleSignal >= 0.6) {
      score += 15;
      reasons.push('Title close');
    } else if (titleSignal >= 0.45) {
      score += 8;
      reasons.push('Title partial match');
    } else if (observed.title && expected.title) {
      score -= 12;
      reasons.push('Title mismatch');
    }

    const authorOverlap = overlapRatio(expected.authorLastNames, observed.authorLastNames);
    if (authorOverlap >= 0.5) {
      score += 15;
      reasons.push('Author overlap high');
    } else if (authorOverlap >= 0.25) {
      score += 8;
      reasons.push('Author overlap partial');
    } else if (expected.authorLastNames.size > 0 && observed.authorLastNames.size > 0) {
      score -= 8;
      reasons.push('Author mismatch');
    }

    if (expected.year && new RegExp(`\\b${expected.year}\\b`).test(observed.textSample)) {
      score += 5;
      reasons.push('Year found in text');
    }

    const normalizedVenue = normalizeText(expected.venue || '');
    if (normalizedVenue && normalizedVenue.length >= 6 && observed.textSample.includes(normalizedVenue)) {
      score += 4;
      reasons.push('Venue signal found');
    }

    if (observed.hasSupplementarySignal) {
      score -= 20;
      reasons.push('Supplementary/correction signal');
    }

    const observedEvidenceStrong = Boolean(observed.title) || observed.textLength >= 3000;
    const hasDoiMismatch = Boolean(expected.doi && observed.doi && expected.doi !== observed.doi);

    if (hasDoiMismatch) {
      return {
        decision: 'detach',
        confidence: 'high',
        score,
        titleSimilarity,
        authorOverlap,
        reason: 'DOI mismatch',
      };
    }

    if (phase === 'post-proactive' && observedEvidenceStrong) {
      const veryLowSemanticMatch = titleSignal < 0.2 && authorOverlap === 0;
      const likelyWrongDocument = score < 10 && veryLowSemanticMatch;
      const supplementaryMismatch = observed.hasSupplementarySignal && titleSignal < 0.35 && authorOverlap < 0.2;

      if (likelyWrongDocument || supplementaryMismatch) {
        return {
          decision: 'detach',
          confidence: 'medium',
          score,
          titleSimilarity,
          authorOverlap,
          reason: supplementaryMismatch
            ? 'Likely supplementary/correction PDF for another paper'
            : 'Title/authors do not match expected paper',
        };
      }
    }

    const confidence: 'high' | 'medium' | 'low' = score >= 70
      ? 'high'
      : score >= 35
        ? 'medium'
        : 'low';

    return {
      decision: 'keep',
      confidence,
      score,
      titleSimilarity: titleSignal,
      authorOverlap,
      reason: reasons.length > 0 ? reasons.join('; ') : 'Insufficient mismatch evidence',
    };
  }

  private async detachPrimaryLink(
    linkId: string,
    referenceId: string,
    documentId: string,
    phase: VerificationPhase,
    evaluation: Evaluation
  ): Promise<boolean> {
    try {
      await prisma.referenceDocumentLink.update({
        where: { id: linkId },
        data: { isPrimary: false },
      });
    } catch {
      return false;
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: null,
        tenantId: null,
        action: 'LIBRARY_REFERENCE_LINK_VERIFICATION_DETACHED',
        resource: 'reference_document_link',
        meta: {
          linkId,
          referenceId,
          documentId,
          phase,
          reason: evaluation.reason,
          score: evaluation.score,
          titleSimilarity: evaluation.titleSimilarity,
          authorOverlap: evaluation.authorOverlap,
          detachedAt: new Date().toISOString(),
        },
      },
    }).catch(() => undefined);

    const remainingPrimary = await prisma.referenceDocumentLink.count({
      where: {
        referenceId,
        isPrimary: true,
      },
    });

    if (remainingPrimary === 0) {
      await prisma.referenceLibrary.update({
        where: { id: referenceId },
        data: { pdfUrl: null },
      }).catch(() => undefined);
    }

    return true;
  }
}

export const pdfMatchVerificationService = new PdfMatchVerificationService();
