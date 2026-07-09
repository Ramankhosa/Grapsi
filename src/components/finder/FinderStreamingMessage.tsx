import React from 'react';
import { FaCheck, FaRobot } from 'react-icons/fa';

import type { FinderTurnStreamStage } from '../../lib/recommendations/chatTypes';
import type { RecommendationRawResultItem } from '../../lib/recommendations/types';
import FinderMarkdown from './FinderMarkdown';
import FinderResultCard from './FinderResultCard';

export interface StreamingStageEntry {
  stage: FinderTurnStreamStage;
  label: string;
  detail?: string;
  done: boolean;
}

export interface StreamingTurnView {
  stages: StreamingStageEntry[];
  results: RecommendationRawResultItem[] | null;
  totalResults: number;
  text: string;
}

interface FinderStreamingMessageProps {
  turn: StreamingTurnView;
  getCallDetailsHref?: (resultId: string) => string;
}

/**
 * The in-flight assistant turn while an SSE response streams in: a live stage checklist,
 * result cards the moment the search lands, then the narrative typing out token by token.
 */
export default function FinderStreamingMessage({ turn, getCallDetailsHref }: FinderStreamingMessageProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950">
        <FaRobot className="animate-pulse" />
      </div>

      <div className="max-w-[92%] flex-1 rounded-[26px] border border-white/60 bg-white/92 px-5 py-4 text-slate-900 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">GrantGenie Finder</div>

        {turn.stages.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {turn.stages.map((entry, index) => (
              <div key={`${entry.stage}-${index}`} className="flex items-center gap-2 text-xs font-medium">
                {entry.done ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[9px] text-emerald-700">
                    <FaCheck />
                  </span>
                ) : (
                  <span className="h-4 w-4">
                    <span className="block h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                  </span>
                )}
                <span className={entry.done ? 'text-slate-400' : 'text-slate-700'}>
                  {entry.label}
                  {entry.detail ? <span className="text-slate-400"> — {entry.detail}</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {turn.results && turn.results.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {turn.results.map((result, index) => (
              <FinderResultCard
                key={result.id}
                result={result}
                ordinal={index + 1}
                getCallDetailsHref={getCallDetailsHref}
                compact
              />
            ))}
            {turn.totalResults > turn.results.length ? (
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                +{turn.totalResults - turn.results.length} more matches
              </div>
            ) : null}
          </div>
        ) : null}

        {turn.text ? (
          <div className="mt-3 text-sm leading-7 text-slate-700">
            <FinderMarkdown content={turn.text} />
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse rounded bg-emerald-500 align-text-bottom" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
