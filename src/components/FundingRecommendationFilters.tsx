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

interface FundingRecommendationFiltersProps {
  filters: RecommendationSearchFilters;
  onChange: (filters: RecommendationSearchFilters) => void;
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
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
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
        rows={2}
        value={(values || []).join(', ')}
        onChange={(event) => onChange(parseList(event.target.value))}
        placeholder={placeholder}
        className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

export default function FundingRecommendationFilters({
  filters,
  onChange,
}: FundingRecommendationFiltersProps) {
  const update = (patch: Partial<RecommendationSearchFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <FilterChips
          label="Geography Scope"
          values={filters.geographyScope}
          options={RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS}
          onToggle={(value) => update({ geographyScope: toggleListValue(filters.geographyScope, value) })}
        />
        <FilterChips
          label="Funding Type"
          values={filters.fundingKinds}
          options={RECOMMENDATION_FUNDING_KIND_OPTIONS}
          onToggle={(value) => update({ fundingKinds: toggleListValue(filters.fundingKinds, value) })}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
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

      <div className="grid gap-4 md:grid-cols-2">
        <FilterChips
          label="Sponsor Type"
          values={filters.sponsorTypes}
          options={RECOMMENDATION_SPONSOR_TYPE_OPTIONS}
          onToggle={(value) => update({ sponsorTypes: toggleListValue(filters.sponsorTypes, value) })}
        />
        <FilterChips
          label="Application Language"
          values={filters.applicationLanguages}
          options={RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS}
          onToggle={(value) => update({ applicationLanguages: toggleListValue(filters.applicationLanguages, value) })}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextArrayField
          label="Eligible Countries"
          placeholder="India, United States, Germany"
          values={filters.eligibleCountries}
          onChange={(value) => update({ eligibleCountries: value })}
        />
        <TextArrayField
          label="Eligible Regions"
          placeholder={RECOMMENDATION_REGION_OPTIONS.join(', ')}
          values={filters.eligibleRegions}
          onChange={(value) => update({ eligibleRegions: value })}
        />
        <TextArrayField
          label="Host Countries"
          placeholder="United Kingdom, Germany, Singapore"
          values={filters.hostCountries}
          onChange={(value) => update({ hostCountries: value })}
        />
        <TextArrayField
          label="Funder Country"
          placeholder="United States, Germany"
          values={filters.funderCountries}
          onChange={(value) => update({ funderCountries: value })}
        />
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

      <div className="grid gap-4 md:grid-cols-2">
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
  );
}
