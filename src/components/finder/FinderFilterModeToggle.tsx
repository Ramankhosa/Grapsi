import React from 'react';
import { Hand, Wand2 } from 'lucide-react';

import type { RecommendationFilterMode } from '../../lib/recommendations/chatTypes';

interface FinderFilterModeToggleProps {
  mode: RecommendationFilterMode;
  onChange: (mode: RecommendationFilterMode) => void;
  disabled?: boolean;
  compact?: boolean;
}

const MODE_COPY: Record<RecommendationFilterMode, { label: string; hint: string; icon: React.ReactNode }> = {
  manual: {
    label: 'Manual',
    hint: 'You control the filters. The assistant only suggests — every search stays within your filters.',
    icon: <Hand aria-hidden className="h-3.5 w-3.5" />,
  },
  auto: {
    label: 'Auto',
    hint: 'The assistant applies filters it reads from your messages and asks before applying inferred ones.',
    icon: <Wand2 aria-hidden className="h-3.5 w-3.5" />,
  },
};

export default function FinderFilterModeToggle({ mode, onChange, disabled = false, compact = false }: FinderFilterModeToggleProps) {
  return (
    <div className={compact ? '' : 'space-y-1.5'}>
      <div role="radiogroup" aria-label="Filter mode" className="flex gap-1 rounded-lg border border-hairline bg-inset p-1">
        {(['manual', 'auto'] as const).map((value) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                if (!active) onChange(value);
              }}
              title={MODE_COPY[value].hint}
              className={`inline-flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? 'bg-ground text-cobalt-700 shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {MODE_COPY[value].icon}
              {MODE_COPY[value].label}
            </button>
          );
        })}
      </div>
      {!compact ? <p className="text-[11px] leading-4 text-muted">{MODE_COPY[mode].hint}</p> : null}
    </div>
  );
}
