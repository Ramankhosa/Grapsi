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
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="text-[13px] font-medium text-amber-900">No matches with current filters</div>
      <p className="mt-1 text-[13px] leading-5 text-amber-800">{summary}</p>
      {restrictiveFilters.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {restrictiveFilters.map((item) => (
            <span key={item} className="inline-flex items-center rounded-md bg-white px-2 py-0.5 text-[12px] text-amber-900">
              {item}
            </span>
          ))}
        </div>
      ) : null}
      <button type="button" onClick={onRetry} className="cb-btn-secondary cb-btn-sm mt-3">
        Retry without these filters
      </button>
    </div>
  );
}
