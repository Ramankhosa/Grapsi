import React from 'react';
import { Check, Sparkles } from 'lucide-react';

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
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-700">
        <Sparkles className="h-3.5 w-3.5 animate-pulse" />
      </span>

      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-ink">Finder</span>

        {turn.stages.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {turn.stages.map((entry, index) => (
              <div key={`${entry.stage}-${index}`} className="flex items-center gap-2 text-[12px]">
                {entry.done ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cobalt-50 text-cobalt-700">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                ) : (
                  <span className="block h-4 w-4 animate-spin rounded-full border-2 border-cobalt-600 border-t-transparent" />
                )}
                <span className={entry.done ? 'text-muted-soft' : 'text-ink-soft'}>
                  {entry.label}
                  {entry.detail ? <span className="text-muted-soft"> — {entry.detail}</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {turn.results && turn.results.length > 0 ? (
          <div className="mt-3 grid gap-2.5">
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
              <div className="text-[12px] text-muted">+{turn.totalResults - turn.results.length} more matches</div>
            ) : null}
          </div>
        ) : null}

        {turn.text ? (
          <div className="mt-2 text-sm leading-6 text-ink-soft">
            <FinderMarkdown content={turn.text} />
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse rounded bg-cobalt-600 align-text-bottom" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
