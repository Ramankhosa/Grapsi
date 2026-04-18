import React from 'react';
import { FaCheck, FaTimes } from 'react-icons/fa';

import type { RecommendationConversationPendingPatch } from '../lib/recommendations/chatTypes';

interface FinderPendingFilterConfirmationBarProps {
  pendingPatch: RecommendationConversationPendingPatch;
  disabled?: boolean;
  onConfirm: () => void;
  onReject: () => void;
}

export default function FinderPendingFilterConfirmationBar({
  pendingPatch,
  disabled = false,
  onConfirm,
  onReject,
}: FinderPendingFilterConfirmationBarProps) {
  return (
    <div className="mb-4 rounded-[22px] border border-amber-300 bg-amber-50 px-4 py-4 shadow-[0_10px_30px_rgba(217,119,6,0.12)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800">Pending Filter Confirmation</div>
          <p className="mt-1 text-sm leading-6 text-amber-950">{pendingPatch.summary}</p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FaCheck />
            Confirm
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-950 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FaTimes />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
