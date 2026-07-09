import React from 'react';
import { FaFilter, FaTimesCircle, FaUserCheck } from 'react-icons/fa';

import type { FinderFilterSuggestionChip } from '../../lib/recommendations/chatTypes';

interface FinderFilterSuggestionChipsProps {
  chips: FinderFilterSuggestionChip[];
  onApplyChip: (chip: FinderFilterSuggestionChip) => void;
  disabled?: boolean;
}

function chipIcon(chip: FinderFilterSuggestionChip) {
  if (chip.source === 'zero_results') return <FaTimesCircle aria-hidden className="text-[10px]" />;
  if (chip.source === 'profile') return <FaUserCheck aria-hidden className="text-[10px]" />;
  return <FaFilter aria-hidden className="text-[10px]" />;
}

function chipClass(chip: FinderFilterSuggestionChip) {
  if (chip.source === 'zero_results') {
    return 'border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100';
  }
  if (chip.source === 'profile') {
    return 'border-violet-200 bg-violet-50 text-violet-900 hover:border-violet-300 hover:bg-violet-100';
  }
  return 'border-slate-300 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-900';
}

/**
 * Optional filter suggestions attached to an assistant message. Tapping a chip is a
 * manual user action — nothing here changes filters until the user clicks.
 */
export default function FinderFilterSuggestionChips({ chips, onApplyChip, disabled = false }: FinderFilterSuggestionChipsProps) {
  if (!chips.length) return null;

  return (
    <div className="mt-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        Filter suggestions — tap to apply
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((chip, index) => (
          <button
            key={`${chip.label}-${index}`}
            type="button"
            onClick={() => onApplyChip(chip)}
            disabled={disabled}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${chipClass(chip)}`}
          >
            {chipIcon(chip)}
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
