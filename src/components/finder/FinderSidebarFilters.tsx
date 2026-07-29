import React from 'react';
import { Undo2, X } from 'lucide-react';

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
    <div className="cb-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="cb-eyebrow">Your filters</span>
          {totalActive > 0 ? <span className="cb-badge-cobalt">{totalActive}</span> : null}
        </div>
        {onUndo ? (
          <button
            type="button"
            onClick={onUndo}
            disabled={disabled}
            title="Undo last filter change"
            aria-label="Undo last filter change"
            className="cb-btn-ghost cb-btn-sm px-2"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {totalActive === 0 ? (
        <p className="mt-2 text-[12px] leading-5 text-muted">
          No filters yet — the chat searches the whole catalog. Add filters to narrow the search space.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <div key={String(group.key)}>
              <div className="text-[11px] text-muted-soft">{group.label}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {group.values.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onRemoveArrayValue(group.key, value)}
                    disabled={disabled}
                    title={`Remove ${value}`}
                    className="group inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-cobalt-200 bg-cobalt-50 px-2 text-[12px] text-cobalt-800 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {value}
                    <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {scalarChips.length > 0 ? (
            <div>
              <div className="text-[11px] text-muted-soft">Timing &amp; budget</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {scalarChips.map((chip) => (
                  <button
                    key={String(chip.key)}
                    type="button"
                    onClick={() => onClearScalar(chip.key)}
                    disabled={disabled}
                    title="Remove this filter"
                    className="group inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-cobalt-200 bg-cobalt-50 px-2 text-[12px] text-cobalt-800 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {chip.label}
                    <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onOpenFilterEditor} disabled={disabled} className="cb-btn-secondary cb-btn-sm">
          Edit filters
        </button>
        {totalActive > 0 ? (
          <button type="button" onClick={onClearAllFilters} disabled={disabled} className="cb-btn-ghost cb-btn-sm">
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  );
}
