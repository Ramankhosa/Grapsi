import type {
  PaperMetadataQuery,
  RecommendationDegradedMode,
  RecommendationInputMode,
  RecommendationNoResultsReason,
  RecommendationRawResultItem,
  RecommendationSearchDiagnostics,
  RecommendationSearchFilters,
} from './types';

export type RecommendationConversationIntent =
  | 'new_search'
  | 'refine_filters'
  | 'clear_filters'
  | 'compare_results'
  | 'explain_result'
  | 'browse_more'
  | 'clarification_needed'
  | 'general_help'
  | 'call_question'
  | 'funding_strategy'
  | 'small_talk';

/**
 * How the conversation treats filters.
 * - 'manual' (default): the assistant never changes filters; every search runs strictly
 *   within the user's current filters. The assistant may only SUGGEST filters as chips.
 * - 'auto': legacy behavior — the assistant applies explicitly requested filters and
 *   proposes inferred ones through the pending-confirmation flow.
 */
export type RecommendationFilterMode = 'manual' | 'auto';

/**
 * A filter suggestion rendered as a clickable chip. Clicking a chip is a manual user
 * action: the client composes the next filters from the current ones plus this chip
 * (union per array key in `patch`, assignment for scalars, reset for `clearKeys`).
 */
export interface FinderFilterSuggestionChip {
  label: string;
  patch: Partial<RecommendationSearchFilters>;
  clearKeys?: Array<keyof RecommendationSearchFilters>;
  source: 'llm' | 'zero_results' | 'profile';
}

export type RecommendationConversationMessageRole = 'user' | 'assistant';
export type RecommendationConversationMessageType =
  | 'user_message'
  | 'assistant_response'
  | 'assistant_confirmation'
  | 'assistant_notice';

export interface RecommendationConversationQueryState {
  inputMode: RecommendationInputMode;
  query: PaperMetadataQuery | { researchArea: string };
}

export interface RecommendationConversationPendingPatch {
  baseStateHash: string;
  turnIndex: number;
  requiresConfirmation: boolean;
  summary: string;
  reason: string;
  nextInputMode: RecommendationInputMode;
  nextQuery: RecommendationConversationQueryState['query'];
  nextFilters: Required<RecommendationSearchFilters>;
}

export interface RecommendationConversationDocumentCitation {
  sectionTitle: string | null;
  sectionType: string;
  pageStart: number;
  pageEnd: number;
  documentVersion: number;
}

export interface RecommendationConversationCitation {
  runId: string;
  resultIds: string[];
  documentCitations?: RecommendationConversationDocumentCitation[];
}

export interface RecommendationConversationMessageRecord {
  id: string;
  turnIndex: number;
  role: RecommendationConversationMessageRole;
  messageType: RecommendationConversationMessageType;
  content: string;
  createdAt: string;
  citations: RecommendationConversationCitation | null;
  suggestedReplies?: string[];
  filterSuggestions?: FinderFilterSuggestionChip[];
}

export interface RecommendationConversationRunRecord {
  id: string;
  turnIndex: number;
  runIndex: number;
  createdAt: string;
  degradedMode: RecommendationDegradedMode;
  lowConfidence: boolean;
  noResultsReason: RecommendationNoResultsReason;
  searchDiagnostics: RecommendationSearchDiagnostics | null;
  profileDiagnostics: RecommendationSearchDiagnostics['profile'] | null;
  results: RecommendationRawResultItem[];
}

export interface RecommendationConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  preview: string | null;
  currentInputMode: RecommendationInputMode;
  filterMode: RecommendationFilterMode;
  hasPendingPatch: boolean;
}

export interface RecommendationConversationDetail {
  id: string;
  title: string;
  updatedAt: string;
  currentInputMode: RecommendationInputMode;
  filterMode: RecommendationFilterMode;
  currentQuery: RecommendationConversationQueryState['query'];
  currentFilters: Required<RecommendationSearchFilters>;
  pendingFilterPatch: RecommendationConversationPendingPatch | null;
  lastRunId: string | null;
  messages: RecommendationConversationMessageRecord[];
  runs: RecommendationConversationRunRecord[];
}

export interface RecommendationConversationMessageRequest {
  message?: string;
  inputMode?: RecommendationInputMode;
  manualQueryPatch?: RecommendationConversationQueryState['query'];
  manualFilterPatch?: RecommendationSearchFilters;
  replaceManualFilters?: boolean;
  clientTurnId?: string;
  filterMode?: RecommendationFilterMode;
  useProfileContext?: boolean;
  useEligibilityProfile?: boolean;
  usePublicationContext?: boolean;
}

export interface RecommendationConversationMutationResponse {
  conversation: RecommendationConversationDetail;
  stale: boolean;
  clientTurnId?: string | null;
}

export type FinderTurnStreamStage = 'understanding' | 'searching' | 'reading_documents' | 'composing';

/**
 * Events emitted by the streaming chat route, in order:
 * turn → stage* → results? → token* → final (or error) → done.
 * `final` carries the exact classic-route response and is always authoritative —
 * clients replace any accumulated streamed text with it.
 */
export type FinderTurnStreamEvent =
  | { type: 'turn'; turnIndex: number; clientTurnId: string | null }
  | { type: 'stage'; stage: FinderTurnStreamStage; label: string; detail?: string }
  | {
      type: 'results';
      results: RecommendationRawResultItem[];
      totalResults: number;
      appliedFilters: Required<RecommendationSearchFilters>;
      noResultsReason: RecommendationNoResultsReason;
      lowConfidence: boolean;
      degradedMode: RecommendationDegradedMode;
    }
  | { type: 'token'; delta: string }
  | { type: 'final'; response: RecommendationConversationMutationResponse }
  | {
      type: 'error';
      error: string;
      code?: 'GEMINI_RATE_LIMITED' | 'RATE_LIMITED' | 'INTERNAL';
      retryAfterMs?: number | null;
      persisted: boolean;
    };

export type FinderTurnStreamEmitter = (event: FinderTurnStreamEvent) => void;
