import React from 'react';
import { FaHandPaper, FaMagic } from 'react-icons/fa';

import type { RecommendationFilterMode } from '../../lib/recommendations/chatTypes';

interface FinderFilterModeToggleProps {
  mode: RecommendationFilterMode;
  onChange: (mode: RecommendationFilterMode) => void;
  disabled?: boolean;
  compact?: boolean;
}

const MODE_COPY: Record<RecommendationFilterMode, { label: string; hint: string; icon: React.ReactNode }> = {
  manual: {
    label: 'Manual filters',
    hint: 'You control the filters. The assistant only suggests — every search stays within your filters.',
    icon: <FaHandPaper aria-hidden className="text-[10px]" />,
  },
  auto: {
    label: 'Auto filters',
    hint: 'The assistant applies filters it reads from your messages and asks before applying inferred ones.',
    icon: <FaMagic aria-hidden className="text-[10px]" />,
  },
};

export default function FinderFilterModeToggle({ mode, onChange, disabled = false, compact = false }: FinderFilterModeToggleProps) {
  return (
    <div className={compact ? '' : 'space-y-1.5'}>
      <div
        role="radiogroup"
        aria-label="Filter mode"
        className="inline-flex rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm"
      >
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
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? 'bg-slate-950 text-white shadow-[0_6px_16px_rgba(15,23,42,0.25)]'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {MODE_COPY[value].icon}
              {MODE_COPY[value].label}
            </button>
          );
        })}
      </div>
      {!compact ? (
        <p className="max-w-xs text-[11px] leading-4 text-slate-500">{MODE_COPY[mode].hint}</p>
      ) : null}
    </div>
  );
}
