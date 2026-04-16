import { FaFilter, FaRedo, FaSlidersH, FaTimes } from 'react-icons/fa';
import type { RecommendationConversationPendingPatch } from '../lib/recommendations/chatTypes';
import type { RecommendationSearchFilters } from '../lib/recommendations/types';

interface FinderActiveFilterBarProps {
  filters: Required<RecommendationSearchFilters>;
  pendingPatch: RecommendationConversationPendingPatch | null;
  onRemoveArrayValue: (key: keyof RecommendationSearchFilters, value: string) => void;
  onClearScalar: (key: keyof RecommendationSearchFilters) => void;
  onOpenFilters: () => void;
  onClearAllFilters: () => void;
  onUndo?: () => void;
}

function renderChipValues(filters: Required<RecommendationSearchFilters>) {
  const chips: Array<{
    key: keyof RecommendationSearchFilters;
    label: string;
    value?: string;
    action: 'remove_array_value' | 'clear_scalar';
  }> = [];

  filters.geographyScope.forEach((value) => chips.push({ key: 'geographyScope', label: 'Scope', value, action: 'remove_array_value' }));
  filters.fundingKinds.forEach((value) => chips.push({ key: 'fundingKinds', label: 'Type', value, action: 'remove_array_value' }));
  filters.sponsorTypes.forEach((value) => chips.push({ key: 'sponsorTypes', label: 'Sponsor', value, action: 'remove_array_value' }));
  filters.eligibleCountries.forEach((value) => chips.push({ key: 'eligibleCountries', label: 'Eligible', value, action: 'remove_array_value' }));
  filters.eligibleRegions.forEach((value) => chips.push({ key: 'eligibleRegions', label: 'Region', value, action: 'remove_array_value' }));
  filters.hostCountries.forEach((value) => chips.push({ key: 'hostCountries', label: 'Host', value, action: 'remove_array_value' }));
  filters.funderCountries.forEach((value) => chips.push({ key: 'funderCountries', label: 'Funder', value, action: 'remove_array_value' }));
  filters.institutionTypes.forEach((value) => chips.push({ key: 'institutionTypes', label: 'Institution', value, action: 'remove_array_value' }));
  filters.careerStages.forEach((value) => chips.push({ key: 'careerStages', label: 'Career', value, action: 'remove_array_value' }));
  filters.applicationLanguages.forEach((value) => chips.push({ key: 'applicationLanguages', label: 'Language', value, action: 'remove_array_value' }));
  filters.citizenshipRequirements.forEach((value) =>
    chips.push({ key: 'citizenshipRequirements', label: 'Citizenship', value, action: 'remove_array_value' })
  );
  filters.residencyRequirements.forEach((value) =>
    chips.push({ key: 'residencyRequirements', label: 'Residency', value, action: 'remove_array_value' })
  );
  if (filters.deadlineFrom) chips.push({ key: 'deadlineFrom', label: 'From', value: filters.deadlineFrom, action: 'clear_scalar' });
  if (filters.deadlineTo) chips.push({ key: 'deadlineTo', label: 'To', value: filters.deadlineTo, action: 'clear_scalar' });
  if (filters.rollingOnly) chips.push({ key: 'rollingOnly', label: 'Rolling Only', action: 'clear_scalar' });
  if (filters.includeExpired) chips.push({ key: 'includeExpired', label: 'Include Expired', action: 'clear_scalar' });
  if (filters.amountMin !== null) chips.push({ key: 'amountMin', label: 'Min', value: String(filters.amountMin), action: 'clear_scalar' });
  if (filters.amountMax !== null) chips.push({ key: 'amountMax', label: 'Max', value: String(filters.amountMax), action: 'clear_scalar' });

  return chips;
}

export default function FinderActiveFilterBar({
  filters,
  pendingPatch,
  onRemoveArrayValue,
  onClearScalar,
  onOpenFilters,
  onClearAllFilters,
  onUndo,
}: FinderActiveFilterBarProps) {
  const chips = renderChipValues(filters);

  return (
    <div className="rounded-[26px] border border-white/60 bg-white/85 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">
            <FaFilter />
            Active Search State
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Filters changed through chat or the filter panel always appear here, so the conversation stays grounded in visible search state.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onUndo ? (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:border-slate-400"
            >
              <FaRedo className="rotate-180" />
              Undo
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenFilters}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-700"
          >
            <FaSlidersH />
            Edit Filters
          </button>
          <button
            type="button"
            onClick={onClearAllFilters}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-slate-800"
          >
            Clear All Filters
          </button>
        </div>
      </div>

      {pendingPatch ? (
        <div className="mt-4 rounded-[22px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Pending confirmation:</span> {pendingPatch.summary}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {chips.length === 0 ? (
          <span className="rounded-full border border-dashed border-slate-300 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            No active filters
          </span>
        ) : (
          chips.map((chip) => (
            <button
              key={`${chip.key}-${chip.value || chip.label}`}
              type="button"
              onClick={() => {
                if (chip.action === 'remove_array_value' && chip.value) {
                  onRemoveArrayValue(chip.key, chip.value);
                  return;
                }
                onClearScalar(chip.key);
              }}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-900"
              title={chip.value ? `${chip.label}: ${chip.value}` : chip.label}
            >
              <span className="max-w-[220px] truncate">{chip.value ? `${chip.label}: ${chip.value}` : chip.label}</span>
              <FaTimes className="text-[10px]" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
