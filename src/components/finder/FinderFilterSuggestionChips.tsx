import React from 'react';
import { CircleSlash, SlidersHorizontal, UserCheck } from 'lucide-react';

import type { FinderFilterSuggestionChip } from '../../lib/recommendations/chatTypes';

interface FinderFilterSuggestionChipsProps {
  chips: FinderFilterSuggestionChip[];
  onApplyChip: (chip: FinderFilterSuggestionChip) => void;
  disabled?: boolean;
}

function chipIcon(chip: FinderFilterSuggestionChip) {
  if (chip.source === 'zero_results') return <CircleSlash aria-hidden className="h-3 w-3" />;
  if (chip.source === 'profile') return <UserCheck aria-hidden className="h-3 w-3" />;
  return <SlidersHorizontal aria-hidden className="h-3 w-3" />;
}

/**
 * Optional filter suggestions attached to an assistant message. Tapping a chip is a
 * manual user action — nothing here changes filters until the user clicks.
 */
export default function FinderFilterSuggestionChips({ chips, onApplyChip, disabled = false }: FinderFilterSuggestionChipsProps) {
  if (!chips.length) return null;

  return (
    <div className="mt-3">
      <div className="text-[11px] text-muted-soft">Filter suggestions — tap to apply</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {chips.map((chip, index) => (
          <button
            key={`${chip.label}-${index}`}
            type="button"
            onClick={() => onApplyChip(chip)}
            disabled={disabled}
            className="cb-chip disabled:cursor-not-allowed disabled:opacity-60"
          >
            {chipIcon(chip)}
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
