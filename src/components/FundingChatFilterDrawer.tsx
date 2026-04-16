import { useState } from 'react';
import { FaCheck, FaClock, FaFilter, FaGlobeAsia, FaMoneyBillWave, FaSearch, FaTimes } from 'react-icons/fa';
import type { RecommendationSearchFilters } from '../lib/recommendations/types';
import {
  RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS,
  RECOMMENDATION_CAREER_STAGE_OPTIONS,
  RECOMMENDATION_FUNDING_KIND_OPTIONS,
  RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS,
  RECOMMENDATION_INSTITUTION_TYPE_OPTIONS,
  RECOMMENDATION_REGION_OPTIONS,
  RECOMMENDATION_SORT_OPTIONS,
  RECOMMENDATION_SPONSOR_TYPE_OPTIONS,
} from '../lib/recommendations/constants';

type FilterCategoryKey = 'geography' | 'funding' | 'eligibility' | 'timing' | 'search';

interface FundingChatFilterDrawerProps {
  filters: RecommendationSearchFilters;
  onChange: (filters: RecommendationSearchFilters) => void;
  onApply: () => void;
  onClearAll: () => void;
  onClose: () => void;
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleListValue(values: string[] | undefined, nextValue: string) {
  const current = values || [];
  return current.includes(nextValue)
    ? current.filter((value) => value !== nextValue)
    : [...current, nextValue];
}

function FilterChips({
  label,
  values,
  options,
  onToggle,
}: {
  label: string;
  values: string[] | undefined;
  options: readonly string[];
  onToggle: (nextValue: string) => void;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = (values || []).includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
                active
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-800'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextArrayField({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[] | undefined;
  onChange: (nextValues: string[]) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <textarea
        rows={3}
        value={(values || []).join(', ')}
        onChange={(event) => onChange(parseList(event.target.value))}
        placeholder={placeholder}
        className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

const filterCategories: Array<{ key: FilterCategoryKey; label: string; icon: JSX.Element }> = [
  { key: 'geography', label: 'Geography', icon: <FaGlobeAsia /> },
  { key: 'funding', label: 'Funding Type', icon: <FaFilter /> },
  { key: 'eligibility', label: 'Eligibility', icon: <FaCheck /> },
  { key: 'timing', label: 'Timing & Budget', icon: <FaClock /> },
  { key: 'search', label: 'Search Settings', icon: <FaSearch /> },
];

export default function FundingChatFilterDrawer({
  filters,
  onChange,
  onApply,
  onClearAll,
  onClose,
}: FundingChatFilterDrawerProps) {
  const [activeCategory, setActiveCategory] = useState<FilterCategoryKey>('geography');

  const update = (patch: Partial<RecommendationSearchFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.3)]">
        <aside className="w-full max-w-[240px] border-r border-slate-200 bg-slate-950 p-5 text-white">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Filters</div>
          <h2 className="mt-2 text-xl font-semibold">Refine Opportunities</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Choose a category, then narrow the funding search the way you would on a shopping site.
          </p>

          <div className="mt-6 space-y-2">
            {filterCategories.map((category) => {
              const active = category.key === activeCategory;
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-emerald-500 text-slate-950'
                      : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {category.icon}
                  {category.label}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {filterCategories.find((category) => category.key === activeCategory)?.label}
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-950">Choose Filter Options</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Apply the filters you want before sending your next chatbot request.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-300 p-3 text-slate-500 transition-colors hover:text-slate-900"
            >
              <FaTimes />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {activeCategory === 'geography' ? (
              <div className="space-y-6">
                <FilterChips
                  label="Geography Scope"
                  values={filters.geographyScope}
                  options={RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS}
                  onToggle={(value) => update({ geographyScope: toggleListValue(filters.geographyScope, value) })}
                />
                <FilterChips
                  label="Eligible Regions"
                  values={filters.eligibleRegions}
                  options={RECOMMENDATION_REGION_OPTIONS}
                  onToggle={(value) => update({ eligibleRegions: toggleListValue(filters.eligibleRegions, value) })}
                />
                <div className="grid gap-5 md:grid-cols-2">
                  <TextArrayField
                    label="Eligible Countries"
                    placeholder="India, Germany, United States"
                    values={filters.eligibleCountries}
                    onChange={(value) => update({ eligibleCountries: value })}
                  />
                  <TextArrayField
                    label="Host Countries"
                    placeholder="United Kingdom, Singapore"
                    values={filters.hostCountries}
                    onChange={(value) => update({ hostCountries: value })}
                  />
                </div>
                <TextArrayField
                  label="Funder Country"
                  placeholder="United States, Germany"
                  values={filters.funderCountries}
                  onChange={(value) => update({ funderCountries: value })}
                />
              </div>
            ) : null}

            {activeCategory === 'funding' ? (
              <div className="space-y-6">
                <FilterChips
                  label="Funding Type"
                  values={filters.fundingKinds}
                  options={RECOMMENDATION_FUNDING_KIND_OPTIONS}
                  onToggle={(value) => update({ fundingKinds: toggleListValue(filters.fundingKinds, value) })}
                />
                <FilterChips
                  label="Sponsor Type"
                  values={filters.sponsorTypes}
                  options={RECOMMENDATION_SPONSOR_TYPE_OPTIONS}
                  onToggle={(value) => update({ sponsorTypes: toggleListValue(filters.sponsorTypes, value) })}
                />
              </div>
            ) : null}

            {activeCategory === 'eligibility' ? (
              <div className="space-y-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <FilterChips
                    label="Institution Type"
                    values={filters.institutionTypes}
                    options={RECOMMENDATION_INSTITUTION_TYPE_OPTIONS}
                    onToggle={(value) => update({ institutionTypes: toggleListValue(filters.institutionTypes, value) })}
                  />
                  <FilterChips
                    label="Career Stage"
                    values={filters.careerStages}
                    options={RECOMMENDATION_CAREER_STAGE_OPTIONS}
                    onToggle={(value) => update({ careerStages: toggleListValue(filters.careerStages, value) })}
                  />
                </div>
                <FilterChips
                  label="Application Language"
                  values={filters.applicationLanguages}
                  options={RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS}
                  onToggle={(value) => update({ applicationLanguages: toggleListValue(filters.applicationLanguages, value) })}
                />
                <div className="grid gap-5 md:grid-cols-2">
                  <TextArrayField
                    label="Citizenship Requirements"
                    placeholder="Citizens of EU member states"
                    values={filters.citizenshipRequirements}
                    onChange={(value) => update({ citizenshipRequirements: value })}
                  />
                  <TextArrayField
                    label="Residency Requirements"
                    placeholder="Must reside in Canada"
                    values={filters.residencyRequirements}
                    onChange={(value) => update({ residencyRequirements: value })}
                  />
                </div>
              </div>
            ) : null}

            {activeCategory === 'timing' ? (
              <div className="space-y-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Deadline From</div>
                    <input
                      type="date"
                      value={filters.deadlineFrom || ''}
                      onChange={(event) => update({ deadlineFrom: event.target.value || undefined })}
                      className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Deadline To</div>
                    <input
                      type="date"
                      value={filters.deadlineTo || ''}
                      onChange={(event) => update({ deadlineTo: event.target.value || undefined })}
                      className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Minimum Amount</div>
                    <input
                      type="number"
                      value={filters.amountMin ?? ''}
                      onChange={(event) => update({ amountMin: event.target.value === '' ? null : Number(event.target.value) })}
                      className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Maximum Amount</div>
                    <input
                      type="number"
                      value={filters.amountMax ?? ''}
                      onChange={(event) => update({ amountMax: event.target.value === '' ? null : Number(event.target.value) })}
                      className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(filters.rollingOnly)}
                      onChange={(event) => update({ rollingOnly: event.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                    />
                    Rolling opportunities only
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(filters.includeExpired)}
                      onChange={(event) => update({ includeExpired: event.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                    />
                    Include expired opportunities
                  </label>
                </div>
              </div>
            ) : null}

            {activeCategory === 'search' ? (
              <div className="space-y-6">
                <label className="block">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sort Order</div>
                  <select
                    value={filters.sort || 'best_match'}
                    onChange={(event) => update({ sort: event.target.value as RecommendationSearchFilters['sort'] })}
                    className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    {RECOMMENDATION_SORT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === 'best_match' ? 'Best Match' : 'Deadline Soonest'}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Results Limit</div>
                  <select
                    value={filters.limit || 10}
                    onChange={(event) => update({ limit: Number(event.target.value) })}
                    className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    {[5, 10, 15, 20, 25].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-6 py-5">
            <button
              type="button"
              onClick={onClearAll}
              className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100"
            >
              Clear All Filters
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApply}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              <FaCheck />
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
