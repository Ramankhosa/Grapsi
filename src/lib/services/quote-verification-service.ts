import type { EvidenceConfidenceLevel, VerifiedEvidenceCard, ExtractedEvidenceCard } from './deep-analysis-types';

export interface VerificationResult {
  verified: boolean;
  method: 'EXACT' | 'NORMALIZED' | 'TOKEN_OVERLAP' | 'SIMILARITY' | 'FAILED';
  score: number;
  matchedSpan?: string;
}

const MAX_SIMILARITY_PAPER_CHARS = 60_000;
const SIMILARITY_CONTEXT_WINDOW = 10_000;
const TOKEN_OVERLAP_SHORT_CIRCUIT = 0.7;
const TOKEN_OVERLAP_MIN_TOKENS = 12;

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,.:;!?])\s*/g, '$1 ')
    .trim();
}

function tokenize(text: string): string[] {
  return String(text || '')
    .split(/\s+/)
    .map(token => token.replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter(Boolean);
}

function slidingWindowTokenOverlap(quoteTokens: string[], paperTokens: string[]): { score: number; span: string } {
  const windowSize = quoteTokens.length;
  if (windowSize === 0 || paperTokens.length < windowSize) {
    return { score: 0, span: '' };
  }

  const quoteSet = new Set(quoteTokens);
  let bestScore = 0;
  let bestStart = 0;

  for (let index = 0; index <= paperTokens.length - windowSize; index += 1) {
    const window = paperTokens.slice(index, index + windowSize);
    const windowSet = new Set(window);
    let intersection = 0;
    quoteSet.forEach(token => {
      if (windowSet.has(token)) {
        intersection += 1;
      }
    });
    const unionSet = new Set<string>();
    quoteSet.forEach(token => unionSet.add(token));
    windowSet.forEach(token => unionSet.add(token));
    const union = unionSet.size;
    const score = union > 0 ? intersection / union : 0;
    if (score > bestScore) {
      bestScore = score;
      bestStart = index;
    }
  }

  return {
    score: bestScore,
    span: paperTokens.slice(bestStart, bestStart + windowSize).join(' '),
  };
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

function slidingWindowLevenshtein(normQuote: string, normPaper: string): { score: number; span: string } {
  const quoteLen = normQuote.length;
  if (quoteLen === 0 || !normPaper) {
    return { score: 0, span: '' };
  }

  const margin = Math.floor(quoteLen * 0.2);
  const step = Math.max(1, Math.floor(quoteLen / 4));
  let bestScore = 0;
  let bestSpan = '';

  for (let i = 0; i < normPaper.length; i += step) {
    const candidateLengths = [quoteLen, Math.max(1, quoteLen - margin), quoteLen + margin];
    for (const candidateLen of candidateLengths) {
      if (candidateLen <= 0) continue;
      if (i + candidateLen > normPaper.length) continue;
      const candidate = normPaper.substring(i, i + candidateLen);
      const distance = levenshteinDistance(normQuote, candidate);
      const maxLen = Math.max(normQuote.length, candidate.length);
      const similarity = maxLen > 0 ? 1 - distance / maxLen : 0;
      if (similarity > bestScore) {
        bestScore = similarity;
        bestSpan = candidate;
      }
    }
  }

  return { score: bestScore, span: bestSpan };
}

function downgradeConfidence(confidence: EvidenceConfidenceLevel): EvidenceConfidenceLevel {
  if (confidence === 'HIGH') return 'MEDIUM';
  if (confidence === 'MEDIUM') return 'LOW';
  return 'LOW';
}

class QuoteVerificationService {
  private preparePaperText(paperFullText: string): {
    rawText: string;
    normalizedText: string;
    normalizedTokens: string[];
  } {
    const rawText = String(paperFullText || '');
    const normalizedText = normalize(rawText);
    const normalizedTokens = tokenize(normalizedText);

    return {
      rawText,
      normalizedText,
      normalizedTokens,
    };
  }

  private verifyQuotePrepared(
    sourceFragment: string,
    preparedPaper: { rawText: string; normalizedText: string; normalizedTokens: string[] }
  ): VerificationResult {
    const quote = String(sourceFragment || '').trim();
    const fullText = preparedPaper.rawText;

    if (!quote || !fullText) {
      return { verified: false, method: 'FAILED', score: 0 };
    }

    if (fullText.includes(quote)) {
      return { verified: true, method: 'EXACT', score: 1 };
    }

    const normQuote = normalize(quote);
    const normText = preparedPaper.normalizedText;

    if (normText.includes(normQuote)) {
      return { verified: true, method: 'NORMALIZED', score: 1 };
    }

    const quoteTokens = tokenize(normQuote);
    const overlap = slidingWindowTokenOverlap(quoteTokens, preparedPaper.normalizedTokens);
    if (overlap.score >= 0.85) {
      return {
        verified: true,
        method: 'TOKEN_OVERLAP',
        score: overlap.score,
        matchedSpan: overlap.span,
      };
    }
    if (overlap.score >= TOKEN_OVERLAP_SHORT_CIRCUIT && quoteTokens.length >= TOKEN_OVERLAP_MIN_TOKENS) {
      return {
        verified: true,
        method: 'TOKEN_OVERLAP',
        score: overlap.score,
        matchedSpan: overlap.span,
      };
    }

    let similarityText = normText;
    if (normText.length > MAX_SIMILARITY_PAPER_CHARS) {
      const overlapAnchor = overlap.span ? normText.indexOf(overlap.span) : -1;
      if (overlapAnchor !== -1) {
        const start = Math.max(0, overlapAnchor - SIMILARITY_CONTEXT_WINDOW);
        const end = Math.min(normText.length, overlapAnchor + overlap.span.length + SIMILARITY_CONTEXT_WINDOW);
        similarityText = normText.slice(start, end);
      } else {
        similarityText = normText.slice(0, MAX_SIMILARITY_PAPER_CHARS);
      }
    }

    const similarity = slidingWindowLevenshtein(normQuote, similarityText);
    if (similarity.score >= 0.8) {
      return {
        verified: true,
        method: 'SIMILARITY',
        score: similarity.score,
        matchedSpan: similarity.span,
      };
    }

    return {
      verified: false,
      method: 'FAILED',
      score: similarity.score,
      matchedSpan: similarity.span,
    };
  }

  verifyQuote(sourceFragment: string, paperFullText: string): VerificationResult {
    return this.verifyQuotePrepared(sourceFragment, this.preparePaperText(paperFullText));
  }

  applyVerificationToCard(card: ExtractedEvidenceCard, result: VerificationResult): VerifiedEvidenceCard {
    let confidence = card.confidence;

    if (!result.verified) {
      confidence = 'LOW';
    } else if (result.method === 'SIMILARITY' && result.score < 0.9) {
      // For decent similarity (0.8-0.9), only downgrade HIGH→MEDIUM.
      // Don't push MEDIUM→LOW to avoid double-penalty when extraction
      // rules already downgraded the card (e.g. missing doesNotSupport).
      if (confidence === 'HIGH') {
        confidence = 'MEDIUM';
      }
    }

    return {
      ...card,
      confidence,
      quoteVerified: result.verified,
      quoteVerificationMethod: result.method,
      quoteVerificationScore: Number.isFinite(result.score) ? result.score : 0,
    };
  }

  verifyAllCards(cards: ExtractedEvidenceCard[], paperText: string): VerifiedEvidenceCard[] {
    const preparedPaper = this.preparePaperText(paperText);
    return cards.map(card => {
      const verification = this.verifyQuotePrepared(card.sourceFragment, preparedPaper);
      return this.applyVerificationToCard(card, verification);
    });
  }
}

export const quoteVerificationService = new QuoteVerificationService();
export { QuoteVerificationService };
