import React from 'react';
import { Check, X } from 'lucide-react';

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
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-amber-900">Pending Filter Confirmation</div>
          <p className="mt-0.5 text-[13px] leading-5 text-amber-800">{pendingPatch.summary}</p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={onConfirm} disabled={disabled} className="cb-btn-primary cb-btn-sm">
            <Check className="h-3.5 w-3.5" />
            Confirm
          </button>
          <button type="button" onClick={onReject} disabled={disabled} className="cb-btn-secondary cb-btn-sm">
            <X className="h-3.5 w-3.5" />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
