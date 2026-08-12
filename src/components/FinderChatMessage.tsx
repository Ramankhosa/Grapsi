import React from 'react';
import { Sparkles } from 'lucide-react';

import type {
  RecommendationConversationMessageRecord,
  RecommendationConversationRunRecord,
} from '../lib/recommendations/chatTypes';
import FinderMarkdown from './finder/FinderMarkdown';
import FinderResultCard from './finder/FinderResultCard';
import FinderResultsHeader from './finder/FinderResultsHeader';

interface FinderChatMessageProps {
  message: RecommendationConversationMessageRecord;
  runs: RecommendationConversationRunRecord[];
  onBeginWriting?: (payload: { resultId: string }) => void;
  getCallDetailsHref?: (resultId: string) => string;
  strictRecoveryAction?: {
    summary: string;
    onRetry: () => void;
  } | null;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * One turn in the conversation. The researcher's own message is a compact cobalt
 * bubble on the right; the assistant answers as plain text on the page ground so
 * long explanations and result cards read like a document, not a chat toy.
 * Cited result cards render ABOVE the narrative to mirror FinderStreamingMessage —
 * keep the two in the same order or the layout jumps when a stream finalizes.
 */
export default function FinderChatMessage({
  message,
  runs,
  onBeginWriting,
  getCallDetailsHref,
  strictRecoveryAction = null,
}: FinderChatMessageProps) {
  const citedRun = message.citations ? runs.find((run) => run.id === message.citations?.runId) : null;
  const citedResults = message.citations
    ? citedRun?.results.filter((result) => message.citations?.resultIds.includes(result.id)) || []
    : [];
  const documentCitations = message.citations?.documentCitations || [];
  const assistant = message.role === 'assistant';

  if (!assistant) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-cobalt-600 px-4 py-2.5 text-white">
          <div className="text-sm leading-6">
            <FinderMarkdown content={message.content} inverted />
          </div>
          <div className="mt-1 text-right text-[11px] text-cobalt-100">{formatTime(message.createdAt)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-700">
        <Sparkles className="h-3.5 w-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-ink">Finder</span>
          <span className="text-[11px] text-muted-soft">{formatTime(message.createdAt)}</span>
        </div>

        {citedResults.length > 0 ? <FinderResultsHeader shown={citedResults.length} /> : null}

        {citedResults.length > 0 ? (
          // grid-cols-1 (minmax(0,1fr)) not bare `grid`: an auto track sizes to the
          // cards' min-content and would overflow the chat column on phones.
          <div className="mt-2 grid grid-cols-1 gap-2.5">
            {citedResults.map((result, index) => {
              const ordinal = (citedRun?.results.findIndex((item) => item.id === result.id) ?? index) + 1;
              return (
                <FinderResultCard
                  key={result.id}
                  result={result}
                  ordinal={ordinal}
                  onBeginWriting={onBeginWriting}
                  getCallDetailsHref={getCallDetailsHref}
                />
              );
            })}
          </div>
        ) : null}

        <div className="mt-2 text-sm leading-6 text-ink-soft">
          <FinderMarkdown content={message.content} />
        </div>

        {documentCitations.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {documentCitations.slice(0, 4).map((citation, index) => (
              <span
                key={`${citation.sectionType}-${citation.pageStart}-${index}`}
                className="cb-badge"
                title="Cited from the call's uploaded document"
              >
                {citation.sectionTitle || citation.sectionType.replace(/_/g, ' ')}
                {citation.pageStart ? ` · p. ${citation.pageStart}${citation.pageEnd !== citation.pageStart ? `-${citation.pageEnd}` : ''}` : ''}
                {` · v${citation.documentVersion}`}
              </span>
            ))}
          </div>
        ) : null}

        {strictRecoveryAction ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[13px] leading-5 text-amber-900">{strictRecoveryAction.summary}</p>
            <button type="button" onClick={strictRecoveryAction.onRetry} className="cb-btn-secondary cb-btn-sm mt-2.5">
              Retry without these filters
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
