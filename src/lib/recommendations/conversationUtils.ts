import {
  CHAT_INLINE_RESULT_LIMIT,
  RECOMMENDATION_SORT_OPTIONS,
} from './constants';
import type {
  RecommendationConversationPendingPatch,
  RecommendationConversationQueryState,
} from './chatTypes';
import type {
  RecommendationInputMode,
  RecommendationRawResultItem,
  RecommendationSearchFilters,
  RecommendationSearchRequest,
} from './types';
import {
  createRequestHash,
  normalizeRecommendationSearchRequest,
  normalizeWhitespace,
  validateRecommendationRequest,
} from './utils';

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  last: -1,
};

export function createDefaultFilters(): Required<RecommendationSearchFilters> {
  return normalizeRecommendationSearchRequest({
    inputMode: 'research_area',
    query: { researchArea: 'general research funding' },
    filters: {
      includeExpired: false,
      limit: 10,
      sort: RECOMMENDATION_SORT_OPTIONS[0],
    },
  }).filters;
}

export function createDefaultConversationState(
  inputMode: RecommendationInputMode = 'research_area'
): RecommendationConversationQueryState {
  return {
    inputMode,
    query:
      inputMode === 'paper_metadata'
        ? { title: '', abstract: '', keywords: [] }
        : { researchArea: '' },
  };
}

export function normalizeConversationState(
  inputMode: RecommendationInputMode,
  query: RecommendationConversationQueryState['query'],
  filters: RecommendationSearchFilters
) {
  const request: RecommendationSearchRequest =
    inputMode === 'paper_metadata'
      ? {
          inputMode,
          query: {
            title: typeof (query as { title?: string }).title === 'string' ? (query as { title?: string }).title : '',
            abstract: typeof (query as { abstract?: string }).abstract === 'string' ? (query as { abstract?: string }).abstract : '',
            keywords: Array.isArray((query as { keywords?: string[] }).keywords) ? (query as { keywords?: string[] }).keywords : [],
          },
          filters,
        }
      : {
          inputMode,
          query: {
            researchArea:
              typeof (query as { researchArea?: string }).researchArea === 'string'
                ? (query as { researchArea?: string }).researchArea || ''
                : '',
          },
          filters,
        };

  return normalizeRecommendationSearchRequest(request);
}

export function buildSearchRequestFromConversationState(
  inputMode: RecommendationInputMode,
  query: RecommendationConversationQueryState['query'],
  filters: RecommendationSearchFilters
): RecommendationSearchRequest {
  if (inputMode === 'paper_metadata') {
    return {
      inputMode,
      query: {
        title: typeof (query as { title?: string }).title === 'string' ? (query as { title?: string }).title : '',
        abstract: typeof (query as { abstract?: string }).abstract === 'string' ? (query as { abstract?: string }).abstract : '',
        keywords: Array.isArray((query as { keywords?: string[] }).keywords) ? (query as { keywords?: string[] }).keywords : [],
      },
      filters,
    };
  }

  return {
    inputMode,
    query: {
      researchArea:
        typeof (query as { researchArea?: string }).researchArea === 'string'
          ? (query as { researchArea?: string }).researchArea || ''
          : '',
    },
    filters,
  };
}

export function isConversationStateSearchable(
  inputMode: RecommendationInputMode,
  query: RecommendationConversationQueryState['query'],
  filters: RecommendationSearchFilters
) {
  const request = buildSearchRequestFromConversationState(inputMode, query, filters);
  return !validateRecommendationRequest(request);
}

export function buildConversationStateHash(
  inputMode: RecommendationInputMode,
  query: RecommendationConversationQueryState['query'],
  filters: RecommendationSearchFilters
) {
  return createRequestHash({
    inputMode,
    query,
    filters,
  });
}

export function extractOrdinals(message: string, maxResults: number) {
  const normalized = normalizeWhitespace(message).toLowerCase();
  const matches = new Set<number>();

  normalized.match(/\b\d+\b/g)?.forEach((value) => {
    const parsed = Number(value);
    if (parsed >= 1 && parsed <= maxResults) {
      matches.add(parsed);
    }
  });

  Object.entries(ORDINAL_WORDS).forEach(([word, ordinal]) => {
    if (normalized.includes(word)) {
      if (ordinal === -1 && maxResults > 0) {
        matches.add(maxResults);
      } else if (ordinal >= 1 && ordinal <= maxResults) {
        matches.add(ordinal);
      }
    }
  });

  return Array.from(matches).sort((left, right) => left - right);
}

export function extractJsonObject(rawText: string) {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {}

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    } catch {
      throw new Error('Failed to parse JSON object from model response: malformed JSON between braces');
    }
  }

  throw new Error('Failed to parse JSON object from model response: no JSON object found');
}

export function createConversationTitle(seed: string) {
  const cleaned = normalizeWhitespace(seed.replace(/^find\s+/i, '').replace(/^search\s+/i, ''));
  if (!cleaned) {
    return 'New Funding Chat';
  }
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

export function limitInlineResults(results: RecommendationRawResultItem[]) {
  return results.slice(0, CHAT_INLINE_RESULT_LIMIT);
}

export function serializePendingPatchSummary(pendingPatch: RecommendationConversationPendingPatch | null) {
  if (!pendingPatch) {
    return null;
  }
  return pendingPatch.summary;
}
