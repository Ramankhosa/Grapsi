import React from 'react';
import type { RecommendationSearchFilters, RecommendationStrictFilterRecovery } from '../lib/recommendations/types';
import {
  describeStrictRecoveryFilters,
  describeStrictRecoverySentence,
} from '../lib/recommendations/finderUi';

interface FinderStrictFilterRecoveryNoticeProps {
  filters: Required<RecommendationSearchFilters>;
  recovery: RecommendationStrictFilterRecovery;
  onRetry: () => void;
}

export default function FinderStrictFilterRecoveryNotice({
  filters,
  recovery,
  onRetry,
}: FinderStrictFilterRecoveryNoticeProps) {
  const restrictiveFilters = describeStrictRecoveryFilters(filters, recovery);
  const summary = describeStrictRecoverySentence(filters, recovery);

  return (
    <div className="mb-5 rounded-[24px] border border-amber-300 bg-amber-50 p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">No Matches With Current Filters</div>
      <p className="mt-2 text-sm leading-6 text-amber-950">{summary}</p>
      {restrictiveFilters.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {restrictiveFilters.map((item) => (
            <span
              key={item}
              className="rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-900"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
        >
          Retry without these filters
        </button>
      </div>
    </div>
  );
}
