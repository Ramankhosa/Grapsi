import React from 'react';
import { FaRobot, FaUserCircle } from 'react-icons/fa';

import type {
  FinderFilterSuggestionChip,
  RecommendationConversationMessageRecord,
  RecommendationConversationRunRecord,
} from '../lib/recommendations/chatTypes';
import FinderFilterSuggestionChips from './finder/FinderFilterSuggestionChips';
import FinderMarkdown from './finder/FinderMarkdown';
import FinderResultCard from './finder/FinderResultCard';

interface FinderChatMessageProps {
  message: RecommendationConversationMessageRecord;
  runs: RecommendationConversationRunRecord[];
  onExplainResult?: (payload: { runId: string; resultId: string; ordinal: number }) => void;
  onAskAboutCall?: (payload: { runId: string; resultId: string; ordinal: number }) => void;
  onBeginWriting?: (payload: { resultId: string }) => void;
  onSuggestedReply?: (message: string) => void;
  onApplyFilterChip?: (chip: FinderFilterSuggestionChip) => void;
  getCallDetailsHref?: (resultId: string) => string;
  strictRecoveryAction?: {
    summary: string;
    onRetry: () => void;
  } | null;
  suggestedReplyDisabled?: boolean;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function FinderChatMessage({
  message,
  runs,
  onExplainResult,
  onAskAboutCall,
  onBeginWriting,
  onSuggestedReply,
  onApplyFilterChip,
  getCallDetailsHref,
  strictRecoveryAction = null,
  suggestedReplyDisabled = false,
}: FinderChatMessageProps) {
  const citedRun = message.citations ? runs.find((run) => run.id === message.citations?.runId) : null;
  const citedResults = message.citations
    ? citedRun?.results.filter((result) => message.citations?.resultIds.includes(result.id)) || []
    : [];
  const documentCitations = message.citations?.documentCitations || [];
  const assistant = message.role === 'assistant';
  const bubbleClass = assistant
    ? 'border-white/60 bg-white/92 text-slate-900'
    : 'border-slate-950 bg-[linear-gradient(135deg,_#0f172a_0%,_#111827_55%,_#052e2b_100%)] text-white shadow-[0_18px_42px_rgba(15,23,42,0.26)]';
  const labelClass = assistant ? 'text-emerald-700' : 'text-emerald-100';
  const timeClass = assistant ? 'text-slate-400' : 'text-emerald-100/70';
  const bodyClass = assistant ? 'text-slate-700' : 'text-white';

  return (
    <div className={`flex gap-4 ${assistant ? 'items-start' : 'items-start flex-row-reverse'}`}>
      <div
        className={`mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
          assistant ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-white'
        }`}
      >
        {assistant ? <FaRobot /> : <FaUserCircle />}
      </div>

      <div className={`max-w-[92%] rounded-[26px] border px-5 py-4 shadow-sm ${bubbleClass}`}>
        <div className="flex items-center justify-between gap-3">
          <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${labelClass}`}>
            {assistant ? 'GrantGenie Finder' : 'You'}
          </div>
          <div className={`text-[11px] uppercase tracking-[0.16em] ${timeClass}`}>{formatTime(message.createdAt)}</div>
        </div>

        <div className={`mt-3 text-sm leading-7 ${bodyClass}`}>
          <FinderMarkdown content={message.content} inverted={!assistant} />
        </div>

        {assistant && documentCitations.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {documentCitations.slice(0, 4).map((citation, index) => (
              <span
                key={`${citation.sectionType}-${citation.pageStart}-${index}`}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600"
                title="Cited from the call's uploaded document"
              >
                {citation.sectionTitle || citation.sectionType.replace(/_/g, ' ')}
                {citation.pageStart ? ` · p. ${citation.pageStart}${citation.pageEnd !== citation.pageStart ? `-${citation.pageEnd}` : ''}` : ''}
                {` · v${citation.documentVersion}`}
              </span>
            ))}
          </div>
        ) : null}

        {assistant && onSuggestedReply && message.suggestedReplies?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {message.suggestedReplies.map((reply) => (
              <button
                key={reply}
                type="button"
                onClick={() => onSuggestedReply(reply)}
                disabled={suggestedReplyDisabled}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-900 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reply}
              </button>
            ))}
          </div>
        ) : null}

        {assistant && onApplyFilterChip && message.filterSuggestions?.length ? (
          <FinderFilterSuggestionChips
            chips={message.filterSuggestions}
            onApplyChip={onApplyFilterChip}
            disabled={suggestedReplyDisabled}
          />
        ) : null}

        {assistant && strictRecoveryAction ? (
          <div className="mt-4 rounded-[20px] border border-amber-300 bg-amber-50 px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Retry Available</div>
            <p className="mt-2 text-sm leading-6 text-amber-950">{strictRecoveryAction.summary}</p>
            <button
              type="button"
              onClick={strictRecoveryAction.onRetry}
              className="mt-3 rounded-full bg-amber-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-950 transition-colors hover:bg-amber-400"
            >
              Retry without these filters
            </button>
          </div>
        ) : null}

        {citedResults.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {citedResults.map((result, index) => {
              const ordinal = (citedRun?.results.findIndex((item) => item.id === result.id) ?? index) + 1;
              const runId = citedRun?.id || message.citations?.runId || '';
              return (
                <FinderResultCard
                  key={result.id}
                  result={result}
                  ordinal={ordinal}
                  onBeginWriting={onBeginWriting}
                  onExplainResult={
                    onExplainResult ? () => onExplainResult({ runId, resultId: result.id, ordinal }) : undefined
                  }
                  onAskAboutCall={
                    onAskAboutCall ? () => onAskAboutCall({ runId, resultId: result.id, ordinal }) : undefined
                  }
                  getCallDetailsHref={getCallDetailsHref}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
