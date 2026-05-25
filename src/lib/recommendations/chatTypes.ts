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
  | 'general_help';

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

export interface RecommendationConversationCitation {
  runId: string;
  resultIds: string[];
}

export interface RecommendationConversationMessageRecord {
  id: string;
  turnIndex: number;
  role: RecommendationConversationMessageRole;
  messageType: RecommendationConversationMessageType;
  content: string;
  createdAt: string;
  citations: RecommendationConversationCitation | null;
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
  hasPendingPatch: boolean;
}

export interface RecommendationConversationDetail {
  id: string;
  title: string;
  updatedAt: string;
  currentInputMode: RecommendationInputMode;
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
  useProfileContext?: boolean;
  useEligibilityProfile?: boolean;
  usePublicationContext?: boolean;
}

export interface RecommendationConversationMutationResponse {
  conversation: RecommendationConversationDetail;
  stale: boolean;
  clientTurnId?: string | null;
}
