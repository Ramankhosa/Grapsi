import React from 'react';
import { FaFilter, FaTimes, FaUndo } from 'react-icons/fa';

import type { RecommendationSearchFilters } from '../../lib/recommendations/types';
import { FILTER_LABELS } from '../../lib/recommendations/filterChips';

interface FinderSidebarFiltersProps {
  filters: Required<RecommendationSearchFilters>;
  onRemoveArrayValue: (key: keyof RecommendationSearchFilters, value: string) => void;
  onClearScalar: (key: keyof RecommendationSearchFilters) => void;
  onOpenFilterEditor: () => void;
  onClearAllFilters: () => void;
  onUndo?: () => void;
  disabled?: boolean;
}

const ARRAY_FILTER_KEYS: Array<keyof RecommendationSearchFilters> = [
  'geographyScope',
  'eligibleCountries',
  'eligibleRegions',
  'hostCountries',
  'funderCountries',
  'fundingKinds',
  'institutionTypes',
  'careerStages',
  'citizenshipRequirements',
  'residencyRequirements',
  'applicationLanguages',
  'sponsorTypes',
  'taxonomyAreaIds',
];

/**
 * The always-visible manual filter panel: every active constraint as a removable chip,
 * grouped by category. This is the user's single source of truth for the search space.
 */
export default function FinderSidebarFilters({
  filters,
  onRemoveArrayValue,
  onClearScalar,
  onOpenFilterEditor,
  onClearAllFilters,
  onUndo,
  disabled = false,
}: FinderSidebarFiltersProps) {
  const groups = ARRAY_FILTER_KEYS
    .map((key) => ({ key, label: FILTER_LABELS[key] || String(key), values: (filters[key] as string[]) || [] }))
    .filter((group) => group.values.length > 0);

  const scalarChips: Array<{ key: keyof RecommendationSearchFilters; label: string }> = [];
  if (filters.deadlineFrom || filters.deadlineTo) {
    scalarChips.push({
      key: 'deadlineFrom',
      label: `Deadline: ${filters.deadlineFrom || 'any'} → ${filters.deadlineTo || 'open'}`,
    });
  }
  if (filters.rollingOnly) scalarChips.push({ key: 'rollingOnly', label: 'Rolling only' });
  if (filters.includeExpired) scalarChips.push({ key: 'includeExpired', label: 'Include expired' });
  if (filters.amountMin !== null) scalarChips.push({ key: 'amountMin', label: `Min amount: ${filters.amountMin}` });
  if (filters.amountMax !== null) scalarChips.push({ key: 'amountMax', label: `Max amount: ${filters.amountMax}` });

  const totalActive = groups.reduce((sum, group) => sum + group.values.length, 0) + scalarChips.length;

  return (
    <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <FaFilter className="text-emerald-600" />
          Your Filters
          {totalActive > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold tracking-normal text-amber-800">
              {totalActive}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {onUndo ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={disabled}
              title="Undo last filter change"
              className="rounded-full border border-slate-200 p-1.5 text-[10px] text-slate-500 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FaUndo />
            </button>
          ) : null}
        </div>
      </div>

      {totalActive === 0 ? (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          No filters yet — the chat searches the whole catalog. Add filters to narrow the search space.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <div key={String(group.key)}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{group.label}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {group.values.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onRemoveArrayValue(group.key, value)}
                    disabled={disabled}
                    title={`Remove ${value}`}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {value}
                    <FaTimes className="text-[9px] text-emerald-400 group-hover:text-rose-500" />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {scalarChips.length > 0 ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Timing & Budget</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {scalarChips.map((chip) => (
                  <button
                    key={String(chip.key)}
                    type="button"
                    onClick={() => onClearScalar(chip.key)}
                    disabled={disabled}
                    title="Remove this filter"
                    className="group inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {chip.label}
                    <FaTimes className="text-[9px] text-emerald-400 group-hover:text-rose-500" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenFilterEditor}
          disabled={disabled}
          className="rounded-full bg-slate-950 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Edit Filters
        </button>
        {totalActive > 0 ? (
          <button
            type="button"
            onClick={onClearAllFilters}
            disabled={disabled}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear All
          </button>
        ) : null}
      </div>
    </div>
  );
}
